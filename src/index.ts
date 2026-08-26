#!/usr/bin/env node
import { bootstrap } from "./bootstrap.js";
import { startAdminPanel } from "./admin/server.js";
import { startHttpTransport } from "./transport/http.js";
import { startStdioTransport } from "./transport/stdio.js";
import { logger } from "./util/logger.js";
import { loadConfig } from "./config/load.js";
import { FileSecretProvider } from "./config/secrets.js";
import { createPrivateAppRuntime } from "./app/runtime.js";
import { createLocalDemoRuntimeFromEnvironment, createSafeSendDemoRuntimeFromEnvironment } from "./demo/runtime.js";

async function main(): Promise<void> {
  const transport = option("--transport") ?? "stdio";
  const configPath = option("--config");
  if (transport === "local-demo") {
    const runtime = await createLocalDemoRuntimeFromEnvironment();
    await startHttpTransport(runtime.config, null, undefined, runtime);
    return;
  }
  if (transport === "safe-send-demo") {
    const runtime = await createSafeSendDemoRuntimeFromEnvironment();
    await startHttpTransport(runtime.config, null, undefined, runtime);
    return;
  }
  if (transport === "panel") {
    await startAdminPanel(configPath);
    return;
  }
  if (transport === "http") {
    const config = await loadConfig(configPath);
    if (config.app.enabled) {
      const runtime = await createPrivateAppRuntime(config, new FileSecretProvider());
      await startHttpTransport(config, null, runtime);
    } else {
      const service = await bootstrap(configPath);
      await startHttpTransport(service.config, service);
    }
    return;
  }
  const service = await bootstrap(configPath);
  if (transport === "stdio") {
    await startStdioTransport(service);
    return;
  }
  throw new Error("--transport must be stdio, http, panel, local-demo or safe-send-demo");
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

main().catch(() => {
  logger.fatal({ error_category: "STARTUP_FAILED" }, "startup_failed");
  process.exitCode = 1;
});
