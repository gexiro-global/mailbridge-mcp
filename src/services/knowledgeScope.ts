import type { MailboxConfig } from "../config/schema.js";

const SCOPE_TOKEN = /(^|\s)mailbox:("[^"]+"|\S+)/gi;
const MIN_SCOPE_LENGTH = 2;

export interface ParsedKnowledgeQuery {
  free_text: string;
  scopes: string[];
}

function normalize(value: string): string {
  return value.trim().replace(/^[\s,;:.!?]+|[\s,;:.!?]+$/g, "").toLowerCase();
}

export function parseKnowledgeQuery(raw: string): ParsedKnowledgeQuery {
  const scopes: string[] = [];
  const stripped = raw.replace(SCOPE_TOKEN, (_match, lead: string, value: string) => {
    scopes.push(value.replace(/^"|"$/g, ""));
    return lead;
  });
  return {
    free_text: stripped.replace(/\s+/g, " ").trim(),
    scopes: [...new Set(scopes.map(normalize).filter((scope) => scope.length >= MIN_SCOPE_LENGTH))],
  };
}

export function selectScopedMailboxes(mailboxes: MailboxConfig[], scopes: string[]): MailboxConfig[] {
  const wanted = [...new Set(scopes.map(normalize).filter((scope) => scope.length >= MIN_SCOPE_LENGTH))];
  if (wanted.length === 0) return [];
  return mailboxes.filter((mailbox) => {
    const haystacks = [mailbox.id, mailbox.brand, mailbox.email, mailbox.display_name].map(normalize);
    return wanted.some((scope) => haystacks.some((value) => value === scope || value.includes(scope)));
  });
}

export interface KnowledgeSearchOptions {
  mailbox_ids?: string[];
  folders?: string[];
  after?: string;
  before?: string;
  unread_only?: boolean;
  has_attachment?: boolean;
  limit?: number;
}

const FOLDER_RANK: Array<[RegExp, number]> = [
  [/^inbox$/i, 0],
  [/sent|gesendet|wyslane|wysłane/i, 1],
  [/all ?mail|alle nachrichten|archiv|archive/i, 3],
  [/spam|junk|werbung/i, 4],
  [/trash|papierkorb|deleted|kosz/i, 5],
];

export function folderRank(folder: string): number {
  for (const [pattern, rank] of FOLDER_RANK) if (pattern.test(folder)) return rank;
  return 2;
}

export interface DedupableSummary {
  mailbox_id: string;
  source_folder: string;
  subject: string;
  received_at: string;
  from: Array<{ address?: string; name?: string }>;
  attachment_count: number;
}

function dedupeKey(message: DedupableSummary): string {
  const sender = message.from.map((value) => (value.address ?? value.name ?? "").toLowerCase()).sort().join(",");
  return [message.mailbox_id, message.received_at, sender, message.subject.trim().toLowerCase(), message.attachment_count].join("\u0000");
}

export function dedupeSummaries<T extends DedupableSummary>(messages: T[]): T[] {
  const best = new Map<string, T>();
  const order: string[] = [];
  for (const message of messages) {
    const key = dedupeKey(message);
    const current = best.get(key);
    if (!current) {
      best.set(key, message);
      order.push(key);
      continue;
    }
    if (folderRank(message.source_folder) < folderRank(current.source_folder)) best.set(key, message);
  }
  return order.map((key) => best.get(key)!);
}
