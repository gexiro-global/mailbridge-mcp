import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { StableIdCodec } from "../src/security/stableId.js";
import { MailService } from "../src/services/mailService.js";
import { startHttpTransport, type HttpRuntime } from "../src/transport/http.js";
import { FakeFactory, testConfig } from "./fixtures.js";

const runtimes: HttpRuntime[] = [];
afterEach(async () => Promise.all(runtimes.splice(0).map((runtime) => runtime.close())));

describe("HTTP transport", () => {
  it("completes an MCP handshake and lists tools over Streamable HTTP", async () => {
    const runtime = await start(false);
    const client = new Client({ name: "http-test-client", version: "1.0.0" }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl(runtime)}/mcp`));
    await client.connect(transport);
    try {
      const result = await client.listTools();
      expect(result.tools).toHaveLength(11);
      expect(result.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("serves safe health and docs without OAuth metadata in disabled dev mode", async () => {
    const runtime = await start(false);
    const base = baseUrl(runtime);
    const health = await fetch(`${base}/health`).then((response) => response.json());
    expect(health).toEqual({ status: "ok", service: "mailbridge-mcp", version: "0.1.0" });
    expect(JSON.stringify(health)).not.toContain("brand_a");

    const docs = await fetch(`${base}/docs`).then((response) => response.json());
    expect(docs.write_tools).toBe(false);
    const metadata = await fetch(`${base}/.well-known/oauth-protected-resource`);
    expect(metadata.status).toBe(404);
  });

  it("rejects an unapproved Origin", async () => {
    const runtime = await start(false);
    const response = await fetch(`${baseUrl(runtime)}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example.invalid" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(response.status).toBe(403);
  });

  it("requires a Bearer token in OAuth mode", async () => {
    const runtime = await start(true);
    const metadata = await fetch(`${baseUrl(runtime)}/.well-known/oauth-protected-resource`).then((response) => response.json());
    expect(metadata.resource).toBe(testConfig.auth.audience);
    const pathMetadata = await fetch(`${baseUrl(runtime)}/.well-known/oauth-protected-resource/mcp`).then((response) => response.json());
    expect(pathMetadata.resource).toBe(testConfig.auth.audience);
    const response = await fetch(`${baseUrl(runtime)}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://chatgpt.com" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata");
  });
});

async function start(oauth: boolean): Promise<HttpRuntime> {
  const config = structuredClone(testConfig);
  config.server.port = 0;
  config.auth.mode = oauth ? "oauth" : "disabled_dev";
  const service = new MailService(config, new FakeFactory(), new StableIdCodec("0123456789abcdef0123456789abcdef"));
  const runtime = await startHttpTransport(config, service);
  runtimes.push(runtime);
  return runtime;
}

function baseUrl(runtime: HttpRuntime): string {
  const address = runtime.server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}
