import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { CredentialEnvelopeCipher } from "../src/app/crypto.js";
import { MailboxStore } from "../src/app/store.js";
import type { DraftPayload, MailboxConnectionTestResult, MailboxSettings, SendReceipt } from "../src/app/types.js";
import type { MailboxConfig } from "../src/config/schema.js";
import { createMailBridgeMcpServer } from "../src/mcp/server.js";
import { StableIdCodec } from "../src/security/stableId.js";
import type { MailTransport } from "../src/send/smtpAdapter.js";
import { MailSendService } from "../src/services/mailSendService.js";
import { MailService } from "../src/services/mailService.js";
import { FakeFactory, testConfig } from "./fixtures.js";

const close: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const action of close.splice(0).reverse()) await action();
});

describe("Safe Send MCP end-to-end", () => {
  it("executes create, preview, validate, confirm and one synthetic SMTP submission", async () => {
    const config = structuredClone(testConfig);
    config.mailboxes = [{
      ...config.mailboxes[0]!,
      id: "mbx_safe_send_test",
      email: "sender@example.invalid",
      send_enabled: true,
      send_transport: "smtp",
      smtp_host: "smtp.example.invalid",
      smtp_port: 465,
      smtp_tls_mode: "implicit",
    }];
    const store = new MailboxStore(":memory:", new CredentialEnvelopeCipher("v1", new Map([["v1", Buffer.alloc(32, 9)]])));
    close.push(() => store.close());
    store.create("user-safe-send", "mbx_safe_send_test", settings, { username: "synthetic", password: "synthetic" }, passResult);
    const mail = new MailService(config, new FakeFactory(), new StableIdCodec("0123456789abcdef0123456789abcdef"));
    const transport = new FakeTransport();
    const writer = new MailSendService("user-safe-send", store, mail, transport);
    const server = createMailBridgeMcpServer(mail, true, undefined, writer);
    const client = new Client({ name: "safe-send-e2e", version: "1.0.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    close.push(() => client.close(), () => server.close());

    const created = await client.callTool({ name: "create_draft", arguments: {
      mailbox_id: "mbx_safe_send_test",
      to: ["recipient@example.invalid"],
      subject: "Synthetic Safe Send E2E",
      text_body: "No real email is sent.",
    } });
    const draft = (created.structuredContent as { draft: { draft_id: string; version: number } }).draft;

    const opened = await client.callTool({ name: "open_mail_composer", arguments: { draft_id: draft.draft_id } });
    expect(opened.structuredContent).toMatchObject({ draft: { draft_id: draft.draft_id }, policy: { send_mode: "draft_only" } });
    const validated = await client.callTool({ name: "validate_draft", arguments: { draft_id: draft.draft_id } });
    expect(validated.structuredContent).toMatchObject({ validation: { blocked: false, draft_version: draft.version } });
    const prepared = await client.callTool({ name: "prepare_draft_send", arguments: { draft_id: draft.draft_id } });
    const confirmation = (prepared.structuredContent as { confirmation: { confirmation_id: string; draft_version: number } }).confirmation;
    const sent = await client.callTool({ name: "send_draft", arguments: {
      draft_id: draft.draft_id,
      confirmation_id: confirmation.confirmation_id,
      expected_version: confirmation.draft_version,
    } });

    expect(sent.structuredContent).toMatchObject({
      draft: { status: "sent" },
      operation: { state: "smtp_accepted", accepted_count: 1, rejected_count: 0 },
      replayed: false,
    });
    expect(transport.sent).toBe(1);
  });
});

class FakeTransport implements MailTransport {
  sent = 0;

  async send(mailbox: MailboxConfig, payload: DraftPayload, messageId: string): Promise<SendReceipt> {
    this.sent += 1;
    return {
      mailbox_id: mailbox.id,
      message_id: messageId,
      accepted: [...payload.to, ...payload.cc, ...payload.bcc],
      rejected: [],
      sent_at: "2026-08-25T13:00:00.000Z",
    };
  }
}

const settings: MailboxSettings = {
  display_name: "Synthetic Safe Send",
  email: "sender@example.invalid",
  brand: "OTHER",
  purpose: "Synthetic MCP test only",
  imap_host: "imap.example.invalid",
  imap_port: 993,
  tls_mode: "implicit",
  allowed_folders: ["INBOX"],
  send_enabled: true,
  send_transport: "smtp",
  smtp_host: "smtp.example.invalid",
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
