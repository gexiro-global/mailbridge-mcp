#!/usr/bin/env node
import { copyFile, mkdir, open, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";

const sourceRoot = resolve(import.meta.dirname, "..");
const root = resolve(process.env.MAILBRIDGE_SETUP_ROOT ?? sourceRoot);
const configTarget = resolve(root, "config", "mailboxes.yaml");
const configExample = resolve(sourceRoot, "config", "mailboxes.example.yaml");
const secretDirectory = resolve(root, "secrets");
const dataDirectory = resolve(root, "runtime", "data");

await mkdir(dirname(configTarget), { recursive: true });
await mkdir(secretDirectory, { recursive: true, mode: 0o700 });
await mkdir(dataDirectory, { recursive: true, mode: 0o700 });

if (!(await exists(configTarget))) await copyFile(configExample, configTarget);

for (const name of [
  "mailbridge_credential_master_key",
  "mailbridge_user_key_hmac",
  "mailbridge_id_hmac_key",
]) {
  const target = resolve(secretDirectory, name);
  if (await exists(target)) continue;
  const file = await open(target, "wx", 0o600);
  try {
    await file.writeFile(`${randomBytes(32).toString("base64url")}\n`, "utf8");
  } finally {
    await file.close();
  }
}

process.stdout.write(JSON.stringify({
  status: "READY",
  config: "config/mailboxes.yaml",
  secret_files: 3,
  secret_values_printed: 0,
    next: "Review config/mailboxes.yaml, then run npm start",
}) + "\n");

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
