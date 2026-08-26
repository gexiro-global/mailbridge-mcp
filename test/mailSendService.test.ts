import { afterEach, describe, expect, it } from "vitest";
import { CredentialEnvelopeCipher } from "../src/app/crypto.js";
import { MailboxStore } from "../src/app/store.js";
import type { DraftPayload, MailboxConnectionTestResult, MailboxSettings, SendPolicyInput, SendReceipt } from "../src/app/types.js";
import type { MailboxConfig } from "../src/config/schema.js";
import { MailSendService } from "../src/services/mailSendService.js";
import { MailService } from "../src/services/mailService.js";
import type { MailTransport } from "../src/send/smtpAdapter.js";
import { StableIdCodec } from "../src/security/stableId.js";
import { FakeFactory, testConfig } from "./fixtures.js";

const stores: MailboxStore[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));

describe("MailBridge Safe Send layer", () => {
  it("requires a one-time confirmation and sends an unchanged draft once", async () => {
    const { writer, transport } = setup();
    const draft = writer.createDraft(message("Synthetic draft"));

    await expect(writer.sendDraft(draft.draft_id)).rejects.toMatchObject({ code: "SEND_CONFIRMATION_REQUIRED" });
    expect(transport.sent).toHaveLength(0);

    const validation = writer.validateDraft(draft.draft_id);
    expect(validation).toMatchObject({ blocked: false, warnings: ["EXTERNAL_RECIPIENT_WARNING"] });
    const confirmation = writer.prepareDraftSend(draft.draft_id);
    const first = await writer.sendDraft(draft.draft_id, confirmation.confirmation_id, confirmation.draft_version);
    const replay = await writer.sendDraft(draft.draft_id);

    expect(first.replayed).toBe(false);
    expect(first.draft.status).toBe("sent");
    expect(first.operation.state).toBe("smtp_accepted");
    expect(replay.replayed).toBe(true);
    expect(replay.receipt.message_id).toBe(first.receipt.message_id);
    expect(transport.sent).toHaveLength(1);
    expect(writer.listSendAudit()).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "MAIL_SENT", result: "PASS", state: "smtp_accepted" }),
      expect.objectContaining({ action: "SEND_CONFIRMATION_PREPARED", result: "PASS" }),
    ]));
  });

  it("invalidates confirmation when the draft changes", async () => {
    const { writer, transport } = setup();
    const draft = writer.createDraft(message("Original"));
    const confirmation = writer.prepareDraftSend(draft.draft_id);
    const changed = writer.updateDraft(draft.draft_id, draft.version, message("Changed"));

    await expect(writer.sendDraft(draft.draft_id, confirmation.confirmation_id, changed.version))
      .rejects.toMatchObject({ code: "SEND_CONFIRMATION_INVALID" });
    expect(transport.sent).toHaveLength(0);
  });

  it("blocks direct send by default and permits it only with an explicit direct policy", async () => {
    const { writer, transport } = setup();
    await expect(writer.sendEmail(message("Direct blocked"), "direct-blocked-0001"))
      .rejects.toMatchObject({ code: "DRAFT_CONFIRMATION_REQUIRED" });

    writer.updateSendPolicy("mbx_demo_gmail", policy({ send_mode: "direct_allowed" }));
    const first = await writer.sendEmail(message("Direct allowed"), "direct-allowed-0001");
    const replay = await writer.sendEmail(message("Direct allowed"), "direct-allowed-0001");

    expect(first.operation.state).toBe("smtp_accepted");
    expect(replay.replayed).toBe(true);
    expect(transport.sent).toHaveLength(1);
  });

  it("enforces deny lists, external-recipient policy and recipient limits before SMTP", () => {
    const { writer, transport } = setup();
    writer.updateSendPolicy("mbx_demo_gmail", policy({
      denied_domains: ["example.invalid"],
      external_recipients: "block",
      max_recipients: 1,
    }));
    const draft = writer.createDraft({
      ...message("Blocked"),
      to: ["one@example.invalid", "two@example.invalid"],
    });
    const validation = writer.validateDraft(draft.draft_id);

    expect(validation.blocked).toBe(true);
    expect(validation.reasons).toEqual(expect.arrayContaining([
      "RECIPIENT_LIMIT_EXCEEDED",
      "RECIPIENT_DOMAIN_DENIED",
      "EXTERNAL_RECIPIENT_BLOCKED",
    ]));
    expect(() => writer.prepareDraftSend(draft.draft_id)).toThrowError(/blocked/i);
    expect(transport.sent).toHaveLength(0);
  });

  it("reserves concurrent direct sends atomically and delivers only once", async () => {
    const gate = deferred<void>();
    const { writer, transport } = setup({ gate: gate.promise });
    writer.updateSendPolicy("mbx_demo_gmail", policy({ send_mode: "direct_allowed" }));
    const first = writer.sendEmail(message("Concurrent"), "concurrent-0001");
    await transport.started;
    const second = writer.sendEmail(message("Concurrent"), "concurrent-0001");

    await expect(second).rejects.toMatchObject({ code: "SEND_ALREADY_SUBMITTING" });
    gate.resolve();
    await expect(first).resolves.toMatchObject({ replayed: false, operation: { state: "smtp_accepted" } });
    expect(transport.sent).toHaveLength(1);
  });

  it("moves an uncertain SMTP result to unknown and blocks automatic retry", async () => {
    const { writer, transport } = setup({ fail: true });
    writer.updateSendPolicy("mbx_demo_gmail", policy({ send_mode: "direct_allowed" }));

    await expect(writer.sendEmail(message("Unknown"), "unknown-0001"))
      .rejects.toMatchObject({ code: "SEND_STATUS_UNKNOWN" });
    await expect(writer.sendEmail(message("Unknown"), "unknown-0001"))
      .rejects.toMatchObject({ code: "SEND_STATUS_UNKNOWN" });
    expect(transport.sent).toHaveLength(1);
    expect(writer.listSendAudit()).toContainEqual(expect.objectContaining({
      action: "SEND_OUTCOME_UNKNOWN",
      result: "FAIL",
      state: "unknown",
    }));
  });

  it("enforces durable per-mailbox send rate limits", async () => {
    const { writer, transport } = setup();
    writer.updateSendPolicy("mbx_demo_gmail", policy({
      send_mode: "direct_allowed",
      max_per_hour: 1,
      max_per_day: 1,
    }));
    await writer.sendEmail(message("First"), "rate-0001");
    await expect(writer.sendEmail(message("Second"), "rate-0002"))
      .rejects.toMatchObject({ code: "SEND_POLICY_BLOCKED" });
    expect(transport.sent).toHaveLength(1);
  });

  it("builds reply threading from Message-ID, In-Reply-To and References", async () => {
    const { writer, transport, mail } = setup();
    const searched = await mail.searchMessages({ mailbox_ids: ["mbx_demo_gmail"], subject: "Example", limit: 1 });
    const stableId = searched.messages[0]!.stable_message_id;
    const draft = await writer.createReplyDraft({
      mailbox_id: "mbx_demo_gmail",
      stable_message_id: stableId,
      text_body: "Synthetic reply",
    });
    expect(draft.to).toEqual(["sender@example.invalid"]);
    expect(draft.in_reply_to).toBe("<message-42@example.invalid>");
    expect(draft.references).toEqual([
      "<message-40@example.invalid>",
      "<message-41@example.invalid>",
      "<message-42@example.invalid>",
    ]);
    expect(draft.subject).toBe("Re: Example response");
    const confirmation = writer.prepareDraftSend(draft.draft_id);
    await writer.sendDraft(draft.draft_id, confirmation.confirmation_id, confirmation.draft_version);
    expect(transport.sent[0]!.payload.in_reply_to).toBe("<message-42@example.invalid>");
  });
});

class FakeTransport implements MailTransport {
  readonly sent: Array<{ mailbox: MailboxConfig; payload: DraftPayload; messageId: string }> = [];
  readonly #started = deferred<void>();

  constructor(readonly options: { fail?: boolean; gate?: Promise<void> } = {}) {}

  get started(): Promise<void> {
    return this.#started.promise;
  }

  async send(mailbox: MailboxConfig, payload: DraftPayload, messageId: string): Promise<SendReceipt> {
    this.sent.push({ mailbox, payload, messageId });
    this.#started.resolve();
    if (this.options.gate) await this.options.gate;
    if (this.options.fail) throw new Error("synthetic transport uncertainty");
    return {
      mailbox_id: mailbox.id,
      message_id: messageId,
      accepted: payload.to,
      rejected: [],
      sent_at: "2026-08-24T12:00:00.000Z",
    };
  }
}

function setup(options: { fail?: boolean; gate?: Promise<void> } = {}): { writer: MailSendService; transport: FakeTransport; mail: MailService } {
  const store = new MailboxStore(":memory:", new CredentialEnvelopeCipher("v1", new Map([["v1", Buffer.alloc(32, 7)]])));
  stores.push(store);
  store.create("user-a", "mbx_demo_gmail", settings, { username: "synthetic", password: "synthetic" }, passResult);
  const config = structuredClone(testConfig);
  config.mailboxes = [{
    ...config.mailboxes[0]!,
    id: "mbx_demo_gmail",
    display_name: "Demo — Gmail",
    email: "operator@gmail.example.invalid",
    send_enabled: true,
    send_transport: "smtp",
    smtp_host: "smtp.gmail.com",
    smtp_port: 465,
    smtp_tls_mode: "implicit",
  }];
  const mail = new MailService(config, new FakeFactory(), new StableIdCodec("0123456789abcdef0123456789abcdef"));
  const transport = new FakeTransport(options);
  return { writer: new MailSendService("user-a", store, mail, transport), transport, mail };
}

function message(subject: string): { mailbox_id: string; to: string[]; subject: string; text_body: string } {
  return {
    mailbox_id: "mbx_demo_gmail",
    to: ["recipient@example.invalid"],
    subject,
    text_body: "Synthetic body",
  };
}

function policy(overrides: Partial<SendPolicyInput> = {}): SendPolicyInput {
  return {
    send_mode: "draft_only",
    require_confirmation: true,
    allowed_domains: [],
    denied_domains: [],
    max_recipients: 10,
    max_per_hour: 20,
    max_per_day: 100,
    external_recipients: "warn",
    confirmation_ttl_seconds: 180,
    ...overrides,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const settings: MailboxSettings = {
  display_name: "Demo — Gmail",
  email: "operator@gmail.example.invalid",
  brand: "PRIVATE",
  purpose: "Synthetic test",
  imap_host: "imap.gmail.com",
  imap_port: 993,
  tls_mode: "implicit",
  allowed_folders: ["INBOX"],
  send_enabled: true,
  send_transport: "smtp",
  smtp_host: "smtp.gmail.com",
  smtp_port: 465,
  smtp_tls_mode: "implicit",
  enabled: true,
};

const passResult: MailboxConnectionTestResult = {
  status: "PASS",
  dns_resolution: { success: true, address_count: 1 },
  tcp_connection: { success: true, latency_ms: 1 },
  tls_verification: { success: true, mode: "implicit", certificate: null },
  authentication: { success: true },
  examine: { success: true },
  folder_discovery: { success: true, folders: [] },
  body_peek: { success: true, flags_before: [], flags_after: [], unchanged: true, reason: "BODY_PEEK_FLAGS_UNCHANGED" },
  latency_ms: 1,
  error_category: null,
};
