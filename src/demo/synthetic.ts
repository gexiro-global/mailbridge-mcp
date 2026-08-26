import type { MailboxConfig } from "../config/schema.js";
import type { FolderSummary, HealthResult } from "../domain/types.js";
import type { ImapAdapterFactory } from "../imap/factory.js";
import type {
  FolderSearchInput,
  RawAttachment,
  RawAttachmentContent,
  RawMessageDetail,
  RawMessageSummary,
  ReadOnlyImapAdapter,
} from "../imap/types.js";
import type { MailboxConnectionTester } from "../app/connectionTest.js";
import type {
  MailboxConnectionTestResult,
  MailboxCredentials,
  MailboxSettings,
} from "../app/types.js";

export class SyntheticMailboxConnectionTester implements MailboxConnectionTester {
  async test(settings: MailboxSettings, _credentials: MailboxCredentials): Promise<MailboxConnectionTestResult> {
    return syntheticConnectionResult(settings.tls_mode, settings.allowed_folders);
  }
}

export class SyntheticImapAdapterFactory implements ImapAdapterFactory {
  async create(mailbox: MailboxConfig): Promise<ReadOnlyImapAdapter> {
    return new SyntheticImapAdapter(mailbox);
  }
}

class SyntheticImapAdapter implements ReadOnlyImapAdapter {
  readonly #messages: RawMessageDetail[];

  constructor(readonly mailbox: MailboxConfig) {
    this.#messages = syntheticMessages(mailbox);
  }

  async health(): Promise<HealthResult> {
    return {
      mailbox_id: this.mailbox.id,
      connected: true,
      tls_verified: true,
      authentication_successful: true,
      folder_discovery_successful: true,
      latency_ms: 1,
      error_category: null,
      checked_at: new Date().toISOString(),
    };
  }

  async listFolders(): Promise<FolderSummary[]> {
    return this.mailbox.allowed_folders.map((folder) => ({
      folder_id: folder,
      display_name: folder,
      special_use: folder === "INBOX" ? "\\Inbox" : null,
      selectable: true,
      message_count: this.#messages.filter((message) => message.folder === folder).length,
      unread_count: this.#messages.filter((message) => message.folder === folder && message.unread).length,
    }));
  }

  async discoverFolders(): Promise<FolderSummary[]> {
    return this.listFolders();
  }

  async search(input: FolderSearchInput): Promise<RawMessageSummary[]> {
    return this.#messages.filter((message) => matches(message, input)).slice(0, input.limit);
  }

  async fetch(folder: string, uidValidity: bigint, uid: number, _maxBytes: number): Promise<RawMessageDetail> {
    const message = this.#messages.find((candidate) =>
      candidate.folder === folder && candidate.uid_validity === uidValidity && candidate.uid === uid,
    );
    if (!message) throw new Error("Synthetic message not found");
    return structuredClone(message);
  }

  async listAttachmentParts(folder: string, uidValidity: bigint, uid: number): Promise<RawAttachment[]> {
    const message = this.#messages.find((candidate) =>
      candidate.folder === folder && candidate.uid_validity === uidValidity && candidate.uid === uid,
    );
    if (!message) throw new Error("Synthetic message not found");
    return structuredClone(message.attachments);
  }

  async fetchAttachment(
    folder: string,
    uidValidity: bigint,
    uid: number,
    part: string,
    maxBytes: number,
  ): Promise<RawAttachmentContent> {
    const parts = await this.listAttachmentParts(folder, uidValidity, uid);
    const meta = parts.find((attachment) => attachment.part === part);
    if (!meta) throw new Error("Synthetic attachment not found");
    const body = Buffer.from(`LOCAL SYNTHETIC DEMO attachment ${meta.filename ?? part}`, "utf8");
    const bytes = body.subarray(0, Math.max(1, Math.min(maxBytes, body.byteLength)));
    return {
      part,
      filename: meta.filename,
      mime_type: meta.mime_type,
      declared_size: meta.size,
      bytes,
      truncated: bytes.byteLength < body.byteLength,
    };
  }

  async verifyPeekInvariant(_folder: string, _maxBytes: number) {
    return {
      success: true,
      flags_before: ["\\Flagged"],
      flags_after: ["\\Flagged"],
      unchanged: true,
      reason: "LOCAL_SYNTHETIC_BODY_PEEK_FLAGS_UNCHANGED",
    };
  }
}

export function syntheticConnectionResult(
  mode: "implicit" | "starttls",
  folders: string[] = ["INBOX"],
): MailboxConnectionTestResult {
  return {
    status: "PASS",
    dns_resolution: { success: true, address_count: 1 },
    tcp_connection: { success: true, latency_ms: 1 },
    tls_verification: {
      success: true,
      mode,
      certificate: {
        subject: "LOCAL SYNTHETIC DEMO",
        issuer: "LOCAL SYNTHETIC DEMO",
        san: ["synthetic.invalid"],
        valid_to: null,
        protocol: "SYNTHETIC",
      },
    },
    authentication: { success: true },
    examine: { success: true },
    folder_discovery: {
      success: true,
      folders: folders.map((folder) => ({
        folder_id: folder,
        special_use: folder === "INBOX" ? "\\Inbox" : null,
        selectable: true,
      })),
    },
    body_peek: {
      success: true,
      flags_before: ["\\Flagged"],
      flags_after: ["\\Flagged"],
      unchanged: true,
      reason: "LOCAL_SYNTHETIC_BODY_PEEK_FLAGS_UNCHANGED",
    },
    latency_ms: 1,
    error_category: null,
  };
}

function syntheticMessages(mailbox: MailboxConfig): RawMessageDetail[] {
  const domain = mailbox.email.split("@")[1] ?? "mailbridge.invalid";
  const firstId = `<local-demo-${mailbox.id}-101@synthetic.invalid>`;
  const secondId = `<local-demo-${mailbox.id}-102@synthetic.invalid>`;
  const folder = mailbox.allowed_folders.includes("INBOX") ? "INBOX" : mailbox.allowed_folders[0]!;
  return [
    {
      uid: 101,
      uid_validity: 20260717n,
      folder,
      from: [{ name: "Atlas Partner Demo", address: "atlas-partner@synthetic.invalid" }],
      to: [{ name: mailbox.display_name, address: mailbox.email }],
      cc: [],
      subject: `ATLAS — synthetic reply for ${mailbox.display_name}`,
      received_at: "2026-07-17T08:30:00.000Z",
      unread: true,
      attachments: [{
        part: "2",
        filename: "synthetic-brief.pdf",
        mime_type: "application/pdf",
        size: 2048,
        disposition: "attachment",
        inline: false,
      }],
      snippet: "Synthetic demonstration message about Project ATLAS.",
      message_id: firstId,
      in_reply_to: null,
      references: [],
      headers: {
        "message-id": firstId,
        "x-mailbridge-demo": "synthetic-only",
      },
      text_body: "This is synthetic demonstration content. It did not come from a real mailbox.",
      html_body: "<p>LOCAL SYNTHETIC DEMO — test message.</p>",
      source_truncated: false,
    },
    {
      uid: 102,
      uid_validity: 20260717n,
      folder,
      from: [{ name: "Example Partner Demo", address: "example-partner@synthetic.invalid" }],
      to: [{ address: mailbox.email }],
      cc: [{ address: `archive@${domain}` }],
      subject: `Re: ATLAS — synthetic conversation`,
      received_at: "2026-07-17T09:15:00.000Z",
      unread: false,
      attachments: [],
      snippet: "Second synthetic message in the ATLAS conversation.",
      message_id: secondId,
      in_reply_to: firstId,
      references: [firstId],
      headers: {
        "message-id": secondId,
        "in-reply-to": firstId,
        references: firstId,
        "x-mailbridge-demo": "synthetic-only",
      },
      text_body: "Synthetic continuation of the conversation — no IMAP connection.",
      html_body: null,
      source_truncated: false,
    },
  ];
}

function matches(message: RawMessageDetail, input: FolderSearchInput): boolean {
  if (message.folder !== input.folder) return false;
  if (input.after && new Date(message.received_at) < input.after) return false;
  if (input.before && new Date(message.received_at) > input.before) return false;
  if (input.unread_only && !message.unread) return false;
  if (input.has_attachment !== undefined && (message.attachments.length > 0) !== input.has_attachment) return false;
  if (input.free_text && !contains(message, input.free_text)) return false;
  if (input.subject && !includes(message.subject, input.subject)) return false;
  if (input.from && !addressContains(message.from, input.from)) return false;
  if (input.to && !addressContains(message.to, input.to)) return false;
  if (input.cc && !addressContains(message.cc, input.cc)) return false;
  if (input.thread_identifiers?.length) {
    const identifiers = [message.message_id, message.in_reply_to, ...message.references].filter((value): value is string => Boolean(value));
    if (!input.thread_identifiers.some((identifier) => identifiers.includes(identifier))) return false;
  }
  return true;
}

function contains(message: RawMessageDetail, needle: string): boolean {
  const haystack = [
    message.subject,
    message.snippet ?? "",
    message.text_body,
    ...message.from.flatMap((value) => [value.name ?? "", value.address ?? ""]),
    ...message.to.flatMap((value) => [value.name ?? "", value.address ?? ""]),
    ...message.cc.flatMap((value) => [value.name ?? "", value.address ?? ""]),
  ].join("\n");
  return includes(haystack, needle);
}

function addressContains(values: Array<{ name?: string; address?: string }>, needle: string): boolean {
  return values.some((value) => includes(`${value.name ?? ""} ${value.address ?? ""}`, needle));
}

function includes(value: string, needle: string): boolean {
  return value.toLocaleLowerCase("pl").includes(needle.toLocaleLowerCase("pl"));
}
