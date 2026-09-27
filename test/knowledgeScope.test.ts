import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createMailBridgeMcpServer } from "../src/mcp/server.js";
import { MailBridgeError } from "../src/domain/errors.js";
import { StableIdCodec } from "../src/security/stableId.js";
import { MailService } from "../src/services/mailService.js";
import { parseKnowledgeQuery, selectScopedMailboxes } from "../src/services/knowledgeScope.js";
import { FakeFactory, testConfig } from "./fixtures.js";

const KEY = "0123456789abcdef0123456789abcdef";
const codec = new StableIdCodec(KEY);
const service = () => new MailService(testConfig, new FakeFactory(), new StableIdCodec(KEY));
const mailboxesOf = (results: Array<{ id: string }>) => [...new Set(results.map((result) => codec.decode(result.id).mailbox_id))].sort();

describe("knowledge query scope parser", () => {
  it("returns the query unchanged when no scope token is present", () => {
    expect(parseKnowledgeQuery("invoice from june")).toEqual({ free_text: "invoice from june", scopes: [] });
  });

  it("extracts and strips inline mailbox scope tokens", () => {
    expect(parseKnowledgeQuery("mailbox:brand_b invoice")).toEqual({ free_text: "invoice", scopes: ["brand_b"] });
    expect(parseKnowledgeQuery("invoice mailbox:brand_b")).toEqual({ free_text: "invoice", scopes: ["brand_b"] });
    expect(parseKnowledgeQuery("MAILBOX:Brand_B invoice")).toEqual({ free_text: "invoice", scopes: ["brand_b"] });
  });

  it("supports several scopes and quoted values without duplicating them", () => {
    expect(parseKnowledgeQuery('mailbox:brand_a mailbox:"Brand B" mailbox:brand_a report')).toEqual({
      free_text: "report",
      scopes: ["brand_a", "brand b"],
    });
  });

  it("ignores scope fragments that are too short to be selective", () => {
    expect(parseKnowledgeQuery("mailbox:a report")).toEqual({ free_text: "report", scopes: [] });
  });
});

describe("mailbox scope selection", () => {
  const mailboxes = testConfig.mailboxes;

  it("matches by id, brand, email and display name", () => {
    expect(selectScopedMailboxes(mailboxes, ["brand_b"]).map((mailbox) => mailbox.id)).toEqual(["brand_b"]);
    expect(selectScopedMailboxes(mailboxes, ["BRAND_B"]).map((mailbox) => mailbox.id)).toEqual(["brand_b"]);
    expect(selectScopedMailboxes(mailboxes, ["operator@brand-b.example.invalid"]).map((mailbox) => mailbox.id)).toEqual(["brand_b"]);
    expect(selectScopedMailboxes(mailboxes, ["Brand B"]).map((mailbox) => mailbox.id)).toEqual(["brand_b"]);
  });

  it("returns nothing for an unknown scope instead of falling back to every mailbox", () => {
    expect(selectScopedMailboxes(mailboxes, ["unknown-brand"])).toEqual([]);
    expect(selectScopedMailboxes(mailboxes, [])).toEqual([]);
  });
});

describe("searchKnowledge scoping", () => {
  it("searches every enabled mailbox when no scope is given", async () => {
    const searched = await service().searchKnowledge("Example");
    expect(mailboxesOf(searched.results)).toEqual(["brand_a", "brand_b"]);
  });

  it("limits the fan-out to the mailbox_ids argument", async () => {
    const searched = await service().searchKnowledge("Example", { mailbox_ids: ["brand_b"] });
    expect(mailboxesOf(searched.results)).toEqual(["brand_b"]);
  });

  it("limits the fan-out to an inline mailbox scope token", async () => {
    const searched = await service().searchKnowledge("mailbox:brand_a Example");
    expect(mailboxesOf(searched.results)).toEqual(["brand_a"]);
  });

  it("accepts a brand as the scope", async () => {
    const searched = await service().searchKnowledge("Example", { mailbox_ids: ["BRAND_A"] });
    expect(mailboxesOf(searched.results)).toEqual(["brand_a"]);
  });

  it("rejects an unknown scope instead of silently searching everything", async () => {
    await expect(service().searchKnowledge("Example", { mailbox_ids: ["nonexistent"] })).rejects.toMatchObject({
      code: "MAILBOX_SCOPE_NOT_FOUND",
    });
  });

  it("still rejects a query that carries no narrowing text after scope extraction", async () => {
    await expect(service().searchKnowledge("mailbox:brand_a")).rejects.toBeInstanceOf(MailBridgeError);
  });
});

describe("search tool contract", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => { await Promise.all(closers.splice(0).map((close) => close())); });

  const connect = async () => {
    const server = createMailBridgeMcpServer(service(), true);
    const client = new Client({ name: "scope-test", version: "1.0.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closers.push(() => client.close(), () => server.close());
    return client;
  };

  it("advertises an optional mailbox_ids scope on the search tool", async () => {
    const client = await connect();
    const tools = await client.listTools();
    const search = tools.tools.find((tool) => tool.name === "search");
    expect(search?.description?.startsWith("Use this")).toBe(true);
    expect(search?.inputSchema).toMatchObject({ properties: { query: expect.any(Object), mailbox_ids: expect.any(Object) } });
    expect((search?.inputSchema as { required?: string[] }).required).toEqual(["query"]);
    expect(search?.outputSchema).toMatchObject({ properties: { results: expect.any(Object), partial_failures: expect.any(Object), truncated: expect.any(Object) } });
    expect(tools.tools).toHaveLength(15);
  });

  it("scopes results to mailbox_ids over the MCP protocol", async () => {
    const client = await connect();
    const scoped = await client.callTool({ name: "search", arguments: { query: "Example", mailbox_ids: ["brand_b"] } });
    const payload = JSON.parse((scoped.content as Array<{ text: string }>)[0]!.text) as { results: Array<{ id: string }> };
    expect(payload.results.length).toBeGreaterThan(0);
    expect(mailboxesOf(payload.results)).toEqual(["brand_b"]);
    expect(payload).toEqual(expect.objectContaining({ partial_failures: [], truncated: false }));

    const unscoped = await client.callTool({ name: "search", arguments: { query: "Example" } });
    const allPayload = JSON.parse((unscoped.content as Array<{ text: string }>)[0]!.text) as { results: Array<{ id: string }> };
    expect(mailboxesOf(allPayload.results)).toEqual(["brand_a", "brand_b"]);
  });
});

describe("search scope hardening", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => { await Promise.all(closers.splice(0).map((close) => close())); });

  const connect = async () => {
    const server = createMailBridgeMcpServer(service(), true);
    const client = new Client({ name: "scope-hardening", version: "1.0.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closers.push(() => client.close(), () => server.close());
    return client;
  };

  const withDisabled = () => {
    const config = structuredClone(testConfig);
    config.mailboxes[1]!.enabled = false;
    return new MailService(config, new FakeFactory(), new StableIdCodec(KEY));
  };

  it("keeps the parser stateless across repeated calls on the same input", () => {
    const input = "mailbox:brand_a quarterly report";
    const first = parseKnowledgeQuery(input);
    const second = parseKnowledgeQuery(input);
    const third = parseKnowledgeQuery(input);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("leaves a bare mailbox marker and punctuation in the free text", () => {
    expect(parseKnowledgeQuery("mailbox: report")).toEqual({ free_text: "mailbox: report", scopes: [] });
    expect(parseKnowledgeQuery("contract mailbox:brand_b, please")).toEqual({ free_text: "contract please", scopes: ["brand_b"] });
    expect(selectScopedMailboxes(testConfig.mailboxes, parseKnowledgeQuery("contract mailbox:brand_b, please").scopes).map((mailbox) => mailbox.id)).toEqual(["brand_b"]);
  });

  it("parses a maximum-length query with many scope tokens without hanging", () => {
    const raw = `${"mailbox:brand_a ".repeat(20)}${"x".repeat(100)}`.slice(0, 500);
    const started = Date.now();
    const parsed = parseKnowledgeQuery(raw);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(parsed.scopes).toEqual(["brand_a"]);
  });

  it("treats an empty scope array at the service layer as no scope", async () => {
    const searched = await service().searchKnowledge("Example", { mailbox_ids: [] });
    expect(mailboxesOf(searched.results)).toEqual(["brand_a", "brand_b"]);
  });

  it("returns a complete empty search envelope when all mailboxes are disabled", async () => {
    const config = structuredClone(testConfig);
    for (const mailbox of config.mailboxes) mailbox.enabled = false;
    const empty = new MailService(config, new FakeFactory(), new StableIdCodec(KEY));
    expect(await empty.searchKnowledge("Example")).toEqual({
      results: [], partial_failures: [], truncated: false,
    });
  });

  it("never selects a disabled mailbox and refuses the scope instead", async () => {
    await expect(withDisabled().searchKnowledge("Example", { mailbox_ids: ["brand_b"] })).rejects.toMatchObject({ code: "MAILBOX_SCOPE_NOT_FOUND" });
    const searched = await withDisabled().searchKnowledge("Example");
    expect(mailboxesOf(searched.results)).toEqual(["brand_a"]);
  });

  it("expands a shared scope fragment to every matching mailbox", async () => {
    const searched = await service().searchKnowledge("Example", { mailbox_ids: ["brand"] });
    expect(mailboxesOf(searched.results)).toEqual(["brand_a", "brand_b"]);
  });

  it("intersects explicit and inline scopes instead of widening them", async () => {
    await expect(service().searchKnowledge("mailbox:brand_b Example", { mailbox_ids: ["brand_a"] }))
      .rejects.toMatchObject({ code: "MAILBOX_SCOPE_NOT_FOUND" });
    const matching = await service().searchKnowledge("mailbox:brand_a Example", { mailbox_ids: ["brand_a"] });
    expect(mailboxesOf(matching.results)).toEqual(["brand_a"]);
  });

  it("rejects a mixed known and unknown scope", async () => {
    await expect(service().searchKnowledge("Example", { mailbox_ids: ["brand_a", "does_not_exist"] }))
      .rejects.toMatchObject({ code: "MAILBOX_SCOPE_NOT_FOUND" });
  });

  it("rejects an empty or oversized mailbox_ids array at the MCP boundary", async () => {
    const client = await connect();
    const empty = await client.callTool({ name: "search", arguments: { query: "Example", mailbox_ids: [] } }).catch((error: unknown) => ({ isError: true, error }));
    expect((empty as { isError?: boolean }).isError).toBe(true);
    const oversized = await client.callTool({
      name: "search",
      arguments: { query: "Example", mailbox_ids: Array.from({ length: 21 }, (_value, index) => `brand_${index}`) },
    }).catch((error: unknown) => ({ isError: true, error }));
    expect((oversized as { isError?: boolean }).isError).toBe(true);
  });

  it("returns ids from a scoped search that fetch can still resolve", async () => {
    const client = await connect();
    const scoped = await client.callTool({ name: "search", arguments: { query: "Example", mailbox_ids: ["brand_a"] } });
    const payload = JSON.parse((scoped.content as Array<{ text: string }>)[0]!.text) as { results: Array<{ id: string }> };
    const fetched = await client.callTool({ name: "fetch", arguments: { id: payload.results[0]!.id } });
    expect(fetched.isError).not.toBe(true);
    expect(JSON.parse((fetched.content as Array<{ text: string }>)[0]!.text)).toEqual(expect.objectContaining({ id: payload.results[0]!.id }));
  });
});
