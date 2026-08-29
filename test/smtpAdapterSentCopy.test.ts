import { describe, expect, it } from "vitest";
import type { DraftPayload, SentCopyResult } from "../src/app/types.js";
import type { MailboxConfig } from "../src/config/schema.js";
import { SmtpMailTransport, type SmtpSender, type SmtpSenderFactory } from "../src/send/smtpAdapter.js";
import type { SentCopyWriter } from "../src/send/sentCopy.js";

describe("SMTP transport Sent-copy integration", () => {
  it("sends and stores the exact same MIME bytes while keeping Bcc out of headers", async () => {
    const sender = new FakeSender();
    const copy = new FakeSentCopy({ state: "imap_appended", folder: "Sent", attempts: 1, error_code: null });
    const transport = createTransport(copy, () => sender);
    const receipt = await transport.send(mailbox, payload, "<stable@example.invalid>");

    expect(receipt.sent_copy).toEqual({ state: "imap_appended", folder: "Sent", attempts: 1, error_code: null });
    expect(receipt.message_id).toBe("<stable@example.invalid>");
    expect(copy.raw).toEqual(sender.raw);
    const raw = copy.raw!.toString("utf8");
    expect(raw).toContain("Message-ID: <stable@example.invalid>");
    expect(raw).toContain("evidence.txt");
    expect(raw).not.toMatch(/^Bcc:/mi);
    expect(sender.envelope).toEqual({
      from: "sender@example.invalid",
      to: ["to@example.invalid", "cc@example.invalid", "hidden@example.invalid"],
    });
  });

  it("reports a failed Sent copy without changing SMTP acceptance", async () => {
    const sender = new FakeSender();
    const copy = new FakeSentCopy({ state: "failed", folder: "Sent", attempts: 3, error_code: "SENT_COPY_TIMEOUT" });
    const receipt = await createTransport(copy, () => sender).send(mailbox, payload, "<stable@example.invalid>");

    expect(receipt.accepted).toEqual(["to@example.invalid"]);
    expect(receipt.sent_copy?.state).toBe("failed");
    expect(sender.calls).toBe(1);
  });

  it("does not attempt a Sent copy when SMTP fails", async () => {
    const sender = new FakeSender(true);
    const copy = new FakeSentCopy({ state: "imap_appended", folder: "Sent", attempts: 1, error_code: null });
    await expect(createTransport(copy, () => sender).send(mailbox, payload, "<stable@example.invalid>"))
      .rejects.toMatchObject({ code: "SMTP_SEND_FAILED" });
    expect(copy.calls).toBe(0);
  });

  it("keeps Sent copy disabled outside the mailbox canary allowlist", async () => {
    const sender = new FakeSender();
    const copy = new FakeSentCopy({ state: "imap_appended", folder: "Sent", attempts: 1, error_code: null });
    const transport = new SmtpMailTransport(
      { read: async (reference) => reference.includes("username") ? "synthetic-user" : "synthetic-password" },
      copy,
      () => sender,
      new Set(["mbx_other"]),
      syntheticEndpoint,
    );
    const receipt = await transport.send(mailbox, payload, "<stable@example.invalid>");
    expect(receipt.sent_copy?.state).toBe("disabled");
    expect(copy.calls).toBe(0);
  });
});

function createTransport(copy: SentCopyWriter, factory: SmtpSenderFactory): SmtpMailTransport {
  return new SmtpMailTransport(
    { read: async (reference) => reference.includes("username") ? "synthetic-user" : "synthetic-password" },
    copy,
    factory,
    null,
    syntheticEndpoint,
  );
}

async function syntheticEndpoint(hostname: string) {
  return { hostname, address: "93.184.216.34", family: 4 as const, address_count: 1 };
}

class FakeSender implements SmtpSender {
  calls = 0;
  raw: Buffer | null = null;
  envelope: unknown;

  constructor(readonly fail = false) {}

  async sendMail(options: Record<string, unknown>): Promise<{ messageId: string; accepted: string[]; rejected: string[] }> {
    this.calls += 1;
    this.raw = Buffer.from(options.raw as Buffer);
    this.envelope = options.envelope;
    if (this.fail) throw new Error("synthetic SMTP failure");
    return { messageId: "<transport-generated@example.invalid>", accepted: ["to@example.invalid"], rejected: [] };
  }
  close(): void {}
}

class FakeSentCopy implements SentCopyWriter {
  calls = 0;
  raw: Buffer | null = null;
  constructor(readonly result: SentCopyResult) {}
  async save(_mailbox: MailboxConfig, raw: Buffer): Promise<SentCopyResult> {
    this.calls += 1;
    this.raw = Buffer.from(raw);
    return this.result;
  }
}

const mailbox: MailboxConfig = {
  id: "mbx_synthetic",
  display_name: "Synthetic",
  email: "sender@example.invalid",
  brand: "OTHER",
  purpose: "Synthetic SMTP test",
  imap_host: "imap.example.invalid",
  imap_port: 993,
  tls: true,
  username_secret: "synthetic_username",
  password_secret: "synthetic_password",
  send_enabled: true,
  send_transport: "smtp",
  smtp_host: "smtp.example.invalid",
  smtp_port: 465,
  smtp_tls_mode: "implicit",
  enabled: true,
  folder_access: "all_selectable",
  allowed_folders: ["INBOX"],
  result_limit: 50,
  tags: [],
  brand_hints: { organisation_names: [], domains: [], private: false },
};

const payload: DraftPayload = {
  mailbox_id: "mbx_synthetic",
  to: ["to@example.invalid"],
  cc: ["cc@example.invalid"],
  bcc: ["hidden@example.invalid"],
  subject: "Synthetic Sent copy",
  text_body: "Synthetic body",
  in_reply_to: null,
  references: [],
  attachments: [{
    attachment_id: "datt_0123456789abcdef0123456789abcdef",
    filename: "evidence.txt",
    mime_type: "text/plain",
    size: 9,
    sha256: "0".repeat(64),
    content_base64: Buffer.from("evidence!", "utf8").toString("base64"),
  }],
};
