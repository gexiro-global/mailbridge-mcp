import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import express, { type NextFunction, type Request, type Response } from "express";
import { resolve } from "node:path";
import { MailboxConfigSchema, type MailBridgeConfig, type MailboxConfig } from "../config/schema.js";
import { FileSecretProvider } from "../config/secrets.js";
import { brandConfigurationWarnings } from "../security/brandGuard.js";
import { createRateLimiter } from "../security/rateLimit.js";
import { logger } from "../util/logger.js";
import { AdminAuditStore } from "./audit.js";
import { AdminSessions, parseCookies } from "./auth.js";
import { AdminConfigStore } from "./configStore.js";
import { AdminConnectionTester } from "./connectionTest.js";
import { PANEL_CSS, auditPage, connectionTestPage, errorPage, loginPage, mailboxFormPage, mailboxListPage } from "./html.js";
import type { AdminConnectionTestResult } from "./types.js";

const SESSION_COOKIE = "mb_admin_session";
const LOGIN_CSRF_COOKIE = "mb_admin_login_csrf";

export interface AdminRuntime {
  server: Server;
  close(): Promise<void>;
}

interface ConnectionTester {
  test(config: MailBridgeConfig, mailbox: MailboxConfig): Promise<AdminConnectionTestResult>;
}

export async function startAdminPanel(
  configPath?: string,
  dependencies: {
    configStore?: AdminConfigStore;
    secrets?: FileSecretProvider;
    audit?: AdminAuditStore;
    tester?: ConnectionTester;
    port?: number;
  } = {},
): Promise<AdminRuntime> {
  const selectedConfig = resolve(configPath ?? process.env.MAILBRIDGE_CONFIG ?? "./config/mailboxes.example.yaml");
  const store = dependencies.configStore ?? new AdminConfigStore(selectedConfig);
  const config = await store.load();
  if (!config.panel.enabled) throw new Error("Private admin panel is disabled in configuration");
  const secrets = dependencies.secrets ?? new FileSecretProvider();
  const [password, sessionKey] = await Promise.all([
    secrets.read(config.panel.password_secret),
    secrets.read(config.panel.session_key_secret),
  ]);
  const sessions = new AdminSessions(config.panel.operator_username, password, sessionKey, config.panel.session_timeout_ms);
  const audit = dependencies.audit ?? new AdminAuditStore(config.panel.audit_log_path);
  const tester = dependencies.tester ?? new AdminConnectionTester(secrets);
  const states = new Map<string, AdminConnectionTestResult>();
  const app = express();

  app.disable("x-powered-by");
  app.use(hostGuard(config.panel.allowed_hosts));
  app.use(panelSecurityHeaders);
  app.use(createRateLimiter(config.panel.rate_limit.window_ms, config.panel.rate_limit.max_requests));
  app.use(originGuard(config.panel.allowed_origins));
  app.use(express.urlencoded({ extended: false, limit: config.panel.request_max_bytes }));

  app.get("/robots.txt", (_request, response) => response.type("text/plain").send("User-agent: *\nDisallow: /\n"));
  app.get("/admin/style.css", (_request, response) => response.type("text/css").send(PANEL_CSS));
  app.get("/admin/login", (_request, response) => {
    const csrf = randomBytes(32).toString("base64url");
    response.setHeader("Set-Cookie", cookie(LOGIN_CSRF_COOKIE, csrf, 600));
    response.type("html").send(loginPage(csrf));
  });
  app.post(
    "/admin/login",
    createRateLimiter(config.panel.rate_limit.window_ms, config.panel.rate_limit.max_login_attempts),
    async (request, response) => {
      const cookies = parseCookies(request.header("cookie"));
      const csrf = bodyString(request, "csrf");
      if (!safeTokenEqual(cookies[LOGIN_CSRF_COOKIE], csrf)) {
        response.status(403).type("html").send(errorPage(403, "CSRF validation failed."));
        return;
      }
      const valid = sessions.verifyCredentials(bodyString(request, "username"), bodyString(request, "password"));
      await audit.append({ actor: valid ? config.panel.operator_username : "unknown", mailbox_id: null, action: "LOGIN", result: valid ? "PASS" : "FAIL" });
      if (!valid) {
        response.status(401).type("html").send(loginPage(csrf, true));
        return;
      }
      const created = sessions.create();
      response.setHeader("Set-Cookie", [cookie(SESSION_COOKIE, created.id, Math.floor(config.panel.session_timeout_ms / 1000)), clearCookie(LOGIN_CSRF_COOKIE)]);
      response.redirect(303, "/admin");
    },
  );

  app.use("/admin", (request, response, next) => requireSession(request, response, next, sessions));

  app.get("/admin", async (_request, response) => {
    const current = await store.load();
    const warnings = new Map(current.mailboxes.map((mailbox) => [mailbox.id, brandConfigurationWarnings(mailbox, current.mailboxes)]));
    response.type("html").send(mailboxListPage(current.mailboxes, states, warnings, response.locals.session.csrf));
  });
  app.get("/admin/mailboxes/new", (_request, response) => {
    response.type("html").send(mailboxFormPage(null, response.locals.session.csrf));
  });
  app.get("/admin/mailboxes/:mailboxId/edit", async (request, response) => {
    const mailbox = requiredMailbox(await store.load(), request.params.mailboxId ?? "");
    response.type("html").send(mailboxFormPage(mailbox, response.locals.session.csrf));
  });
  app.post("/admin/mailboxes", async (request, response) => {
    requireCsrf(request, response);
    if (response.headersSent) return;
    await saveMailbox(request, response, null, store, secrets, audit);
  });
  app.post("/admin/mailboxes/:mailboxId/save", async (request, response) => {
    requireCsrf(request, response);
    if (response.headersSent) return;
    const current = requiredMailbox(await store.load(), request.params.mailboxId ?? "");
    await saveMailbox(request, response, current, store, secrets, audit);
  });
  app.post("/admin/mailboxes/:mailboxId/toggle", async (request, response) => {
    requireCsrf(request, response);
    if (response.headersSent) return;
    const mailbox = requiredMailbox(await store.load(), request.params.mailboxId ?? "");
    await store.setEnabled(mailbox.id, !mailbox.enabled);
    await audit.append({ actor: response.locals.session.actor, mailbox_id: mailbox.id, action: mailbox.enabled ? "MAILBOX_DISABLED" : "MAILBOX_ENABLED", result: "PASS" });
    response.redirect(303, "/admin");
  });
  app.post("/admin/mailboxes/:mailboxId/test", async (request, response) => {
    requireCsrf(request, response);
    if (response.headersSent) return;
    const current = await store.load();
    const mailbox = requiredMailbox(current, request.params.mailboxId ?? "");
    const result = await tester.test(current, mailbox);
    if (result.status !== "PASS") result.last_successful_check = states.get(mailbox.id)?.last_successful_check ?? null;
    states.set(mailbox.id, result);
    await audit.append({ actor: response.locals.session.actor, mailbox_id: mailbox.id, action: "IMAP_CONNECTION_TEST", result: result.status });
    response.status(result.status === "PASS" ? 200 : 422).type("html").send(connectionTestPage(mailbox, result, response.locals.session.csrf));
  });
  app.post("/admin/mailboxes/:mailboxId/folders", async (request, response) => {
    requireCsrf(request, response);
    if (response.headersSent) return;
    const mailboxId = request.params.mailboxId ?? "";
    requiredMailbox(await store.load(), mailboxId);
    const folders = bodyStrings(request, "folder");
    if (folders.length === 0) {
      response.status(422).type("html").send(errorPage(422, "At least one folder must remain enabled."));
      return;
    }
    await store.setFolders(mailboxId, folders);
    await audit.append({ actor: response.locals.session.actor, mailbox_id: mailboxId, action: "FOLDER_ALLOWLIST_UPDATED", result: "PASS" });
    response.redirect(303, `/admin/mailboxes/${encodeURIComponent(mailboxId)}/edit`);
  });
  app.get("/admin/audit", async (_request, response) => {
    response.type("html").send(auditPage(await audit.recent(200, config.privacy.audit_retention_days)));
  });
  app.post("/admin/logout", async (request, response) => {
    requireCsrf(request, response);
    if (response.headersSent) return;
    const sessionId = parseCookies(request.header("cookie"))[SESSION_COOKIE];
    sessions.destroy(sessionId);
    await audit.append({ actor: response.locals.session.actor, mailbox_id: null, action: "LOGOUT", result: "PASS" });
    response.setHeader("Set-Cookie", clearCookie(SESSION_COOKIE));
    response.redirect(303, "/admin/login");
  });
  app.use((_request, response) => response.status(404).type("html").send(errorPage(404, "Not found.")));
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    logger.warn({ error_category: error instanceof Error ? error.name : "UnknownError" }, "admin_request_failed");
    if (!response.headersSent) response.status(400).type("html").send(errorPage(400, "Request could not be processed."));
  });

  const httpServer = app.listen(dependencies.port ?? config.panel.port, config.panel.bind_host);
  await waitForListening(httpServer);
  const address = httpServer.address();
  logger.info({ bind_host: config.panel.bind_host, port: typeof address === "object" && address ? address.port : config.panel.port }, "admin_panel_started");
  const close = async (): Promise<void> => {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    await new Promise<void>((done) => httpServer.close(() => done()));
  };
  const shutdown = (): void => { void close(); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return { server: httpServer, close };
}

async function saveMailbox(
  request: Request,
  response: Response,
  current: MailboxConfig | null,
  store: AdminConfigStore,
  secrets: FileSecretProvider,
  audit: AdminAuditStore,
): Promise<void> {
  let mailbox: MailboxConfig;
  try {
    mailbox = parseMailbox(request, current);
  } catch {
    await audit.append({ actor: response.locals.session.actor, mailbox_id: current?.id ?? null, action: "MAILBOX_CONFIG_UPDATE", result: "FAIL" });
    response.status(422).type("html").send(mailboxFormPage(current, response.locals.session.csrf, "Invalid mailbox configuration."));
    return;
  }
  const usernameValue = bodyString(request, "username_value");
  const passwordValue = bodyString(request, "password_value");
  if (usernameValue) {
    await secrets.replace(mailbox.username_secret, usernameValue);
    await audit.append({ actor: response.locals.session.actor, mailbox_id: mailbox.id, action: "USERNAME_SECRET_REPLACED", result: "PASS" });
  }
  if (passwordValue) {
    await secrets.replace(mailbox.password_secret, passwordValue);
    await audit.append({ actor: response.locals.session.actor, mailbox_id: mailbox.id, action: "PASSWORD_SECRET_REPLACED", result: "PASS" });
  }
  await store.upsert(mailbox);
  await audit.append({ actor: response.locals.session.actor, mailbox_id: mailbox.id, action: current ? "MAILBOX_CONFIG_UPDATED" : "MAILBOX_CONFIG_CREATED", result: "PASS" });
  response.redirect(303, "/admin");
}

function parseMailbox(request: Request, current: MailboxConfig | null): MailboxConfig {
  const email = bodyString(request, "email");
  const brand = bodyString(request, "brand");
  if (!new Set(["GENERAL", "BUSINESS", "PRIVATE", "OTHER"]).has(brand)) throw new Error("Invalid brand");
  const domain = email.split("@")[1]?.toLowerCase();
  return MailboxConfigSchema.parse({
    id: current?.id ?? bodyString(request, "mailbox_id"),
    display_name: bodyString(request, "display_name"),
    email,
    brand,
    purpose: bodyString(request, "purpose"),
    imap_host: bodyString(request, "imap_host"),
    imap_port: Number(bodyString(request, "imap_port")),
    tls: bodyString(request, "tls_mode") === "implicit",
    username_secret: bodyString(request, "username_secret"),
    password_secret: bodyString(request, "password_secret"),
    enabled: bodyString(request, "enabled") === "on",
    allowed_folders: splitList(bodyString(request, "allowed_folders")),
    result_limit: Number(bodyString(request, "result_limit")),
    tags: splitList(bodyString(request, "tags")),
    brand_hints: current?.brand_hints ?? {
      organisation_names: brand === "OTHER" ? [] : [brand],
      domains: domain ? [domain] : [],
      private: brand === "PRIVATE",
    },
  });
}

function requireSession(request: Request, response: Response, next: NextFunction, sessions: AdminSessions): void {
  if (request.path === "/login" || request.path === "/style.css") { next(); return; }
  const id = parseCookies(request.header("cookie"))[SESSION_COOKIE];
  const session = sessions.get(id);
  if (!session) {
    if (request.method === "GET") response.redirect(303, "/admin/login");
    else response.status(401).type("html").send(errorPage(401, "Authentication required."));
    return;
  }
  response.locals.session = session;
  next();
}

function requireCsrf(request: Request, response: Response): void {
  if (!safeTokenEqual(response.locals.session?.csrf, bodyString(request, "csrf"))) {
    response.status(403).type("html").send(errorPage(403, "CSRF validation failed."));
  }
}

function panelSecurityHeaders(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; img-src 'none'; script-src 'none'; connect-src 'none'");
  next();
}

function hostGuard(allowedHosts: string[]) {
  const allowed = new Set(allowedHosts.map((value) => value.toLowerCase()));
  return (request: Request, response: Response, next: NextFunction): void => {
    const host = request.hostname.toLowerCase();
    if (!allowed.has(host)) { response.status(403).type("html").send(errorPage(403, "Host not allowed.")); return; }
    next();
  };
}

function originGuard(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins);
  return (request: Request, response: Response, next: NextFunction): void => {
    const origin = request.header("origin");
    if (origin && !allowed.has(origin)) { response.status(403).type("html").send(errorPage(403, "Origin not allowed.")); return; }
    next();
  };
}

function cookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}
function clearCookie(name: string): string { return `${name}=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`; }
function bodyString(request: Request, name: string): string { const value: unknown = request.body?.[name]; return typeof value === "string" ? value.trim() : ""; }
function bodyStrings(request: Request, name: string): string[] { const value: unknown = request.body?.[name]; return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : typeof value === "string" ? [value] : []; }
function splitList(value: string): string[] { return [...new Set(value.split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean))]; }
function safeTokenEqual(left: string | undefined, right: string | undefined): boolean { if (!left || !right) return false; const a = createHash("sha256").update(left).digest(); const b = createHash("sha256").update(right).digest(); return timingSafeEqual(a, b); }
function requiredMailbox(config: MailBridgeConfig, mailboxId: string): MailboxConfig { const mailbox = config.mailboxes.find((value) => value.id === mailboxId); if (!mailbox) throw new Error("Unknown mailbox"); return mailbox; }
function waitForListening(server: Server): Promise<void> { return new Promise((resolvePromise, rejectPromise) => { const onError = (error: Error): void => { server.off("listening", onListening); rejectPromise(error); }; const onListening = (): void => { server.off("error", onError); resolvePromise(); }; server.once("error", onError); server.once("listening", onListening); }); }
