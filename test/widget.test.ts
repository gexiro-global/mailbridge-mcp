import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { MAILBRIDGE_SAFE_SEND_WIDGET_URI, mailbridgeSafeSendWidgetHtml } from "../src/app/safeSendWidget.js";
import { MAILBRIDGE_WIDGET_URI, mailbridgeReadOnlyWidgetHtml, mailbridgeWidgetHtml } from "../src/app/widget.js";
import { createMailBridgeMcpServer } from "../src/mcp/server.js";
import { StableIdCodec } from "../src/security/stableId.js";
import { MailService } from "../src/services/mailService.js";
import type { MailSendService } from "../src/services/mailSendService.js";
import { FakeFactory, testConfig } from "./fixtures.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(closers.splice(0).map((close) => close())));

describe("Apps SDK widget", () => {
  it("contains the full settings flow and no persistent browser credential/session storage", () => {
    const html = mailbridgeWidgetHtml();
    expect(html).toContain("Add mailbox");
    expect(html).toContain("Replace credentials");
    expect(html).toContain("Last successful test");
    expect(html).toContain('autocomplete="new-password"');
    expect(html).toContain("scrub(form)");
    expect(html).toContain("payload.password=\"\"");
    expect(html).not.toContain("localStorage");
    expect(html).not.toContain("sessionStorage");
    expect(html).not.toContain("setWidgetState");
    expect(html).not.toMatch(/\bconfirm\s*\(/);
    expect(html).not.toMatch(/\bprompt\s*\(/);
    expect(html).toContain("Safe Send policy");
    expect(html).toContain('id="deleteMailboxConfirmationLabel"');
    expect(html).toContain("if(confirmation!==id)");
    expect(html).not.toContain('confirmation!=="DELETE"');
    expect(html).toContain("DELETE ALL MAILBRIDGE DATA");
    expect(html).toContain("toolResponseMetadata");
    expect(html).toContain("mcp_tool_result");
    expect(html).toContain('lang="en"');
    expect(html).toContain("X-MailBridge-CSRF");
    const scripts = [...html.matchAll(/<script(?:\s+type="module")?>([\s\S]*?)<\/script>/gi)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) expect(() => new Function(script[1] ?? "")).not.toThrow();
  });

  it("implements a bridge-first Safe Send preview without browser persistence or native confirmation dialogs", () => {
    const html = mailbridgeSafeSendWidgetHtml();
    expect(html).toContain("MailBridge Safe Send");
    expect(html).toContain('lang="en"');
    expect(html).toContain("Draft → validation → one-time confirmation → SMTP");
    expect(html).toContain('request("tools/call"');
    expect(html).toContain('message.method==="ui/notifications/tool-result"');
    expect(html).toContain('callTool("update_draft"');
    expect(html).toContain('callTool("validate_draft"');
    expect(html).toContain('callTool("prepare_draft_send"');
    expect(html).toContain('callTool("send_draft"');
    expect(html).toContain('type="file"');
    expect(html).toContain('callTool("add_draft_attachment"');
    expect(html).toContain('callTool("remove_draft_attachment"');
    expect(html).toContain("irreversible SMTP operation");
    expect(html).not.toContain("localStorage");
    expect(html).not.toContain("sessionStorage");
    expect(html).not.toMatch(/\bconfirm\s*\(/);
    expect(html).not.toMatch(/\bprompt\s*\(/);
    const scripts = [...html.matchAll(/<script(?:\s+type="module")?>([\s\S]*?)<\/script>/gi)];
    expect(scripts).toHaveLength(1);
    expect(() => new Function(scripts[0]?.[1] ?? "")).not.toThrow();
  });

  it("registers a separately scoped settings tool and keeps authorization only in result _meta", async () => {
    const service = new MailService(testConfig, new FakeFactory(), new StableIdCodec("0123456789abcdef0123456789abcdef"));
    const server = createMailBridgeMcpServer(service, true, {
      settingsApiUrl: "https://mailbridge.example.invalid/api",
      widgetOrigin: "https://web-sandbox.oaiusercontent.com",
      issueSettingsSession: () => ({ token: "one-time-secret-token", csrf: "one-time-csrf", expires_at: "2026-07-17T12:00:00.000Z" }),
    });
    const client = new Client({ name: "widget-test", version: "1.0.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closers.push(() => client.close(), () => server.close());

    const resources = await client.listResources();
    expect(resources.resources.some((resource) => resource.uri === MAILBRIDGE_WIDGET_URI)).toBe(true);
    const resource = await client.readResource({ uri: MAILBRIDGE_WIDGET_URI });
    expect(resource.contents[0]?.mimeType).toBe("text/html;profile=mcp-app");
    expect(resource.contents[0]?._meta).toHaveProperty("ui.csp.connectDomains");
    expect(resource.contents[0]?._meta).toHaveProperty("openai/widgetDescription");

    const tools = await client.listTools();
    const listTool = tools.tools.find((tool) => tool.name === "list_mailboxes");
    const settingsTool = tools.tools.find((tool) => tool.name === "open_mailbox_settings");
    expect(listTool?._meta).not.toHaveProperty("ui.resourceUri");
    expect(settingsTool?._meta).toHaveProperty("ui.resourceUri", MAILBRIDGE_WIDGET_URI);
    expect(tools.tools.every((tool) => JSON.stringify(tool._meta?.securitySchemes) === JSON.stringify([{ type: "noauth" }]))).toBe(true);
    const listResult = await client.callTool({ name: "list_mailboxes", arguments: {} });
    expect(listResult._meta).toBeUndefined();
    const result = await client.callTool({ name: "open_mailbox_settings", arguments: {} });
    expect(result._meta).toMatchObject({ settings_token: "one-time-secret-token", settings_csrf: "one-time-csrf" });
    expect(JSON.stringify(result.content)).not.toMatch(/one-time-secret-token|one-time-csrf/);
    expect(JSON.stringify(result.structuredContent)).not.toMatch(/one-time-secret-token|one-time-csrf/);
  });

  it("serves a read-only widget resource for the private secure-tunnel transport", async () => {
    const service = new MailService(testConfig, new FakeFactory(), new StableIdCodec("0123456789abcdef0123456789abcdef"));
    const server = createMailBridgeMcpServer(service, true, {
      widgetOrigin: "https://web-sandbox.oaiusercontent.com",
      widgetHtml: mailbridgeReadOnlyWidgetHtml,
    });
    const client = new Client({ name: "tunnel-widget-test", version: "1.0.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closers.push(() => client.close(), () => server.close());

    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri)).toContain(MAILBRIDGE_WIDGET_URI);
    const resource = await client.readResource({ uri: MAILBRIDGE_WIDGET_URI });
    expect(resource.contents[0]?.mimeType).toBe("text/html;profile=mcp-app");
    expect(resource.contents[0]?._meta).toMatchObject({ ui: { csp: { connectDomains: [] } } });
    expect(resource.contents[0]?._meta).toHaveProperty("openai/widgetDescription");
    expect(resource.contents[0]?.text).toContain("IMAP reading remains read-only");
    expect(resource.contents[0]?.text).toContain("explicitly approved actions");
    expect(resource.contents[0]?.text).not.toContain("settings_api_url");

    const result = await client.callTool({ name: "list_mailboxes", arguments: {} });
    expect(result._meta).toEqual({ read_only_widget: true });
  });

  it("registers the decoupled Safe Send resource only with the send layer", async () => {
    const service = new MailService(testConfig, new FakeFactory(), new StableIdCodec("0123456789abcdef0123456789abcdef"));
    const server = createMailBridgeMcpServer(service, true, undefined, {} as MailSendService);
    const client = new Client({ name: "safe-send-widget-test", version: "1.0.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closers.push(() => client.close(), () => server.close());

    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri)).toContain(MAILBRIDGE_SAFE_SEND_WIDGET_URI);
    const resource = await client.readResource({ uri: MAILBRIDGE_SAFE_SEND_WIDGET_URI });
    expect(resource.contents[0]?.mimeType).toBe("text/html;profile=mcp-app");
    expect(resource.contents[0]?._meta).toMatchObject({ ui: { csp: { connectDomains: [], resourceDomains: [] } } });
    expect(resource.contents[0]?.text).toContain("MailBridge Safe Send");

    const tools = await client.listTools();
    expect(tools.tools.find((tool) => tool.name === "open_mail_composer")?._meta).toMatchObject({
      ui: { resourceUri: MAILBRIDGE_SAFE_SEND_WIDGET_URI },
    });
  });

  it("advertises OAuth only when the server is in OAuth mode", async () => {
    const oauthConfig = structuredClone(testConfig);
    oauthConfig.auth.mode = "oauth";
    const service = new MailService(oauthConfig, new FakeFactory(), new StableIdCodec("0123456789abcdef0123456789abcdef"));
    const server = createMailBridgeMcpServer(service, false, {
      settingsApiUrl: "https://mailbridge.example.invalid/api",
      widgetOrigin: "https://web-sandbox.oaiusercontent.com",
      issueSettingsSession: () => ({ token: "unused", csrf: "unused", expires_at: "2026-07-17T12:00:00.000Z" }),
    }, {} as MailSendService);
    const client = new Client({ name: "oauth-widget-test", version: "1.0.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closers.push(() => client.close(), () => server.close());

    const tools = await client.listTools();
    const sendNames = new Set([
      "open_mail_composer", "update_draft", "get_send_policy", "validate_draft", "prepare_draft_send",
      "get_send_status", "list_send_audit", "create_draft", "reply_draft", "add_draft_attachment",
      "remove_draft_attachment", "send_draft", "send_email", "reply_email",
    ]);
    for (const tool of tools.tools) {
      const scopes = tool.name === "mailbox_health"
        ? ["mail.health.read"]
        : tool.name === "open_mailbox_settings"
          ? ["mail.settings.write"]
          : sendNames.has(tool.name)
            ? ["mail.send"]
            : ["mail.read"];
      expect(tool._meta?.securitySchemes).toEqual([{ type: "oauth2", scopes }]);
    }
  });
});
