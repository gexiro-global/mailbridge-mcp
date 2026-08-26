import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { AdminAuditStore } from "../src/admin/audit.js";
import { AdminConfigStore } from "../src/admin/configStore.js";
import { startAdminPanel, type AdminRuntime } from "../src/admin/server.js";
import { FileSecretProvider } from "../src/config/secrets.js";
import { testConfig } from "./fixtures.js";

const runtimes: AdminRuntime[] = [];
afterEach(async () => Promise.all(runtimes.splice(0).map((runtime) => runtime.close())));

describe("private admin panel", () => {
  it("persists a targeted mailbox configuration change with schema validation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mailbridge-admin-config-"));
    const configPath = join(directory, "mailboxes.yaml");
    await writeFile(configPath, stringify(testConfig), "utf8");
    const store = new AdminConfigStore(configPath);
    await store.setEnabled("brand_a", false);
    expect((await store.load()).mailboxes.find((mailbox) => mailbox.id === "brand_a")?.enabled).toBe(false);
  });

  it("enforces private browser controls, CSRF and secret non-disclosure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mailbridge-admin-"));
    const config = structuredClone(testConfig);
    config.panel.enabled = true;
    config.panel.allowed_origins = ["https://admin.example.test"];
    config.panel.audit_log_path = join(directory, "audit.jsonl");
    const configPath = join(directory, "mailboxes.yaml");
    await writeFile(configPath, stringify(config), "utf8");
    const secrets = new FileSecretProvider(join(directory, "secrets"));
    await secrets.replace(config.panel.password_secret, "correct horse battery staple");
    await secrets.replace(config.panel.session_key_secret, "0123456789abcdef0123456789abcdef");
    const runtime = await startAdminPanel(configPath, { secrets, audit: new AdminAuditStore(config.panel.audit_log_path), port: 0 });
    runtimes.push(runtime);
    const address = runtime.server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;

    const login = await fetch(`${base}/admin/login`);
    const html = await login.text();
    expect(login.status).toBe(200);
    expect(login.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(login.headers.get("x-robots-tag")).toContain("noindex");
    expect(login.headers.get("set-cookie")).toMatch(/HttpOnly; Secure; SameSite=Strict/);
    expect(html).not.toContain("<script");
    expect(html).toContain('autocomplete="current-password"');

    const unauthenticated = await fetch(`${base}/admin`, { redirect: "manual" });
    expect(unauthenticated.status).toBe(303);

    expect(await requestWithHost(address.port, "evil.example.invalid")).toBe(403);
    const rejectedOrigin = await fetch(`${base}/admin/login`, { headers: { origin: "https://evil.example.invalid" } });
    expect(rejectedOrigin.status).toBe(403);

    const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
    const loginCookie = /mb_admin_login_csrf=([^;]+)/.exec(login.headers.get("set-cookie") ?? "")?.[1];
    expect(csrf).toBeTruthy();
    expect(loginCookie).toBeTruthy();
    const body = new URLSearchParams({ csrf: csrf!, username: config.panel.operator_username, password: "correct horse battery staple" });
    const authenticated = await fetch(`${base}/admin/login`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: `mb_admin_login_csrf=${loginCookie}`, origin: "https://admin.example.test" },
      body,
    });
    expect(authenticated.status).toBe(303);
    const sessionCookie = /mb_admin_session=([^;,]+)/.exec(authenticated.headers.get("set-cookie") ?? "")?.[1];
    expect(sessionCookie).toBeTruthy();

    const panel = await fetch(`${base}/admin`, { headers: { cookie: `mb_admin_session=${sessionCookie}` } });
    const panelHtml = await panel.text();
    expect(panel.status).toBe(200);
    expect(panelHtml).toContain("Mailboxes");
    expect(panelHtml).not.toContain("correct horse battery staple");
    const audit = await readFile(config.panel.audit_log_path, "utf8");
    expect(audit).toContain('"action":"LOGIN"');
    expect(audit).not.toContain("correct horse battery staple");
  });
});

function requestWithHost(port: number, host: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path: "/admin/login", headers: { host } }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
    });
    request.once("error", reject);
    request.end();
  });
}
