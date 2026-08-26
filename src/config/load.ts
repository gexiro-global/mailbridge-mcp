import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { MailBridgeConfigSchema, assertRuntimeSafety, type MailBridgeConfig } from "./schema.js";

export async function loadConfig(configPath?: string): Promise<MailBridgeConfig> {
  const selectedPath = resolve(configPath ?? process.env.MAILBRIDGE_CONFIG ?? "./config/mailboxes.example.yaml");
  const raw = await readFile(selectedPath, "utf8");
  const parsed: unknown = parse(raw);
  const config = MailBridgeConfigSchema.parse(parsed);
  assertRuntimeSafety(config, process.env.NODE_ENV ?? "development");
  return config;
}
