import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createMailBridgeMcpServer } from "../src/mcp/server.js";
import { StableIdCodec } from "../src/security/stableId.js";
import { MailService } from "../src/services/mailService.js";
import { FakeFactory, testConfig } from "./fixtures.js";
import type { MailSendService } from "../src/services/mailSendService.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(closers.splice(0).map((close) => close())));

describe("MCP contract", () => {
  it("discovers the complete read-only tool surface", async () => {
    const service = new MailService(testConfig, new FakeFactory(), new StableIdCodec("0123456789abcdef0123456789abcdef"));
    const server = createMailBridgeMcpServer(service, true);
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closers.push(() => client.close(), () => server.close());

    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name).sort()).toEqual([
      "fetch", "fetch_attachment", "fetch_message", "fetch_thread", "list_attachments", "list_folders", "list_mailboxes", "list_recent_messages", "mailbox_health", "search", "search_messages",
    ]);
    expect(result.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(result.tools.every((tool) => tool.annotations?.destructiveHint === false)).toBe(true);
    expect(result.tools.every((tool) => tool.annotations?.idempotentHint === true)).toBe(true);
    expect(result.tools.find((tool) => tool.name === "list_mailboxes")?.annotations?.openWorldHint).toBe(false);
    expect(result.tools.filter((tool) => tool.name !== "list_mailboxes").every((tool) => tool.annotations?.openWorldHint === true)).toBe(true);
    expect(result.tools.every((tool) => tool.description?.startsWith("Use this"))).toBe(true);
    expect(JSON.stringify(result.tools.map((tool) => tool.inputSchema))).not.toMatch(/password|username|credential/i);
  });

  it("exposes the Safe Send contracts with accurate annotations only when the send layer is enabled", async () => {
    const service = new MailService(testConfig, new FakeFactory(), new StableIdCodec("0123456789abcdef0123456789abcdef"));
    const writer = {} as MailSendService;
    const server = createMailBridgeMcpServer(service, true, undefined, writer);
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closers.push(() => client.close(), () => server.close());

    const result = await client.listTools();
    const byName = new Map(result.tools.map((tool) => [tool.name, tool]));
    const safeSendTools = [
      "open_mail_composer", "update_draft", "get_send_policy", "validate_draft", "prepare_draft_send",
      "get_send_status", "list_send_audit", "create_draft", "reply_draft", "send_draft", "send_email", "reply_email",
    ];
    expect([...byName.keys()].filter((name) => safeSendTools.includes(name)).sort()).toEqual([
      "create_draft", "get_send_policy", "get_send_status", "list_send_audit", "open_mail_composer",
      "prepare_draft_send", "reply_draft", "reply_email", "send_draft", "send_email", "update_draft", "validate_draft",
    ]);
    expect(result.tools).toHaveLength(23);
    expect(result.tools.every((tool) => tool.description?.startsWith("Use this"))).toBe(true);
    for (const name of ["open_mail_composer", "get_send_policy", "validate_draft", "get_send_status", "list_send_audit"]) {
      expect(byName.get(name)?.annotations).toEqual(expect.objectContaining({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }));
    }
    for (const name of ["create_draft", "reply_draft", "update_draft", "prepare_draft_send"]) {
      expect(byName.get(name)?.annotations).toEqual(expect.objectContaining({ readOnlyHint: false, destructiveHint: false, openWorldHint: false }));
    }
    for (const name of ["send_draft", "send_email", "reply_email"]) {
      expect(byName.get(name)?.annotations).toEqual(expect.objectContaining({ readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: true }));
    }
    expect(byName.get("send_draft")?.inputSchema).toMatchObject({
      properties: {
        confirmation_id: expect.any(Object),
        expected_version: expect.any(Object),
      },
    });
    expect(byName.get("search")?.outputSchema).toBeDefined();
    expect(byName.get("fetch")?.outputSchema).toBeDefined();
  });

  it("implements the standard search and fetch knowledge contracts", async () => {
    const service = new MailService(testConfig, new FakeFactory(), new StableIdCodec("0123456789abcdef0123456789abcdef"));
    const server = createMailBridgeMcpServer(service, true);
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closers.push(() => client.close(), () => server.close());

    const searched = await client.callTool({ name: "search", arguments: { query: "Example" } });
    expect(searched.content).toHaveLength(1);
    const searchPayload = JSON.parse((searched.content[0] as { text: string }).text) as {
      results: Array<{ id: string; title: string; url: string }>;
    };
    expect(searchPayload.results.length).toBeGreaterThan(0);
    expect(searchPayload.results[0]).toEqual(expect.objectContaining({
      id: expect.any(String), title: expect.any(String), url: expect.any(String),
    }));

    const fetched = await client.callTool({ name: "fetch", arguments: { id: searchPayload.results[0]!.id } });
    expect(fetched.content).toHaveLength(1);
    expect(JSON.parse((fetched.content[0] as { text: string }).text)).toEqual(expect.objectContaining({
      id: searchPayload.results[0]!.id,
      title: expect.any(String),
      text: expect.any(String),
      url: expect.any(String),
    }));
  });

  it("calls a tool over the MCP protocol", async () => {
    const service = new MailService(testConfig, new FakeFactory(), new StableIdCodec("0123456789abcdef0123456789abcdef"));
    const server = createMailBridgeMcpServer(service, true);
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closers.push(() => client.close(), () => server.close());

    const result = await client.callTool({ name: "list_mailboxes", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toHaveProperty("mailboxes");
  });
});
