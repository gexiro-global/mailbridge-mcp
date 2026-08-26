import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { CredentialEnvelopeCipher } from "../src/app/crypto.js";
import { FixedPrivateOwnerUserKeyResolver, UserKeyDeriver } from "../src/app/identity.js";
import { OneTimeSettingsSessions } from "../src/app/settingsSessions.js";
import { MailboxStore } from "../src/app/store.js";
import { stageFixedOwnerKey } from "../src/maintenance/stageFixedOwnerKey.js";
import type { MailboxConnectionTestResult, MailboxSettings } from "../src/app/types.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("private app security primitives", () => {
  it("derives stable but issuer-scoped pseudonymous user keys", () => {
    const deriver = new UserKeyDeriver(Buffer.alloc(32, 4));
    expect(deriver.derive({ issuer: "https://idp.example/", subject: "operator" }))
      .toBe(deriver.derive({ issuer: "https://idp.example/", subject: "operator" }));
    expect(deriver.derive({ issuer: "https://other.example/", subject: "operator" }))
      .not.toBe(deriver.derive({ issuer: "https://idp.example/", subject: "operator" }));
  });

  it("keeps a private owner's storage key stable across an OAuth identity cutover", () => {
    const existing = new UserKeyDeriver(Buffer.alloc(32, 4)).derive({
      issuer: "https://legacy.example/",
      subject: "local-dev",
    });
    const resolver = new FixedPrivateOwnerUserKeyResolver(existing);
    expect(resolver.derive({ issuer: "https://idp.example/", subject: "operator" })).toBe(existing);
    expect(() => new FixedPrivateOwnerUserKeyResolver("not-a-valid-key")).toThrow(/SHA-256/);
  });

  it("stages the current private owner key atomically without changing the config", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mailbridge-owner-key-"));
    temporaryDirectories.push(directory);
    const secretDirectory = join(directory, "secrets with spaces");
    const configPath = join(directory, "mailboxes with spaces.yaml");
    await mkdir(secretDirectory, { recursive: true });
    await writeFile(join(secretDirectory, "mailbridge_user_key_hmac"), Buffer.alloc(32, 6).toString("base64url"), "utf8");
    const config = structuredClone((await import("./fixtures.js")).testConfig);
    config.app.enabled = true;
    config.app.user_key_mode = "fixed_private_owner";
    config.app.database_path = join(directory, "not-opened.sqlite");
    await writeFile(configPath, YAML.stringify(config), "utf8");

    await expect(stageFixedOwnerKey(configPath, secretDirectory)).resolves.toBe("created");
    await expect(stageFixedOwnerKey(configPath, secretDirectory)).resolves.toBe("existing");
    const stored = (await readFile(join(secretDirectory, "mailbridge_fixed_owner_user_key"), "utf8")).trim();
    expect(stored).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await readFile(configPath, "utf8")).not.toContain(stored);
  });

  it("uses per-mailbox AES-256-GCM envelopes with user/mailbox AAD", () => {
    const cipher = new CredentialEnvelopeCipher("v1", new Map([["v1", Buffer.alloc(32, 9)]]));
    const envelope = cipher.encrypt("user-a", "mbx_a", { username: "synthetic-user", password: "synthetic-password" });
    const secondEnvelope = cipher.encrypt("user-a", "mbx_a", { username: "synthetic-user", password: "synthetic-password" });
    expect(JSON.stringify(envelope)).not.toContain("synthetic-password");
    expect(secondEnvelope.wrapped_key_ciphertext).not.toBe(envelope.wrapped_key_ciphertext);
    expect(secondEnvelope.payload_ciphertext).not.toBe(envelope.payload_ciphertext);
    expect(cipher.decrypt("user-a", "mbx_a", envelope)).toEqual({ username: "synthetic-user", password: "synthetic-password" });
    expect(() => cipher.decrypt("user-b", "mbx_a", envelope)).toThrow();
    expect(() => cipher.decrypt("user-a", "mbx_b", envelope)).toThrow();
    const tampered = `${envelope.payload_ciphertext[0] === "A" ? "B" : "A"}${envelope.payload_ciphertext.slice(1)}`;
    expect(() => cipher.decrypt("user-a", "mbx_a", { ...envelope, payload_ciphertext: tampered })).toThrow();
  });

  it("persists cross-device state, isolates users and stores no credential plaintext", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mailbridge-private-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.sqlite");
    const cipher = new CredentialEnvelopeCipher("v1", new Map([["v1", Buffer.alloc(32, 7)]]));
    const storeA = new MailboxStore(path, cipher);
    storeA.create("user-a", "mbx_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", settings, { username: "only-synthetic-user", password: "only-synthetic-password" }, passResult);
    const draft = storeA.createDraft("user-a", {
      mailbox_id: "mbx_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      to: ["recipient@example.invalid"], cc: [], bcc: [], subject: "Encrypted draft",
      text_body: "only-synthetic-draft-body", in_reply_to: null, references: [],
    });
    expect(storeA.list("user-b")).toEqual([]);
    storeA.close();

    const raw = await readFile(path);
    expect(raw.includes(Buffer.from("only-synthetic-user"))).toBe(false);
    expect(raw.includes(Buffer.from("only-synthetic-password"))).toBe(false);
    expect(raw.includes(Buffer.from("only-synthetic-draft-body"))).toBe(false);

    const storeB = new MailboxStore(path, cipher);
    expect(storeB.list("user-a")).toHaveLength(1);
    expect(storeB.runtimeMailbox("user-a", "mbx_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").credentials.password).toBe("only-synthetic-password");
    expect(storeB.getDraft("user-a", draft.draft_id).text_body).toBe("only-synthetic-draft-body");
    expect(() => storeB.get("user-b", "mbx_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toThrow(/not found/i);
    expect(storeB.deleteAll("user-a").deleted_mailboxes).toBe(1);
    expect(storeB.list("user-a")).toEqual([]);
    storeB.close();
  });

  it("consumes settings tokens exactly once and enforces CSRF", () => {
    const sessions = new OneTimeSettingsSessions(30_000);
    const first = sessions.issue("user-a");
    expect(sessions.consume(first.token, first.csrf).user_key).toBe("user-a");
    expect(() => sessions.consume(first.token, first.csrf)).toThrow(/already used|expired/i);
    const second = sessions.issue("user-a");
    expect(() => sessions.consume(second.token, "wrong-csrf")).toThrow(/CSRF/i);
    expect(() => sessions.consume(second.token, second.csrf)).toThrow(/already used|expired/i);
  });
});

const settings: MailboxSettings = {
  display_name: "Synthetic mailbox",
  email: "operator@example.invalid",
  brand: "OTHER",
  purpose: "Synthetic test only",
  imap_host: "imap.example.invalid",
  imap_port: 993,
  tls_mode: "implicit",
  allowed_folders: ["INBOX"],
  enabled: true,
};

const passResult: MailboxConnectionTestResult = {
  status: "PASS",
  dns_resolution: { success: true, address_count: 1 },
  tcp_connection: { success: true, latency_ms: 1 },
  tls_verification: { success: true, mode: "implicit", certificate: null },
  authentication: { success: true },
  examine: { success: true },
  folder_discovery: { success: true, folders: [{ folder_id: "INBOX", special_use: "\\Inbox", selectable: true }] },
  body_peek: { success: true, flags_before: ["\\Flagged"], flags_after: ["\\Flagged"], unchanged: true, reason: "BODY_PEEK_FLAGS_UNCHANGED" },
  latency_ms: 3,
  error_category: null,
};
