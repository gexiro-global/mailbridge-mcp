import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { CredentialEnvelopeCipher } from "../src/app/crypto.js";
import { createSettingsRouter } from "../src/app/settingsApi.js";
import { OneTimeSettingsSessions } from "../src/app/settingsSessions.js";
import { MailboxStore } from "../src/app/store.js";
import type { MailboxConnectionTester } from "../src/app/connectionTest.js";
import type { MailboxConnectionTestResult } from "../src/app/types.js";
import { testConfig } from "./fixtures.js";

const servers: Server[] = [];
const stores: MailboxStore[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const store of stores.splice(0)) store.close();
});

describe("user-scoped Settings API", () => {
  it("creates, isolates, replaces and deletes synthetic mailbox credentials without echoing them", async () => {
    const config = structuredClone(testConfig);
    config.app.enabled = true;
    config.app.widget_origin = "https://web-sandbox.oaiusercontent.com";
    const sessions = new OneTimeSettingsSessions(30_000);
    const store = new MailboxStore(":memory:", new CredentialEnvelopeCipher("v1", new Map([["v1", Buffer.alloc(32, 5)]])));
    stores.push(store);
    const tester: MailboxConnectionTester = { test: async () => passResult };
    const app = express();
    app.use("/api", createSettingsRouter({ config, sessions, store, tester }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    servers.push(server);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const userA = sessionClient(base, issueSettings(sessions, "user-a"));
    const userB = sessionClient(base, issueSettings(sessions, "user-b"));

    const originalPassword = "synthetic-original-password";
    const created = await userA.call("/mailboxes", "POST", {
      display_name: "Synthetic A",
      email: "operator@example.invalid",
      brand: "OTHER",
      purpose: "Synthetic only",
      imap_host: "imap.example.invalid",
      imap_port: 993,
      tls_mode: "implicit",
      allowed_folders: ["INBOX"],
      enabled: true,
      username: "synthetic-user",
      password: originalPassword,
    });
    expect(created.status).toBe(201);
    expect(created.text).not.toContain(originalPassword);
    expect(created.text).not.toContain("synthetic-user");
    const mailboxId = (created.data as { mailbox: { mailbox_id: string } }).mailbox.mailbox_id;
    expect(mailboxId).toMatch(/^mbx_[a-f0-9]{32}$/);

    const listA = await userA.call("/mailboxes", "GET");
    expect((listA.data as { mailboxes: unknown[] }).mailboxes).toHaveLength(1);
    const listB = await userB.call("/mailboxes", "GET");
    expect((listB.data as { mailboxes: unknown[] }).mailboxes).toHaveLength(0);
    const idor = await userB.call(`/mailboxes/${mailboxId}`, "DELETE", { confirmation: mailboxId });
    expect(idor.status).toBe(404);
    const missingConfirmation = await userA.call(`/mailboxes/${mailboxId}`, "DELETE", {});
    expect(missingConfirmation.status).toBe(400);

    const replacement = "synthetic-replacement-password";
    const replaced = await userA.call(`/mailboxes/${mailboxId}/replace-credentials`, "POST", {
      username: "synthetic-user-2",
      password: replacement,
    });
    expect(replaced.status).toBe(200);
    expect(replaced.text).not.toContain(replacement);
    expect(replaced.text).not.toContain("synthetic-user-2");
    expect(store.runtimeMailbox("user-a", mailboxId).credentials.password).toBe(replacement);
    expect(JSON.stringify(store.auditEvents("user-a"))).not.toMatch(/synthetic|password|username/i);

    const updatedPolicy = await userA.call(`/mailboxes/${mailboxId}/send-policy`, "PATCH", {
      send_mode: "draft_only",
      require_confirmation: true,
      allowed_domains: ["example.invalid"],
      denied_domains: [],
      max_recipients: 4,
      max_per_hour: 8,
      max_per_day: 20,
      external_recipients: "warn",
      confirmation_ttl_seconds: 120,
    });
    expect(updatedPolicy.status).toBe(200);
    expect(updatedPolicy.data).toMatchObject({ policy: {
      mailbox_id: mailboxId,
      send_mode: "draft_only",
      require_confirmation: true,
      max_recipients: 4,
      policy_version: 1,
    } });
    const readPolicy = await userA.call(`/mailboxes/${mailboxId}/send-policy`, "GET");
    expect(readPolicy.data).toEqual(updatedPolicy.data);

    const deleted = await userA.call("/account/data", "DELETE", { confirmation: "DELETE ALL MAILBRIDGE DATA" });
    expect(deleted.status).toBe(200);
    expect((deleted.data as { credentials_deleted: boolean }).credentials_deleted).toBe(true);
    expect(store.list("user-a")).toEqual([]);
  });

  it("rejects wrong origins and a reused one-time token", async () => {
    const config = structuredClone(testConfig);
    config.app.widget_origin = "https://web-sandbox.oaiusercontent.com";
    const sessions = new OneTimeSettingsSessions(30_000);
    const store = new MailboxStore(":memory:", new CredentialEnvelopeCipher("v1", new Map([["v1", Buffer.alloc(32, 5)]])));
    stores.push(store);
    const tester: MailboxConnectionTester = { test: async () => passResult };
    const app = express();
    app.use("/api", createSettingsRouter({ config, sessions, store, tester }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    servers.push(server);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const issued = issueSettings(sessions, "user-a");
    const headers = { Authorization: `Settings ${issued.token}`, "X-MailBridge-CSRF": issued.csrf, Origin: "https://web-sandbox.oaiusercontent.com" };
    expect((await fetch(`${base}/mailboxes`, { headers })).status).toBe(200);
    expect((await fetch(`${base}/mailboxes`, { headers })).status).toBe(401);
    expect((await fetch(`${base}/mailboxes`, { headers: { ...headers, Origin: "https://evil.example" } })).status).toBe(403);
  });

  it("never issues a settings capability without the dedicated write scope", () => {
    const sessions = new OneTimeSettingsSessions(30_000);
    expect(() => sessions.issue("user-a", { scopes: ["mail.read"], client_id: "read-only-client" }))
      .toThrow(/settings scope/i);
  });
});

function issueSettings(sessions: OneTimeSettingsSessions, userKey: string) {
  return sessions.issue(userKey, { scopes: ["mail.settings.write"], client_id: "settings-api-test" });
}

function sessionClient(base: string, initial: { token: string; csrf: string }) {
  let token = initial.token;
  let csrf = initial.csrf;
  return {
    async call(path: string, method: string, body?: unknown) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Settings ${token}`,
          "X-MailBridge-CSRF": csrf,
          Origin: "https://web-sandbox.oaiusercontent.com",
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      token = response.headers.get("x-mailbridge-settings-token") ?? token;
      csrf = response.headers.get("x-mailbridge-settings-csrf") ?? csrf;
      const text = await response.text();
      return { status: response.status, text, data: text ? JSON.parse(text) as unknown : {} };
    },
  };
}

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
