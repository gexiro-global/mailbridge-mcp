import { createHash } from "node:crypto";
import { demoMailboxes } from "./demo-data.js";
import { UNTRUSTED_EMAIL_WARNING, type DemoMessage, type MessageSummary } from "./types.js";

export interface SearchInput {
  mailbox_ids?: string[];
  folders?: string[];
  free_text?: string;
  after?: string;
  before?: string;
  unread_only?: boolean;
  has_attachment?: boolean;
  limit: number;
}

export class DemoMailService {
  constructor(private readonly publicBaseUrl: string) {}

  listMailboxes() {
    return {
      mode: "SYNTHETIC_DEMO",
      write_operations_available: false,
      mailboxes: demoMailboxes.map((mailbox) => ({
        mailbox_id: mailbox.mailbox_id,
        display_name: mailbox.display_name,
        mailbox_email: mailbox.mailbox_email,
        brand: mailbox.brand,
        purpose: mailbox.purpose,
        enabled: true,
        access_mode: "READ_ONLY",
        folder_count: mailbox.folders.length,
        message_count: mailbox.messages.length,
      })),
    };
  }

  mailboxHealth(mailboxIds?: string[]) {
    const selected = this.selectMailboxes(mailboxIds);
    return {
      checked_at: new Date().toISOString(),
      results: selected.map((mailbox) => ({
        mailbox_id: mailbox.mailbox_id,
        connected: true,
        tls_verified: true,
        authentication_successful: true,
        folder_discovery_successful: true,
        read_only_verified: true,
        mode: "SYNTHETIC_DEMO",
      })),
      partial_failures: [],
    };
  }

  listFolders(mailboxIds?: string[]) {
    return {
      mailboxes: this.selectMailboxes(mailboxIds).map((mailbox) => ({
        mailbox_id: mailbox.mailbox_id,
        folders: mailbox.folders.map((folder) => ({
          folder_id: folder,
          display_name: folder,
          selectable: true,
          message_count: mailbox.messages.filter((message) => message.folder === folder).length,
          unread_count: mailbox.messages.filter((message) => message.folder === folder && message.unread).length,
        })),
      })),
      partial_failures: [],
    };
  }

  listRecentMessages(mailboxIds: string[] | undefined, folder: string | undefined, limit: number) {
    const messages = this.allMessages(mailboxIds)
      .filter((message) => !folder || message.folder === folder)
      .sort((left, right) => right.received_at.localeCompare(left.received_at))
      .slice(0, limit)
      .map(toSummary);
    return { messages, partial_failures: [], truncated: messages.length === limit };
  }

  searchMessages(input: SearchInput) {
    const needle = input.free_text?.trim().toLocaleLowerCase("en") ?? "";
    const messages = this.allMessages(input.mailbox_ids)
      .filter((message) => !input.folders?.length || input.folders.includes(message.folder))
      .filter((message) => !input.after || message.received_at >= input.after)
      .filter((message) => !input.before || message.received_at <= input.before)
      .filter((message) => !input.unread_only || message.unread)
      .filter((message) => input.has_attachment === undefined || (message.attachments.length > 0) === input.has_attachment)
      .filter((message) => !needle || searchableText(message).includes(needle))
      .sort((left, right) => right.received_at.localeCompare(left.received_at))
      .slice(0, input.limit)
      .map(toSummary);
    return { messages, partial_failures: [], truncated: messages.length === input.limit };
  }

  fetchMessage(stableMessageId: string) {
    const message = this.requireMessage(stableMessageId);
    return {
      ...toSummary(message),
      headers: {
        "message-id": message.message_id,
        ...(message.in_reply_to ? { "in-reply-to": message.in_reply_to } : {}),
        ...(message.references.length ? { references: message.references.join(" ") } : {}),
        "x-mailbridge-demo": "synthetic-only",
      },
      text_body: message.text_body,
      message_id: message.message_id,
      in_reply_to: message.in_reply_to,
      references: message.references,
      attachments: message.attachments.map(({ content: _content, ...attachment }) => ({
        ...attachment,
        declared_size: Buffer.byteLength(message.attachments.find((item) => item.attachment_id === attachment.attachment_id)?.content ?? ""),
        inline: false,
        disposition: "attachment",
      })),
      source_truncated: false,
      read_state_changed: false,
    };
  }

  fetchThread(stableMessageId: string, maxMessages: number) {
    const anchor = this.requireMessage(stableMessageId);
    const identifiers = new Set([anchor.message_id, anchor.in_reply_to, ...anchor.references].filter(Boolean));
    const messages = this.allMessages()
      .filter((candidate) => {
        const candidateIds = [candidate.message_id, candidate.in_reply_to, ...candidate.references].filter(Boolean);
        return candidate.stable_message_id === stableMessageId || candidateIds.some((id) => identifiers.has(id));
      })
      .sort((left, right) => left.received_at.localeCompare(right.received_at))
      .slice(0, maxMessages)
      .map(toSummary);
    return { messages, confidence: "HIGH", partial_failures: [], truncated: messages.length === maxMessages };
  }

  listAttachments(stableMessageId: string) {
    const message = this.requireMessage(stableMessageId);
    return {
      stable_message_id: stableMessageId,
      attachments: message.attachments.map((attachment) => ({
        attachment_id: attachment.attachment_id,
        filename: attachment.filename,
        mime_type: attachment.mime_type,
        declared_size: Buffer.byteLength(attachment.content),
        inline: false,
      })),
    };
  }

  fetchAttachment(stableMessageId: string, attachmentId: string, maxBytes: number) {
    const message = this.requireMessage(stableMessageId);
    const attachment = message.attachments.find((candidate) => candidate.attachment_id === attachmentId);
    if (!attachment) throw new Error("Attachment not found");
    const source = Buffer.from(attachment.content, "utf8");
    const bounded = source.subarray(0, Math.min(source.byteLength, maxBytes));
    return {
      attachment_id: attachment.attachment_id,
      filename: attachment.filename,
      mime_type: attachment.mime_type,
      declared_size: source.byteLength,
      returned_bytes: bounded.byteLength,
      truncated: bounded.byteLength < source.byteLength,
      sha256: createHash("sha256").update(bounded).digest("hex"),
      content_base64: bounded.toString("base64"),
      untrusted_content_warning: UNTRUSTED_EMAIL_WARNING,
    };
  }

  searchKnowledge(query: string) {
    const result = this.searchMessages({ free_text: query, limit: 50 });
    return {
      results: result.messages.map((message) => ({
        id: message.stable_message_id,
        title: message.subject,
        url: this.documentUrl(message.stable_message_id),
      })),
    };
  }

  fetchKnowledge(id: string) {
    const message = this.fetchMessage(id);
    return {
      id,
      title: message.subject,
      text: message.text_body,
      url: this.documentUrl(id),
      metadata: {
        mailbox_id: message.mailbox_id,
        folder: message.folder,
        received_at: message.received_at,
        warning: UNTRUSTED_EMAIL_WARNING,
      },
    };
  }

  private documentUrl(id: string): string {
    return `${this.publicBaseUrl.replace(/\/$/, "")}/documents/${encodeURIComponent(id)}`;
  }

  private selectMailboxes(mailboxIds?: string[]) {
    if (!mailboxIds?.length) return demoMailboxes;
    const selected = demoMailboxes.filter((mailbox) => mailboxIds.includes(mailbox.mailbox_id));
    if (selected.length !== new Set(mailboxIds).size) throw new Error("Unknown mailbox id");
    return selected;
  }

  private allMessages(mailboxIds?: string[]): DemoMessage[] {
    return this.selectMailboxes(mailboxIds).flatMap((mailbox) => mailbox.messages);
  }

  private requireMessage(stableMessageId: string): DemoMessage {
    const message = this.allMessages().find((candidate) => candidate.stable_message_id === stableMessageId);
    if (!message) throw new Error("Message not found");
    return message;
  }
}

function toSummary(message: DemoMessage): MessageSummary {
  return {
    stable_message_id: message.stable_message_id,
    mailbox_id: message.mailbox_id,
    folder: message.folder,
    from: message.from,
    to: message.to,
    cc: message.cc,
    subject: message.subject,
    received_at: message.received_at,
    unread: message.unread,
    has_attachments: message.attachments.length > 0,
    attachment_count: message.attachments.length,
    safe_snippet: message.text_body.slice(0, 240),
    untrusted_content_warning: UNTRUSTED_EMAIL_WARNING,
  };
}

function searchableText(message: DemoMessage): string {
  return [
    message.subject,
    message.text_body,
    ...message.from.flatMap((value) => [value.name ?? "", value.address]),
    ...message.to.flatMap((value) => [value.name ?? "", value.address]),
    ...message.cc.flatMap((value) => [value.name ?? "", value.address]),
  ].join("\n").toLocaleLowerCase("en");
}
