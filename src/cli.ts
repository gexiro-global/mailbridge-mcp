#!/usr/bin/env node
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import { parse, stringify } from "yaml";
import { bootstrap } from "./bootstrap.js";
import { loadConfig } from "./config/load.js";
import { requiredSecretReferences } from "./config/requiredSecrets.js";
import { MailBridgeConfigSchema, type MailBridgeConfig } from "./config/schema.js";
import { FileSecretProvider } from "./config/secrets.js";
import { MAILBRIDGE_VERSION } from "./version.js";

const program = new Command()
  .name("mailbridge")
  .description("Read-only MailBridge MCP administration CLI")
  .version(MAILBRIDGE_VERSION)
  .option("--config <path>", "configuration file", process.env.MAILBRIDGE_CONFIG ?? "./config/mailboxes.yaml")
  .option("--environment <name>", "runtime safety profile: development or production", process.env.NODE_ENV ?? "development");

const mailbox = program.command("mailbox").description("manage mailbox registry entries");

mailbox.command("list").description("list safe mailbox metadata").action(async () => {
  const config = await loadConfig(selectedConfig(), selectedEnvironment());
  output(config.mailboxes.map((entry) => ({
    mailbox_id: entry.id,
    display_name: entry.display_name,
    email: entry.email,
    brand: entry.brand,
    enabled: entry.enabled,
    allowed_folders: entry.allowed_folders,
  })));
});

mailbox.command("validate-config").description("validate configuration without opening secrets").action(async () => {
  const config = await loadConfig(selectedConfig(), selectedEnvironment());
  output({ valid: true, mailbox_count: config.mailboxes.length, enabled_count: config.mailboxes.filter((item) => item.enabled).length });
});

mailbox.command("test").argument("<mailbox_id>").description("test one enabled mailbox without changing flags").action(async (mailboxId: string) => {
  const service = await bootstrap(selectedConfig());
  output(await service.mailboxHealth(mailboxId));
});

mailbox.command("enable").argument("<mailbox_id>").description("enable a mailbox in the local configuration").action(async (mailboxId: string) => {
  await setMailboxEnabled(selectedConfig(), mailboxId, true);
});

mailbox.command("disable").argument("<mailbox_id>").description("disable a mailbox in the local configuration").action(async (mailboxId: string) => {
  await setMailboxEnabled(selectedConfig(), mailboxId, false);
});

program.command("config").description("configuration operations").command("lint").description("validate the configuration schema and runtime safety rules").action(async () => {
  const config = await loadConfig(selectedConfig(), selectedEnvironment());
  output({ valid: true, server: config.server.name, version: config.server.version });
});

program.command("doctor").description("check config and required secret-file presence without reading values").action(async () => {
  const environment = selectedEnvironment();
  const config = await loadConfig(selectedConfig(), environment);
  const secrets = new FileSecretProvider();
  const checks: Array<{ reference: string; present: boolean }> = [];
  const references = requiredSecretReferences(config);
  for (const reference of references) checks.push({ reference, present: await secrets.exists(reference) });
  output({
    config_valid: true,
    environment,
    required_secret_count: checks.length,
    secret_checks: checks,
    secret_values_read: 0,
    ready: checks.every((check) => check.present),
  });
  if (checks.some((check) => !check.present)) process.exitCode = 2;
});

program.parseAsync().catch((error: unknown) => {
  output({ error: error instanceof Error ? error.message : "CLI operation failed" });
  process.exitCode = 1;
});

function selectedConfig(): string {
  return resolve(String(program.opts().config));
}

function selectedEnvironment(): "development" | "production" {
  const selected = String(program.opts().environment);
  if (selected !== "development" && selected !== "production") {
    throw new Error("--environment must be development or production");
  }
  return selected;
}

async function setMailboxEnabled(configPath: string, mailboxId: string, enabled: boolean): Promise<void> {
  const raw = await readFile(configPath, "utf8");
  const parsed: unknown = parse(raw);
  const config = MailBridgeConfigSchema.parse(parsed);
  const target = config.mailboxes.find((item) => item.id === mailboxId);
  if (!target) throw new Error("Unknown mailbox");
  target.enabled = enabled;
  const validated: MailBridgeConfig = MailBridgeConfigSchema.parse(config);
  const backup = `${configPath}.bak.${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await copyFile(configPath, backup);
  await writeFile(configPath, stringify(validated, { lineWidth: 120 }), { encoding: "utf8", flag: "w" });
  output({ mailbox_id: mailboxId, enabled, backup_created: backup });
}

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
