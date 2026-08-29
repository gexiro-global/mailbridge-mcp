import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileSecretProvider } from "../src/config/secrets.js";
import { MailBridgeConfigSchema, assertRuntimeSafety } from "../src/config/schema.js";
import { testConfig } from "./fixtures.js";

describe("configuration", () => {
  it("parses the valid fixture", () => {
    expect(MailBridgeConfigSchema.parse(testConfig).mailboxes).toHaveLength(2);
  });

  it("allows a bounded request envelope large enough for a 10 MiB base64 attachment", () => {
    const attachmentReady = structuredClone(testConfig);
    attachmentReady.server.request_max_bytes = 16 * 1024 * 1024;
    expect(MailBridgeConfigSchema.parse(attachmentReady).server.request_max_bytes).toBe(16 * 1024 * 1024);

    attachmentReady.server.request_max_bytes = 20 * 1024 * 1024 + 1;
    expect(() => MailBridgeConfigSchema.parse(attachmentReady)).toThrow();
  });

  it("rejects duplicate mailbox ids", () => {
    const duplicate = structuredClone(testConfig);
    duplicate.mailboxes.push(structuredClone(duplicate.mailboxes[0]!));
    expect(() => MailBridgeConfigSchema.parse(duplicate)).toThrow(/Duplicate mailbox id/);
  });

  it("rejects unsafe secret references", () => {
    const invalid = structuredClone(testConfig);
    invalid.mailboxes[0]!.password_secret = "../password";
    expect(() => MailBridgeConfigSchema.parse(invalid)).toThrow(/Secret references/);
  });

  it("rejects disabled auth outside loopback", () => {
    const invalid = structuredClone(testConfig);
    invalid.server.bind_host = "0.0.0.0";
    expect(() => assertRuntimeSafety(invalid, "development")).toThrow(/loopback/);
  });

  it("requires oauth in production", () => {
    expect(() => assertRuntimeSafety(testConfig, "production")).toThrow(/OAuth/);
  });

  it("requires a public HTTPS endpoint and one allowlisted owner in production", () => {
    const valid = structuredClone(testConfig);
    makeProductionUrls(valid);
    valid.auth.mode = "oauth";
    valid.auth.allowed_subjects = ["operator-subject"];
    valid.app.enabled = true;
    valid.server.allowed_hosts.push("mailbridge.example.com");
    expect(() => assertRuntimeSafety(valid, "production")).not.toThrow();

    const loopback = structuredClone(valid);
    loopback.server.public_base_url = "https://127.0.0.1:3091";
    loopback.auth.audience = "https://127.0.0.1:3091";
    expect(() => assertRuntimeSafety(loopback, "production")).toThrow(/not loopback/);

    const anonymous = structuredClone(valid);
    anonymous.auth.allowed_subjects = [];
    expect(() => assertRuntimeSafety(anonymous, "production")).toThrow(/subject allowlist/);
  });

  it("preserves the production Cloudflare Access authentication mode", () => {
    const valid = structuredClone(testConfig);
    makeProductionUrls(valid);
    valid.auth.mode = "cloudflare_access";
    valid.auth.access_audience = "immutable-access-audience";
    valid.auth.allowed_subjects = ["operator-subject"];
    valid.app.enabled = true;
    valid.server.allowed_hosts.push("mailbridge.example.com");
    expect(() => assertRuntimeSafety(valid, "production")).not.toThrow();

    delete valid.auth.access_audience;
    expect(() => assertRuntimeSafety(valid, "production")).toThrow(/AUD tag/);
  });

  it("allows fixed private-owner storage only for one OAuth subject", () => {
    const invalid = structuredClone(testConfig);
    makeProductionUrls(invalid);
    invalid.auth.mode = "oauth";
    invalid.auth.allowed_subjects = ["operator-a", "operator-b"];
    invalid.app.enabled = true;
    invalid.app.user_key_mode = "fixed_private_owner";
    invalid.server.allowed_hosts.push("mailbridge.example.com");
    expect(() => assertRuntimeSafety(invalid, "production")).toThrow(/exactly one/);
  });

  it("reads a secret by safe reference", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mailbridge-secrets-"));
    await writeFile(join(directory, "safe_secret"), "value\n", "utf8");
    await expect(new FileSecretProvider(directory).read("safe_secret")).resolves.toBe("value");
  });

  it("blocks secret path traversal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mailbridge-secrets-"));
    await expect(new FileSecretProvider(directory).read("../outside")).rejects.toThrow(/Invalid secret reference/);
  });

  it("refuses symbolic-link secret references", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mailbridge-secrets-"));
    const outside = join(await mkdtemp(join(tmpdir(), "mailbridge-outside-")), "value");
    await writeFile(outside, "must-not-be-read", "utf8");
    try {
      await symlink(outside, join(directory, "linked_secret"), "file");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EPERM") return;
      throw error;
    }
    const provider = new FileSecretProvider(directory);
    await expect(provider.exists("linked_secret")).resolves.toBe(false);
    await expect(provider.read("linked_secret")).rejects.toThrow(/not a regular file/);
  });

  it("replaces a secret through an atomic service-only file operation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mailbridge-secret-rotate-"));
    const provider = new FileSecretProvider(directory);
    await provider.replace("rotated_secret", "first-value");
    await provider.replace("rotated_secret", "second-value");
    await expect(provider.read("rotated_secret")).resolves.toBe("second-value");
  });
});

function makeProductionUrls(config: typeof testConfig): void {
  config.server.public_base_url = "https://mailbridge.example.com";
  config.auth.issuer = "https://identity.example.com/";
  config.auth.audience = "https://mailbridge.example.com";
  config.auth.jwks_uri = "https://identity.example.com/.well-known/jwks.json";
}
