import { domainToASCII } from "node:url";
import type { DraftPayload, DraftValidation, SendPolicyView } from "../app/types.js";

export interface SendUsage {
  last_hour: number;
  last_day: number;
}

export function evaluateSendPolicy(
  mailboxEmail: string,
  draftId: string,
  draftVersion: number,
  payload: DraftPayload,
  policy: SendPolicyView,
  usage: SendUsage,
): DraftValidation {
  const recipients = [...payload.to, ...payload.cc, ...payload.bcc];
  const mailboxDomain = addressDomain(mailboxEmail);
  const domains = recipients.map(addressDomain);
  const allowed = new Set(policy.allowed_domains.map(canonicalDomain));
  const denied = new Set(policy.denied_domains.map(canonicalDomain));
  const externalCount = domains.filter((domain) => domain !== mailboxDomain).length;
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (policy.send_mode === "disabled") reasons.push("SEND_POLICY_DISABLED");
  if (recipients.length > policy.max_recipients) reasons.push("RECIPIENT_LIMIT_EXCEEDED");
  if (domains.some((domain) => denied.has(domain))) reasons.push("RECIPIENT_DOMAIN_DENIED");
  if (allowed.size > 0 && domains.some((domain) => !allowed.has(domain))) reasons.push("RECIPIENT_DOMAIN_NOT_ALLOWED");
  if (externalCount > 0 && policy.external_recipients === "block") reasons.push("EXTERNAL_RECIPIENT_BLOCKED");
  if (externalCount > 0 && policy.external_recipients === "warn") warnings.push("EXTERNAL_RECIPIENT_WARNING");
  if (usage.last_hour >= policy.max_per_hour) reasons.push("HOURLY_SEND_LIMIT_EXCEEDED");
  if (usage.last_day >= policy.max_per_day) reasons.push("DAILY_SEND_LIMIT_EXCEEDED");

  return {
    draft_id: draftId,
    draft_version: draftVersion,
    mailbox_id: payload.mailbox_id,
    policy_version: policy.policy_version,
    blocked: reasons.length > 0,
    reasons: unique(reasons),
    warnings: unique(warnings),
    recipient_count: recipients.length,
    external_recipient_count: externalCount,
    remaining_hour: Math.max(0, policy.max_per_hour - usage.last_hour),
    remaining_day: Math.max(0, policy.max_per_day - usage.last_day),
  };
}

export function canonicalDomain(value: string): string {
  const ascii = domainToASCII(value.trim().toLowerCase());
  if (!ascii || ascii.length > 253 || !/^(?!.*\.\.)(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(ascii)) {
    throw new Error("Invalid recipient domain");
  }
  return ascii;
}

export function addressDomain(address: string): string {
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) throw new Error("Invalid email address");
  return canonicalDomain(address.slice(at + 1));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
