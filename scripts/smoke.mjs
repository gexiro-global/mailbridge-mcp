import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const baseUrl = process.env.MAILBRIDGE_SMOKE_URL ?? "http://127.0.0.1:3100";
const health = await fetch(`${baseUrl}/health`);
if (!health.ok) throw new Error(`health failed: ${health.status}`);
const healthBody = await health.json();
if (healthBody.mode !== "SYNTHETIC_DEMO") throw new Error("unexpected runtime mode");

const client = new Client({ name: "mailbridge-smoke", version: "1.0.0" }, { capabilities: {} });
await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
try {
  const tools = await client.listTools();
  const resources = await client.listResources();
  const mailboxes = await client.callTool({ name: "list_mailboxes", arguments: {} });
  const payload = mailboxes.structuredContent;
  if (!payload || !Array.isArray(payload.mailboxes) || payload.mailboxes.length !== 2) {
    throw new Error("unexpected mailbox payload");
  }
  if (tools.tools.length !== 11) throw new Error(`unexpected tool count: ${tools.tools.length}`);
  if (resources.resources.length !== 1) throw new Error(`unexpected resource count: ${resources.resources.length}`);
  console.log(JSON.stringify({
    status: "PASS",
    health: healthBody.status,
    tools: tools.tools.length,
    resources: resources.resources.length,
    mailboxes: payload.mailboxes.length,
    write_operations: 0,
  }));
} finally {
  await client.close();
}
