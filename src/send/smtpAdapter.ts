import nodemailer from "nodemailer";
import type { MailboxConfig } from "../config/schema.js";
import { MailBridgeError } from "../domain/errors.js";
import type { SecretReader } from "../imap/factory.js";
import type { DraftPayload, SendReceipt } from "../app/types.js";

export interface MailTransport {
  send(mailbox: MailboxConfig, payload: DraftPayload, messageId: string): Promise<SendReceipt>;
}

export class SmtpMailTransport implements MailTransport {
  constructor(readonly secrets: SecretReader) {}

  async send(mailbox: MailboxConfig, payload: DraftPayload, messageId: string): Promise<SendReceipt> {
    if (!mailbox.send_enabled || mailbox.send_transport !== "smtp" || !mailbox.smtp_host) {
      throw new MailBridgeError("Sending is not configured for this mailbox", "SEND_NOT_CONFIGURED");
    }
    const [username, password] = await Promise.all([
      this.secrets.read(mailbox.username_secret),
      this.secrets.read(mailbox.password_secret),
    ]);
    const secure = mailbox.smtp_tls_mode === "implicit";
    const transport = nodemailer.createTransport({
      host: mailbox.smtp_host,
      port: mailbox.smtp_port,
      secure,
      requireTLS: !secure,
      auth: { user: username, pass: password },
      tls: { rejectUnauthorized: true, servername: mailbox.smtp_host, minVersion: "TLSv1.2" },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    try {
      const info = await transport.sendMail({
        from: mailbox.email,
        to: payload.to,
        cc: payload.cc.length ? payload.cc : undefined,
        bcc: payload.bcc.length ? payload.bcc : undefined,
        subject: payload.subject,
        text: payload.text_body,
        messageId,
        inReplyTo: payload.in_reply_to ?? undefined,
        references: payload.references.length ? payload.references : undefined,
        date: new Date(),
      });
      return {
        mailbox_id: mailbox.id,
        message_id: String(info.messageId || messageId),
        accepted: normalizeAddresses(info.accepted),
        rejected: normalizeAddresses(info.rejected),
        sent_at: new Date().toISOString(),
      };
    } catch {
      throw new MailBridgeError("SMTP delivery failed", "SMTP_SEND_FAILED", true);
    } finally {
      transport.close();
    }
  }
}

function normalizeAddresses(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((value) => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && "address" in value) return String((value as { address: unknown }).address);
    return String(value);
  });
}
