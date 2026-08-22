import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createMailBridgeServer } from "../src/server.js";
import { MAILBRIDGE_WIDGET_URI, MCP_APPS_PROTOCOL_VERSION } from "../src/widget.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => Promise.allSettled(closers.splice(0).map((close) => close())));

async function connectedClient() {
  const server = createMailBridgeServer({ publicBaseUrl: "https://mailbridge.example.test" });
  const client = new Client({ name: "mailbridge-test", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closers.push(() => client.close(), () => server.close());
  return client;
}

describe("MCP contract", () => {
  it("discovers only read-only tools with no credential inputs", async () => {
    const client = await connectedClient();
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name).sort()).toEqual([
      "fetch",
      "fetch_attachment",
      "fetch_message",
      "fetch_thread",
      "list_attachments",
      "list_folders",
      "list_mailboxes",
      "list_recent_messages",
      "mailbox_health",
      "search",
      "search_messages",
    ]);
    expect(result.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(result.tools.every((tool) => tool.annotations?.destructiveHint === false)).toBe(true);
    expect(result.tools.every((tool) => tool.annotations?.idempotentHint === true)).toBe(true);
    expect(JSON.stringify(result.tools.map((tool) => tool.inputSchema))).not.toMatch(/password|username|credential|imap_host/i);
    const structuredTools = result.tools.filter((tool) => !["search", "fetch"].includes(tool.name));
    expect(structuredTools.every((tool) => tool.outputSchema?.type === "object")).toBe(true);
  });

  it("implements the standard search and fetch response shape", async () => {
    const client = await connectedClient();
    const searched = await client.callTool({ name: "search", arguments: { query: "ATLAS" } });
    const searchContent = searched.content as Array<{ type: string; text: string }>;
    expect(searchContent).toHaveLength(1);
    const searchPayload = JSON.parse(searchContent[0]!.text) as {
      results: Array<{ id: string; title: string; url: string }>;
    };
    expect(searchPayload.results[0]).toEqual(expect.objectContaining({
      id: expect.any(String),
      title: expect.any(String),
      url: expect.any(String),
    }));
    const fetched = await client.callTool({ name: "fetch", arguments: { id: searchPayload.results[0]!.id } });
    const fetchContent = fetched.content as Array<{ type: string; text: string }>;
    expect(fetchContent).toHaveLength(1);
    expect(JSON.parse(fetchContent[0]!.text)).toEqual(expect.objectContaining({
      id: searchPayload.results[0]!.id,
      title: expect.any(String),
      text: expect.any(String),
      url: expect.any(String),
    }));
  });

  it("validates every structured result against its declared output schema", async () => {
    const client = await connectedClient();
    const calls = [
      { name: "list_mailboxes", arguments: {} },
      { name: "mailbox_health", arguments: {} },
      { name: "list_folders", arguments: {} },
      { name: "list_recent_messages", arguments: { limit: 5 } },
      { name: "search_messages", arguments: { free_text: "ATLAS", limit: 5 } },
      { name: "fetch_message", arguments: { stable_message_id: "msg_atlas_001" } },
      { name: "fetch_thread", arguments: { stable_message_id: "msg_atlas_001", max_messages: 20 } },
      { name: "list_attachments", arguments: { stable_message_id: "msg_atlas_001" } },
      {
        name: "fetch_attachment",
        arguments: { stable_message_id: "msg_atlas_001", attachment_id: "att_atlas_brief", max_bytes: 1024 },
      },
    ];
    for (const call of calls) {
      const result = await client.callTool(call);
      expect(result.isError, call.name).not.toBe(true);
      expect(result.structuredContent, call.name).toBeTypeOf("object");
    }
  });

  it("registers an MCP Apps widget resource", async () => {
    const client = await connectedClient();
    const resources = await client.listResources();
    expect(resources.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ uri: MAILBRIDGE_WIDGET_URI, mimeType: "text/html;profile=mcp-app" }),
    ]));
    const resource = await client.readResource({ uri: MAILBRIDGE_WIDGET_URI });
    expect(resource.contents[0]).toEqual(expect.objectContaining({
      uri: MAILBRIDGE_WIDGET_URI,
      mimeType: "text/html;profile=mcp-app",
    }));
    const html = (resource.contents[0] as { text?: string }).text ?? "";
    expect(html).toContain('method: "ui/initialize"');
    expect(html).toContain('method: "ui/notifications/initialized"');
    expect(html).toContain('method === "ui/notifications/tool-result"');
    expect(html).toContain(`protocolVersion: "${MCP_APPS_PROTOCOL_VERSION}"`);
  });

  it("does not change unread state after fetch", async () => {
    const client = await connectedClient();
    const before = await client.callTool({ name: "search_messages", arguments: { unread_only: true, limit: 20 } });
    const beforePayload = before.structuredContent as { messages: Array<{ stable_message_id: string; unread: boolean }> };
    const target = beforePayload.messages[0]!;
    await client.callTool({ name: "fetch_message", arguments: { stable_message_id: target.stable_message_id } });
    const after = await client.callTool({ name: "search_messages", arguments: { unread_only: true, limit: 20 } });
    const afterPayload = after.structuredContent as { messages: Array<{ stable_message_id: string; unread: boolean }> };
    expect(afterPayload.messages).toContainEqual(expect.objectContaining({ stable_message_id: target.stable_message_id, unread: true }));
  });
});
