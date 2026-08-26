import type { MailboxConfig } from "../config/schema.js";
import type { CrossBrandFinding, MessageSummary } from "../domain/types.js";

export function findCrossBrandFindings(mailboxes: MailboxConfig[], messages: MessageSummary[]): CrossBrandFinding[] {
  const domains = buildDomainMap(mailboxes);
  return messages.flatMap((message) => {
    const matched = new Map<string, Set<string>>();
    for (const value of [...message.from, ...message.to, ...message.cc]) {
      const domain = addressDomain(value.address);
      if (!domain) continue;
      for (const brand of domains.get(domain) ?? []) {
        if (brand === message.brand) continue;
        const evidence = matched.get(brand) ?? new Set<string>();
        evidence.add(`participant domain ${domain} maps to ${brand}`);
        matched.set(brand, evidence);
      }
    }
    if (matched.size === 0) return [];
    const expectedBrands = [...matched.keys()].sort();
    return [{
      message,
      actual_brand: message.brand,
      expected_brands: expectedBrands,
      confidence: expectedBrands.length === 1 ? 0.85 : 0.65,
      reason_codes: ["CROSS_BRAND_PARTICIPANT_DOMAIN"],
      evidence: [...matched.values()].flatMap((items) => [...items]).sort(),
      follow_up_tool: "fetch_thread" as const,
    }];
  });
}

function buildDomainMap(mailboxes: MailboxConfig[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const mailbox of mailboxes) {
    const candidates = [addressDomain(mailbox.email), ...mailbox.brand_hints.domains.map(normalizeDomain)].filter(isString);
    for (const domain of candidates) {
      const brands = result.get(domain) ?? new Set<string>();
      brands.add(mailbox.brand);
      result.set(domain, brands);
    }
  }
  return result;
}

function addressDomain(value: string | undefined): string | null {
  if (!value) return null;
  const match = /@([^@\s>]+)$/.exec(value.trim().toLowerCase());
  return match?.[1] ? normalizeDomain(match[1]) : null;
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function isString(value: string | null): value is string {
  return value !== null;
}
