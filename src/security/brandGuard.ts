import type { MailboxConfig } from "../config/schema.js";
import { MailBridgeError } from "../domain/errors.js";

export interface BrandContextInput {
  mailbox_id: string;
  organisation_name: string;
  proposed_sender_email?: string;
  subject?: string;
}

export interface BrandContextResult {
  status: "MATCH" | "WARNING" | "REVIEW_REQUIRED";
  expected_brand: string | null;
  actual_brand: string;
  confidence: number;
  evidence: string[];
  reason_codes: string[];
}

export interface BrandConfigurationWarning {
  code: "CROSS_BRAND_CONFIGURATION_WARNING";
  expected_brand: string;
  actual_brand: string;
  evidence: string;
}

export function brandConfigurationWarnings(
  mailbox: MailboxConfig,
  configuredMailboxes: MailboxConfig[] = [mailbox],
): BrandConfigurationWarning[] {
  const domain = extractDomain(mailbox.email);
  const mappedBrands = domain
    ? unique(configuredMailboxes
      .filter((candidate) => candidate.brand_hints.domains.some((hint) => hint.toLowerCase() === domain))
      .map((candidate) => candidate.brand))
    : [];
  const expected = mailbox.brand_hints.private ? "PRIVATE" : mappedBrands.length === 1 ? mappedBrands[0]! : null;
  if (!expected || expected === mailbox.brand) return [];
  return [{
    code: "CROSS_BRAND_CONFIGURATION_WARNING",
    expected_brand: expected,
    actual_brand: mailbox.brand,
    evidence: expected === "PRIVATE" ? "mailbox is marked private in brand hints" : `mailbox domain ${domain} maps to ${expected}`,
  }];
}

export function checkBrandContext(mailboxes: MailboxConfig[], input: BrandContextInput): BrandContextResult {
  const actual = mailboxes.find((mailbox) => mailbox.id === input.mailbox_id);
  if (!actual) throw new MailBridgeError("Unknown mailbox", "MAILBOX_NOT_FOUND");

  const haystack = normalize(`${input.organisation_name}\n${input.subject ?? ""}`);
  const senderDomain = extractDomain(input.proposed_sender_email);
  const evidence: string[] = [];
  const candidates = new Map<string, number>();

  for (const mailbox of mailboxes) {
    let score = 0;
    for (const name of mailbox.brand_hints.organisation_names) {
      if (haystack.includes(normalize(name))) {
        score += 3;
        evidence.push(`organisation/subject matched a ${mailbox.brand} name hint`);
      }
    }
    for (const domain of mailbox.brand_hints.domains) {
      if (senderDomain && domain.toLowerCase() === senderDomain) {
        score += 4;
        evidence.push(`proposed sender domain matched ${mailbox.brand}`);
      }
    }
    if (score > 0) candidates.set(mailbox.brand, Math.max(candidates.get(mailbox.brand) ?? 0, score));
  }

  const ordered = [...candidates.entries()].sort((a, b) => b[1] - a[1]);
  const expected = ordered[0]?.[0] ?? null;
  if (!expected) {
    return {
      status: "REVIEW_REQUIRED",
      expected_brand: null,
      actual_brand: actual.brand,
      confidence: 0.35,
      evidence: [],
      reason_codes: ["NO_BRAND_SIGNAL"],
    };
  }

  if (expected === actual.brand) {
    return {
      status: "MATCH",
      expected_brand: expected,
      actual_brand: actual.brand,
      confidence: ordered.length === 1 ? 0.9 : 0.7,
      evidence: unique(evidence),
      reason_codes: ordered.length === 1 ? ["BRAND_SIGNAL_MATCH"] : ["AMBIGUOUS_BRAND_SIGNALS"],
    };
  }

  return {
    status: "WARNING",
    expected_brand: expected,
    actual_brand: actual.brand,
    confidence: ordered.length === 1 ? 0.95 : 0.75,
    evidence: unique(evidence),
    reason_codes: [
      actual.brand_hints.private ? "PRIVATE_MAILBOX_FOR_COMPANY_CONTEXT" : "CROSS_BRAND_SENDER_MISMATCH",
    ],
  };
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function extractDomain(value: string | undefined): string | null {
  if (!value) return null;
  const match = /@([^@\s>]+)$/.exec(value.trim().toLowerCase());
  return match?.[1] ?? null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
