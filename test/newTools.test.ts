import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createMailBridgeMcpServer } from "../src/mcp/server.js";
import { StableIdCodec } from "../src/security/stableId.js";
import { MailService } from "../src/services/mailService.js";
import { summarizeAuthentication } from "../src/services/messageAuth.js";
import { FakeFactory, rawMessage, testConfig } from "./fixtures.js";

const KEY = "0123456789abcdef0123456789abcdef";
const SOURCE = Buffer.from("Received: from mx.example.invalid\r\nSubject: Example response\r\n\r\nbody", "utf8");
const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map((close) => close())); });

function build() {
  const factory = new FakeFactory();
  factory.messages.set("brand_a", [rawMessage({
    folder: "INBOX",
    uid: 1,
    source: SOURCE,
    headers: {
      "received": ["from mx.example.invalid", "from relay.example.invalid"],
      "authentication-results": "mx.example.invalid; spf=pass smtp.mailfrom=sender@example.invalid; dkim=fail header.d=example.invalid; dmarc=none",
      "dkim-signature": "v=1; a=rsa-sha256; d=example.invalid",
      "message-id": "<message-1@example.invalid>",
    },
  })]);
  factory.messages.set("brand_b", [rawMessage({ folder: "INBOX", uid: 2, source: SOURCE })]);
  return new MailService(testConfig, factory, new StableIdCodec(KEY));
}

async function connect(service: MailService) {
  const server = createMailBridgeMcpServer(service, true);
  const client = new Client({ name: "tools-test", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closers.push(() => client.close(), () => server.close());
  return client;
}

describe("authentication summary", () => {
  it("reads SPF, DKIM and DMARC verdicts out of Authentication-Results", () => {
    const summary = summarizeAuthentication({
      "Authentication-Results": "mx; spf=pass smtp.mailfrom=a@b.invalid; dkim=fail; dmarc=none",
      "DKIM-Signature": "v=1",
      "Received": ["hop one", "hop two", "hop three"],
    });
    expect(summary).toEqual(expect.objectContaining({ spf: "pass", dkim: "fail", dmarc: "none", dkim_signed: true, received_hops: 3 }));
  });

  it("falls back to Received-SPF and reports an unsigned message", () => {
    const summary = summarizeAuthentication({ "received-spf": "Fail (domain does not designate sender)" });
    expect(summary.spf).toBe("fail");
    expect(summary.dkim).toBeNull();
    expect(summary.dkim_signed).toBe(false);
    expect(summary.received_hops).toBe(0);
  });

  it("returns empty verdicts for a message without authentication headers", () => {
    expect(summarizeAuthentication({})).toEqual({
      spf: null, dkim: null, dmarc: null, dkim_signed: false,
      authentication_results: [], received_spf: [], received_hops: 0,
    });
  });
});

describe("fetch_messages", () => {
  it("reads a batch and reports per-message failures without aborting", async () => {
    const service = build();
    const searched = await service.searchKnowledge("Example");
    const ids = searched.results.map((result) => result.id);
    expect(ids.length).toBeGreaterThan(1);
    const batch = await service.fetchMessages([...ids, "mb1.broken.signature"], { include_html: false, max_body_chars: 20_000 });
    expect(batch.messages).toHaveLength(ids.length);
    expect(batch.partial_failures).toHaveLength(1);
    expect(batch.partial_failures[0]!.mailbox_id).toBe("unknown");
  });

  it("deduplicates repeated identifiers", async () => {
    const service = build();
    const id = (await service.searchKnowledge("Example")).results[0]!.id;
    const batch = await service.fetchMessages([id, id, id], { include_html: false, max_body_chars: 20_000 });
    expect(batch.messages).toHaveLength(1);
  });

  it("is reachable over MCP", async () => {
    const service = build();
    const client = await connect(service);
    const id = (await service.searchKnowledge("Example")).results[0]!.id;
    const result = await client.callTool({ name: "fetch_messages", arguments: { stable_message_ids: [id] } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toHaveProperty("messages");
  });
});

describe("fetch_raw_message", () => {
  it("returns headers, an authentication summary and the raw source", async () => {
    const service = build();
    const id = (await service.searchKnowledge("Example", { mailbox_ids: ["brand_a"] })).results[0]!.id;
    const raw = await service.fetchRawMessage(id, { max_bytes: 1024 });
    expect(raw.mailbox_id).toBe("brand_a");
    expect(raw.authentication).toEqual(expect.objectContaining({ spf: "pass", dkim: "fail", dmarc: "none", dkim_signed: true, received_hops: 2 }));
    expect(Buffer.from(raw.source_base64, "base64").toString("utf8")).toBe(SOURCE.toString("utf8"));
    expect(raw.next_offset).toBeNull();
    expect(raw.truncated).toBe(false);
  });

  it("walks a long source in chunks", async () => {
    const service = build();
    const id = (await service.searchKnowledge("Example", { mailbox_ids: ["brand_a"] })).results[0]!.id;
    const chunks: Buffer[] = [];
    let offset: number | null = 0;
    let guard = 0;
    while (offset !== null && guard < 20) {
      const part: Awaited<ReturnType<typeof service.fetchRawMessage>> = await service.fetchRawMessage(id, { max_bytes: 16, offset });
      chunks.push(Buffer.from(part.source_base64, "base64"));
      offset = part.next_offset;
      guard += 1;
    }
    expect(Buffer.concat(chunks).toString("utf8")).toBe(SOURCE.toString("utf8"));
    expect(guard).toBeGreaterThan(1);
  });

  it("stops at the configured raw-source ceiling with a terminal cursor", async () => {
    const factory = new FakeFactory();
    const config = structuredClone(testConfig);
    config.privacy.source_max_bytes = 64;
    factory.messages.set("brand_a", [rawMessage({ folder: "INBOX", uid: 1, source: Buffer.alloc(100, 65) })]);
    const service = new MailService(config, factory, new StableIdCodec(KEY));
    const id = (await service.searchKnowledge("Example", { mailbox_ids: ["brand_a"] })).results[0]!.id;
    const first = await service.fetchRawMessage(id, { max_bytes: 32 });
    expect(first.next_offset).toBe(32);
    const last = await service.fetchRawMessage(id, { max_bytes: 32, offset: first.next_offset! });
    expect(last.returned_bytes).toBe(32);
    expect(last.next_offset).toBe(64);
    expect(last.truncated).toBe(true);
    const final = await service.fetchRawMessage(id, { max_bytes: 64, offset: last.next_offset! });
    expect(final.returned_bytes).toBe(36);
    expect(final.next_offset).toBeNull();
    expect(final.truncated).toBe(false);
  });

  it("is reachable over MCP and stays read-only", async () => {
    const service = build();
    const client = await connect(service);
    const id = (await service.searchKnowledge("Example", { mailbox_ids: ["brand_a"] })).results[0]!.id;
    const result = await client.callTool({ name: "fetch_raw_message", arguments: { stable_message_id: id, max_bytes: 4096 } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(expect.objectContaining({ authentication: expect.any(Object), sha256: expect.any(String) }));
  });
});

describe("find_cross_brand_threads", () => {
  it("returns an advisory-only result over MCP", async () => {
    const client = await connect(build());
    const result = await client.callTool({ name: "find_cross_brand_threads", arguments: { mailbox_ids: ["brand_a", "brand_b"], limit: 5 } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(expect.objectContaining({ advisory_only: true, findings: expect.any(Array) }));
  });

  it("exposes the three new tools as read-only", async () => {
    const client = await connect(build());
    const tools = await client.listTools();
    const added = tools.tools.filter((tool) => ["fetch_messages", "fetch_raw_message", "find_cross_brand_threads"].includes(tool.name));
    expect(added).toHaveLength(3);
    expect(added.every((tool) => tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint === false)).toBe(true);
    expect(added.every((tool) => tool.description?.startsWith("Use this"))).toBe(true);
  });
});

describe("fetch_raw_message without adapter source", () => {
  it("fails loudly instead of returning an empty body", async () => {
    const factory = new FakeFactory();
    factory.messages.set("brand_a", [rawMessage({ folder: "INBOX", uid: 1 })]);
    const service = new MailService(testConfig, factory, new StableIdCodec(KEY));
    const id = (await service.searchKnowledge("Example", { mailbox_ids: ["brand_a"] })).results[0]!.id;
    await expect(service.fetchRawMessage(id, { max_bytes: 1024 })).rejects.toMatchObject({ code: "RAW_SOURCE_UNAVAILABLE" });
  });
});
