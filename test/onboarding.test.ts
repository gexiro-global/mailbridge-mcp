import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { requiredSecretReferences } from "../src/config/requiredSecrets.js";
import { MailBridgeConfigSchema } from "../src/config/schema.js";
import { testConfig } from "./fixtures.js";

const execute = promisify(execFile);

describe("production onboarding", () => {
  it("excludes host secrets and local environment files from the Docker build context", async () => {
    const rules = (await readFile(resolve(".dockerignore"), "utf8")).split(/\r?\n/);
    expect(rules).toContain("secrets");
    expect(rules).toContain(".env");
    expect(rules).toContain("config/mailboxes.production.yaml");
  });

  it("creates an idempotent production template without disclosing generated secrets", async () => {
    const home = await mkdtemp(join(tmpdir(), "mailbridge-production-setup-"));
    const script = resolve("scripts/setup.mjs");
    const first = await execute(process.execPath, [script, "--production"], {
      env: { ...process.env, MAILBRIDGE_SETUP_ROOT: home },
    });
    const target = join(home, "config", "mailboxes.production.yaml");
    expect((await stat(target)).isFile()).toBe(true);

    const output = JSON.parse(first.stdout) as Record<string, unknown>;
    expect(output).toMatchObject({
      status: "READY",
      mode: "production",
      config: "config/mailboxes.production.yaml",
      secret_values_printed: 0,
    });

    const parsed = MailBridgeConfigSchema.parse(parse(await readFile(target, "utf8")));
    expect(parsed.server.bind_host).toBe("0.0.0.0");
    expect(parsed.auth.mode).toBe("oauth");
    expect(parsed.auth.allowed_subjects).toEqual([]);
    await expect(loadConfig(target, "production")).rejects.toThrow(/placeholder/);

    parsed.auth.allowed_subjects = ["operator-subject"];
    await writeFile(target, stringify(parsed), "utf8");
    await expect(loadConfig(target, "production")).rejects.toThrow(/placeholder/);

    await execute(process.execPath, [script, "--production"], {
      env: { ...process.env, MAILBRIDGE_SETUP_ROOT: home },
    });
    expect(MailBridgeConfigSchema.parse(parse(await readFile(target, "utf8")))).toEqual(parsed);

    parsed.server.public_base_url = "https://mailbridge.test";
    parsed.server.allowed_hosts = ["mailbridge.test"];
    parsed.auth.issuer = "https://identity.test/";
    parsed.auth.audience = "https://mailbridge.test";
    parsed.auth.jwks_uri = "https://identity.test/.well-known/jwks.json";
    await writeFile(target, stringify(parsed), "utf8");
    await expect(loadConfig(target, "production")).resolves.toMatchObject({
      server: { bind_host: "0.0.0.0" },
      auth: { mode: "oauth", allowed_subjects: ["operator-subject"] },
    });
  });

  it("enumerates every configured secret reference without needing secret values", () => {
    const config = structuredClone(testConfig);
    config.app.enabled = true;
    config.app.user_key_mode = "fixed_private_owner";
    config.panel.enabled = true;
    config.mailboxes[1]!.enabled = false;

    expect(requiredSecretReferences(config, "explicit_id_key")).toEqual([
      "a_password",
      "a_user",
      "explicit_id_key",
      "mailbridge_credential_master_key",
      "mailbridge_fixed_owner_user_key",
      "mailbridge_id_hmac_key",
      "mailbridge_user_key_hmac",
      "panel_operator_password",
      "panel_session_hmac_key",
    ]);
  });

  it("provisions container secrets without exposing values", async () => {
    const home = await mkdtemp(join(tmpdir(), "mailbridge-secret-provision-"));
    const source = join(home, "source");
    const target = join(home, "target");
    await Promise.all([
      mkdir(source, { recursive: true, mode: 0o700 }),
      mkdir(target, { recursive: true, mode: 0o700 }),
    ]);
    const secret = "synthetic-secret-value";
    const secretPath = join(source, "mailbridge_test_key");
    await writeFile(secretPath, secret, { mode: 0o600 });
    await chmod(secretPath, 0o600);

    const script = resolve("scripts/provision-container-secrets.mjs");
    const runtimeUid = typeof process.getuid === "function" && process.getuid() > 0 ? process.getuid() : 10001;
    const runtimeGid = typeof process.getgid === "function" && process.getgid() > 0 ? process.getgid() : 10001;
    const result = await execute(process.execPath, [
      script,
      source,
      target,
      String(runtimeUid),
      String(runtimeGid),
    ]);
    expect(result.stdout).not.toContain(secret);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "READY",
      provisioned_secret_files: 1,
      secret_values_printed: 0,
    });
    expect(await readdir(target)).toEqual(["mailbridge_test_key"]);
    expect(await readFile(join(target, "mailbridge_test_key"), "utf8")).toBe(secret);
    const rotatedSecret = "synthetic-rotated-value";
    await writeFile(secretPath, rotatedSecret, { mode: 0o600 });
    const rotated = await execute(process.execPath, [
      script,
      source,
      target,
      String(runtimeUid),
      String(runtimeGid),
    ]);
    expect(rotated.stdout).not.toContain(rotatedSecret);
    expect(await readFile(join(target, "mailbridge_test_key"), "utf8")).toBe(rotatedSecret);
    if (process.platform !== "win32") {
      expect((await stat(target)).mode & 0o777).toBe(0o710);
      expect((await stat(join(target, "mailbridge_test_key"))).mode & 0o777).toBe(0o400);
    }
  });
});
