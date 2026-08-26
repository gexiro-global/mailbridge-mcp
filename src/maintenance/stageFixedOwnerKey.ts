#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { UserKeyDeriver } from "../app/identity.js";
import { loadConfig } from "../config/load.js";
import { FileSecretProvider } from "../config/secrets.js";

export async function stageFixedOwnerKey(configPath: string, secretDirectory: string): Promise<"created" | "existing"> {
  const config = await loadConfig(resolve(configPath));
  if (!config.app.enabled) throw new Error("Private App mode must be enabled");
  const secrets = new FileSecretProvider(resolve(secretDirectory));

  if (await secrets.exists(config.app.fixed_owner_user_key_secret)) return "existing";
  if (config.auth.mode !== "disabled_dev") {
    throw new Error("Stage the fixed owner key from the legacy disabled_dev identity before enabling OAuth");
  }

  const encoded = await secrets.read(config.app.user_key_hmac_secret);
  const key = decodeHmacKey(encoded);
  try {
    const currentUserKey = new UserKeyDeriver(key).derive({
      issuer: config.auth.issuer,
      subject: "local-dev",
    });
    await secrets.replace(config.app.fixed_owner_user_key_secret, currentUserKey);
    return "created";
  } finally {
    key.fill(0);
  }
}

function decodeHmacKey(encoded: string): Buffer {
  const normalized = encoded.startsWith("base64url:") ? encoded.slice("base64url:".length) : encoded;
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) throw new Error("User-key HMAC secret must use base64url encoding");
  const key = Buffer.from(normalized, "base64url");
  if (key.byteLength < 32) {
    key.fill(0);
    throw new Error("User-key HMAC secret has an invalid length");
  }
  return key;
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  stageFixedOwnerKey(argument("--config"), argument("--secret-dir"))
    .then((status) => {
      process.stdout.write(`${JSON.stringify({ fixed_owner_key_staged: true, status, secret_value_exposed: false })}\n`);
    })
    .catch(() => {
      process.stderr.write(`${JSON.stringify({ fixed_owner_key_staged: false, error_category: "STAGE_FIXED_OWNER_KEY_FAILED" })}\n`);
      process.exitCode = 1;
    });
}
