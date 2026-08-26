#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPrivateAppRuntime } from "./app/runtime.js";
import { mailbridgeReadOnlyWidgetHtml } from "./app/widget.js";
import { FileSecretProvider } from "./config/secrets.js";
import { loadConfig } from "./config/load.js";
import { createMailBridgeMcpServer } from "./mcp/server.js";
import { logger } from "./util/logger.js";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const configPath = option("--config");
  if (!configPath) throw new Error("--config is required");

  const config = await loadConfig(configPath);
  if (!config.app.enabled) throw new Error("Private MailBridge App mode must be enabled");
  if (config.app.user_key_mode !== "fixed_private_owner") {
    throw new Error("Secure tunnel stdio requires fixed_private_owner mode");
  }

  const runtime = await createPrivateAppRuntime(config, new FileSecretProvider());
  const userKey = runtime.userKeys.derive({
    issuer: "urn:openai:secure-mcp-tunnel",
    subject: "fixed-private-owner",
  });
  const scoped = runtime.services.create(userKey);
  const server = createMailBridgeMcpServer(scoped.service, true, {
    widgetOrigin: "https://web-sandbox.oaiusercontent.com",
    widgetHtml: mailbridgeReadOnlyWidgetHtml,
  }, scoped.writer);
  const transport = new StdioServerTransport();

  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await server.close().catch(() => undefined);
    scoped.dispose();
    runtime.close();
  };
  process.once("SIGINT", () => void close().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void close().finally(() => process.exit(0)));
  await server.connect(transport);
}

main().catch((error) => {
  logger.fatal({ error_category: error instanceof Error ? error.name : "UnknownError" }, "tunnel_stdio_startup_failed");
  process.exitCode = 1;
});
