#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MAILBRIDGE_SAFE_SEND_WIDGET_URI } from "../app/safeSendWidget.js";

const expectedTools = [
  "add_draft_attachment",
  "create_draft",
  "fetch",
  "fetch_attachment",
  "fetch_message",
  "fetch_thread",
  "get_send_policy",
  "get_send_status",
  "list_attachments",
  "list_folders",
  "list_mailboxes",
  "list_recent_messages",
  "list_send_audit",
  "mailbox_health",
  "open_mail_composer",
  "open_mailbox_settings",
  "prepare_draft_send",
  "reply_draft",
  "reply_email",
  "remove_draft_attachment",
  "search",
  "search_messages",
  "send_draft",
  "send_email",
  "update_draft",
  "validate_draft",
].sort();

async function main(): Promise<void> {
  const baseUrl = (process.argv[2] ?? process.env.MAILBRIDGE_LOCAL_BASE_URL ?? "http://127.0.0.1:3091").replace(/\/$/, "");
  const health = await json(`${baseUrl}/health`);
  assert(health.status === "ok", "Safe Send health endpoint is not ready");
  const beforeStatus = await json(`${baseUrl}/local-demo/status`);
  assert(beforeStatus.mode === "LOCAL SAFE SEND STAGING", "safe staging marker is missing");
  assert(beforeStatus.real_mailboxes_connected === 0, "staging reports a real mailbox");
  assert(beforeStatus.smtp === false && beforeStatus.synthetic_send === true, "staging transport invariant failed");
  const beforeSendCount = Number(beforeStatus.synthetic_send_count);
  assert(Number.isInteger(beforeSendCount) && beforeSendCount >= 0, "synthetic send counter is invalid");
  const widgetPage = await fetch(`${baseUrl}/widget`).then(async (response) => {
    assert(response.ok, `widget endpoint returned HTTP ${response.status}`);
    return response.text();
  });
  assert(widgetPage.includes("LOCAL SAFE SEND STAGING — SYNTHETIC TRANSPORT — NO REAL EMAIL"), "safe staging warning is missing");

  const client = new Client({ name: "mailbridge-v2-safe-send-smoke", version: "2.1.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
  await client.connect(transport);
  try {
    const discovered = await client.listTools();
    const names = discovered.tools.map((tool) => tool.name).sort();
    assert(JSON.stringify(names) === JSON.stringify(expectedTools), `unexpected Safe Send tools: ${names.join(", ")}`);
    const sendDraft = discovered.tools.find((tool) => tool.name === "send_draft");
    assert(sendDraft?.annotations?.destructiveHint === true && sendDraft.annotations.idempotentHint === true,
      "send_draft annotations are unsafe");

    const resources = await client.listResources();
    assert(resources.resources.some((resource) => resource.uri === MAILBRIDGE_SAFE_SEND_WIDGET_URI), "Safe Send widget resource is missing");
    const widget = await client.readResource({ uri: MAILBRIDGE_SAFE_SEND_WIDGET_URI });
    const safeWidgetText = widget.contents.map((content) => "text" in content ? content.text : "").join("\n");
    assert(safeWidgetText.includes("MailBridge Safe Send"), "Safe Send widget content is missing");

    const listed = structured(await call(client, "list_mailboxes", {}));
    const mailboxes = asRecords(listed.mailboxes);
    assert(mailboxes.length === 2, "expected two synthetic staging mailboxes");
    const mailboxId = String(mailboxes[0]?.mailbox_id ?? "");
    assert(mailboxId.startsWith("mbx_"), "synthetic mailbox id is missing");

    const created = structured(await call(client, "create_draft", {
      mailbox_id: mailboxId,
      to: ["recipient@external.synthetic.invalid"],
      subject: "MailBridge v2.1.0 synthetic Safe Send acceptance",
      text_body: "This is a synthetic transport test. No real email is sent.",
    }));
    let draft = record(created.draft, "create_draft returned no draft");
    const draftId = String(draft.draft_id ?? "");
    assert(draftId.startsWith("draft_") && Number(draft.version ?? 0) === 1, "draft identity/version is invalid");

    const attachmentBytes = Buffer.from("MailBridge synthetic attachment acceptance", "utf8");
    const attachmentBase64 = attachmentBytes.toString("base64");
    attachmentBytes.fill(0);
    const attached = structured(await call(client, "add_draft_attachment", {
      draft_id: draftId,
      expected_version: Number(draft.version),
      filename: "synthetic-acceptance.txt",
      mime_type: "text/plain",
      content_base64: attachmentBase64,
    }));
    draft = record(attached.draft, "add_draft_attachment returned no draft");
    const attachments = asRecords(draft.attachments);
    assert(attachments.length === 1 && attachments[0]?.filename === "synthetic-acceptance.txt",
      "synthetic attachment metadata is missing");
    assert(!JSON.stringify(attached).includes(attachmentBase64), "outbound attachment bytes leaked into tool output");

    await call(client, "open_mail_composer", { draft_id: draftId });
    const validation = structured(await call(client, "validate_draft", { draft_id: draftId }));
    const validationView = record(validation.validation, "validate_draft returned no validation");
    assert(validationView.blocked === false, "default synthetic draft was blocked");
    const prepared = structured(await call(client, "prepare_draft_send", { draft_id: draftId }));
    const confirmation = record(prepared.confirmation, "prepare_draft_send returned no confirmation");
    const sent = structured(await call(client, "send_draft", {
      draft_id: draftId,
      confirmation_id: String(confirmation.confirmation_id),
      expected_version: Number(confirmation.draft_version),
    }));
    const operation = record(sent.operation, "send_draft returned no operation");
    assert(operation.state === "smtp_accepted" && sent.replayed === false, "synthetic send was not accepted once");
    const replay = structured(await call(client, "send_draft", { draft_id: draftId }));
    assert(replay.replayed === true, "idempotent draft replay was not recognized");
    await call(client, "get_send_status", { operation_id: String(operation.operation_id) });
    const audit = structured(await call(client, "list_send_audit", { limit: 20 }));
    assert(asRecords(audit.events).some((event) => event.action === "MAIL_SENT"), "redacted send audit is missing");

    const direct = await client.callTool({ name: "send_email", arguments: {
      mailbox_id: mailboxId,
      to: ["recipient@external.synthetic.invalid"],
      subject: "Must remain blocked",
      text_body: "Direct send must be blocked by the default policy.",
      idempotency_key: "safe-staging-direct-block-0001",
    } });
    assert(direct.isError === true, "default draft-only policy did not block direct send");

    const afterStatus = await json(`${baseUrl}/local-demo/status`);
    const afterSendCount = Number(afterStatus.synthetic_send_count);
    assert(afterSendCount === beforeSendCount + 1, "synthetic transport count proves duplicate or missing delivery");
    assert(afterStatus.smtp === false && afterStatus.real_mailboxes_connected === 0, "real transport invariant changed");

    process.stdout.write(`${JSON.stringify({
      staging: "PASS",
      health: "PASS",
      tools: names.length,
      safe_send_widget: "PASS",
      draft_confirmation: "PASS",
      synthetic_transport_submissions: afterSendCount - beforeSendCount,
      synthetic_transport_total: afterSendCount,
      outgoing_attachment: "PASS",
      attachment_bytes_in_tool_output: 0,
      idempotent_replay: "PASS",
      direct_send_default_policy: "BLOCKED",
      real_mailboxes_connected: 0,
      smtp_connections: 0,
      real_emails_sent: 0,
    }, null, 2)}\n`);
  } finally {
    await client.close();
  }
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const result = await client.callTool({ name, arguments: args });
  assert(result.isError !== true, `${name} returned an MCP error: ${JSON.stringify(result.content)}`);
  return result as CallToolResult;
}

function structured(result: CallToolResult): Record<string, unknown> {
  return record(result.structuredContent, "tool returned no structuredContent");
}

function record(value: unknown, message: string): Record<string, unknown> {
  assert(Boolean(value) && typeof value === "object" && !Array.isArray(value), message);
  return value as Record<string, unknown>;
}

function asRecords(value: unknown): Array<Record<string, unknown>> {
  assert(Array.isArray(value), "expected an array");
  return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
}

async function json(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url);
  assert(response.ok, `${url} returned HTTP ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
