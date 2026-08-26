#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MAILBRIDGE_WIDGET_URI } from "../app/widget.js";

const expectedTools = [
  "fetch",
  "fetch_attachment",
  "fetch_message",
  "fetch_thread",
  "list_attachments",
  "list_folders",
  "list_mailboxes",
  "list_recent_messages",
  "mailbox_health",
  "open_mailbox_settings",
  "search",
  "search_messages",
];

async function main(): Promise<void> {
  const baseUrl = (process.env.MAILBRIDGE_LOCAL_BASE_URL ?? "http://127.0.0.1:3091").replace(/\/$/, "");
  const health = await json(`${baseUrl}/health`);
  assert(health.status === "ok", "health endpoint did not return status=ok");
  const status = await json(`${baseUrl}/local-demo/status`);
  assert(status.mode === "LOCAL SYNTHETIC DEMO", "local demo status marker is missing");
  assert(status.real_mailboxes_connected === 0, "local demo reports a real mailbox");
  assert(status.smtp === false && status.write_tools === false, "local demo exposed an SMTP or write path");
  const widgetPage = await fetch(`${baseUrl}/widget`).then(async (response) => {
    assert(response.ok, `widget endpoint returned HTTP ${response.status}`);
    return response.text();
  });
  assert(widgetPage.includes("LOCAL SYNTHETIC DEMO — NO REAL MAILBOX CONNECTED"), "widget demo warning is missing");

  const client = new Client({ name: "mailbridge-local-smoke", version: "1.0.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
  await client.connect(transport);
  try {
    const discovered = await client.listTools();
    const names = discovered.tools.map((tool) => tool.name).sort();
    assert(JSON.stringify(names) === JSON.stringify(expectedTools), `expected 11 read tools plus mailbox settings, received: ${names.join(", ")}`);
    const mailReadTools = discovered.tools.filter((tool) => tool.name !== "open_mailbox_settings");
    assert(mailReadTools.length === 11 && mailReadTools.every((tool) => tool.annotations?.readOnlyHint === true), "a mail read tool is not annotated read-only");
    const settingsTool = discovered.tools.find((tool) => tool.name === "open_mailbox_settings");
    assert(settingsTool?.annotations?.readOnlyHint === false && settingsTool.annotations.destructiveHint === false,
      "mailbox settings annotations are inaccurate");
    assert(discovered.tools.every((tool) => tool.annotations?.destructiveHint === false), "a destructive tool was discovered");
    assert(!names.some((name) => /(smtp|send|store|append|move|copy|expunge|delete)/i.test(name)), "an SMTP/mail-mutation tool was discovered");

    const resources = await client.listResources();
    assert(resources.resources.some((resource) => resource.uri === MAILBRIDGE_WIDGET_URI), "widget resource was not discovered");
    const widget = await client.readResource({ uri: MAILBRIDGE_WIDGET_URI });
    const widgetText = widget.contents.map((content) => "text" in content ? content.text : "").join("\n");
    assert(widgetText.includes("LOCAL SYNTHETIC DEMO — NO REAL MAILBOX CONNECTED"), "MCP widget resource is not in demo mode");

    const listed = structured(await call(client, "list_mailboxes", {}));
    const mailboxes = asRecords(listed.mailboxes);
    assert(mailboxes.length >= 1, "synthetic mailbox list is empty");
    const mailboxIds = mailboxes.map((mailbox) => String(mailbox.mailbox_id));

    await call(client, "mailbox_health", {});
    await call(client, "list_recent_messages", {
      mailbox_ids: mailboxIds,
      folder: "INBOX",
      limit: 10,
    });
    const searched = structured(await call(client, "search_messages", {
      mailbox_ids: mailboxIds,
      free_text: "ATLAS",
      limit: 20,
    }));
    const messages = asRecords(searched.messages);
    assert(messages.length >= 1, "synthetic search returned no messages");
    const stableMessageId = String(messages[0]?.stable_message_id ?? "");
    assert(stableMessageId.startsWith("mb1."), "synthetic search returned no stable message id");

    const fetched = structured(await call(client, "fetch_message", {
      stable_message_id: stableMessageId,
      include_html: false,
      max_body_chars: 20_000,
    }));
    assert(typeof fetched.message === "object" && fetched.message !== null, "fetch_message returned no message");
    const thread = structured(await call(client, "fetch_thread", {
      stable_message_id: stableMessageId,
      max_messages: 20,
    }));
    assert(asRecords(thread.messages).length >= 1, "fetch_thread returned no messages");
    const attachments = structured(await call(client, "list_attachments", {
      stable_message_id: stableMessageId,
    }));
    assert(Array.isArray(attachments.attachments), "list_attachments returned no attachment array");

    process.stdout.write(`${JSON.stringify({
      health: "PASS",
      mcp_handshake: "PASS",
      tools: names,
      widget_resource: "PASS",
      synthetic_mailboxes: mailboxes.length,
      synthetic_search_results: messages.length,
      fetch_message: "PASS",
      fetch_thread: "PASS",
      list_attachments: "PASS",
      smtp: false,
      mail_write_tools: false,
      settings_tool: "PASS",
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
  assert(result.structuredContent && typeof result.structuredContent === "object", "tool returned no structuredContent");
  return result.structuredContent as Record<string, unknown>;
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
