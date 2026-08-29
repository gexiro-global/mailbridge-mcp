import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import type { MailboxConfig } from "../config/schema.js";
import { MailBridgeError } from "../domain/errors.js";
import type { SecretReader } from "../imap/factory.js";
import type { DraftPayload, SendReceipt, SentCopyResult } from "../app/types.js";
import { resolvePublicEndpoint } from "../security/networkPolicy.js";
import type { SentCopyWriter } from "./sentCopy.js";

export interface MailTransport {
  send(mailbox: MailboxConfig, payload: DraftPayload, messageId: string): Promise<SendReceipt>;
}

export interface SmtpSender {
  sendMail(options: Record<string, unknown>): Promise<{ messageId?: unknown; accepted?: unknown; rejected?: unknown }>;
  close(): void;
}

export type SmtpSenderFactory = (options: Record<string, unknown>) => SmtpSender;

export class SmtpMailTransport implements MailTransport {
  constructor(
    readonly secrets: SecretReader,
    readonly sentCopy?: SentCopyWriter,
    readonly senderFactory: SmtpSenderFactory = defaultSenderFactory,
    readonly sentCopyMailboxIds: ReadonlySet<string> | null = null,
    readonly endpointResolver: typeof resolvePublicEndpoint = resolvePublicEndpoint,
  ) {}

  async send(mailbox: MailboxConfig, payload: DraftPayload, messageId: string): Promise<SendReceipt> {
    if (!mailbox.send_enabled || mailbox.send_transport !== "smtp" || !mailbox.smtp_host) {
      throw new MailBridgeError("Sending is not configured for this mailbox", "SEND_NOT_CONFIGURED");
    }
    const [username, password] = await Promise.all([
      this.secrets.read(mailbox.username_secret),
      this.secrets.read(mailbox.password_secret),
    ]);
    const secure = mailbox.smtp_tls_mode === "implicit";
    const endpoint = await this.endpointResolver(mailbox.smtp_host);
    const transport = this.senderFactory({
      host: endpoint.address,
      port: mailbox.smtp_port,
      secure,
      requireTLS: !secure,
      auth: { user: username, pass: password },
      tls: { rejectUnauthorized: true, servername: endpoint.hostname, minVersion: "TLSv1.2" },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    const raw = await buildRawMessage(mailbox, payload, messageId);
    try {
      let info: { messageId?: unknown; accepted?: unknown; rejected?: unknown };
      try {
        info = await transport.sendMail({
          envelope: { from: mailbox.email, to: [...payload.to, ...payload.cc, ...payload.bcc] },
          raw,
        });
      } catch {
        throw new MailBridgeError("SMTP delivery failed", "SMTP_SEND_FAILED", true);
      }
      const accepted = normalizeAddresses(info.accepted);
      const rejected = normalizeAddresses(info.rejected);
      const sentAt = new Date().toISOString();
      let sentCopy: SentCopyResult;
      if (accepted.length === 0) {
        sentCopy = { state: "not_applicable", folder: null, attempts: 0, error_code: "SMTP_NOT_ACCEPTED" };
      } else if (
        !this.sentCopy ||
        (this.sentCopyMailboxIds !== null && !this.sentCopyMailboxIds.has(mailbox.id))
      ) {
        sentCopy = { state: "disabled", folder: null, attempts: 0, error_code: "SENT_COPY_DISABLED" };
      } else {
        sentCopy = await this.sentCopy.save(mailbox, raw, messageId, sentAt);
      }
      return {
        mailbox_id: mailbox.id,
        message_id: messageId,
        accepted,
        rejected,
        sent_at: sentAt,
        sent_copy: sentCopy,
      };
    } finally {
      raw.fill(0);
      transport.close();
    }
  }
}

async function buildRawMessage(mailbox: MailboxConfig, payload: DraftPayload, messageId: string): Promise<Buffer> {
  const attachmentBuffers = payload.attachments.map((attachment) => Buffer.from(attachment.content_base64, "base64"));
  try {
    return await new MailComposer({
      from: mailbox.email,
      to: payload.to,
      cc: payload.cc.length ? payload.cc : undefined,
      bcc: payload.bcc.length ? payload.bcc : undefined,
      subject: payload.subject,
      text: payload.text_body,
      messageId,
      inReplyTo: payload.in_reply_to ?? undefined,
      references: payload.references.length ? payload.references : undefined,
      attachments: payload.attachments.map((attachment, index) => ({
        filename: attachment.filename,
        content: attachmentBuffers[index]!,
        contentType: attachment.mime_type,
        contentDisposition: "attachment",
      })),
      date: new Date(),
      disableFileAccess: true,
      disableUrlAccess: true,
    }).compile().build();
  } finally {
    for (const value of attachmentBuffers) value.fill(0);
  }
}

function defaultSenderFactory(options: Record<string, unknown>): SmtpSender {
  return nodemailer.createTransport(options) as unknown as SmtpSender;
}

function normalizeAddresses(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((value) => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && "address" in value) return String((value as { address: unknown }).address);
    return String(value);
  });
}
