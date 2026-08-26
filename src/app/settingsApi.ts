import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { MailBridgeConfig } from "../config/schema.js";
import type { MailboxConnectionTester } from "./connectionTest.js";
import type { OneTimeSettingsSessions } from "./settingsSessions.js";
import type { MailboxStore } from "./store.js";
import {
  CreateMailboxRequestSchema,
  CredentialsSchema,
  MailboxSettingsSchema,
  SendPolicySchema,
  TestMailboxRequestSchema,
  UpdateMailboxRequestSchema,
  type MailboxCredentials,
  type MailboxSettings,
} from "./types.js";

const mailboxId = z.string().min(5).max(64).regex(/^mbx_[a-z0-9_]+$/);
const enabledSchema = z.object({}).strict();
const deleteAllSchema = z.object({ confirmation: z.literal("DELETE ALL MAILBRIDGE DATA") }).strict();
const deleteMailboxSchema = z.object({ confirmation: z.string().min(5).max(64) }).strict();

type SettingsResponse = Response<unknown, {
  user_key: string;
  session_expires_at_ms: number;
  scopes: string[];
  client_id: string;
}>;

export interface SettingsApiDependencies {
  config: MailBridgeConfig;
  store: MailboxStore;
  sessions: OneTimeSettingsSessions;
  tester: MailboxConnectionTester;
  localDemo?: boolean;
}

export function createSettingsRouter(deps: SettingsApiDependencies): Router {
  const router = express.Router();
  const origin = deps.config.app.widget_origin.replace(/\/$/, "");
  router.use((request, response, next) => settingsCors(request, response, next, origin, deps.localDemo === true));
  router.options("/{*path}", (_request, response) => response.status(204).end());
  router.use(express.json({ limit: "64kb", type: ["application/json", "application/*+json"] }));
  router.use(rateLimit({
    windowMs: deps.config.app.settings_rate_limit.window_ms,
    limit: deps.config.app.settings_rate_limit.max_requests,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }));
  router.use((request, response, next) => authorizeSettings(request, response as SettingsResponse, next, deps));

  router.get("/mailboxes", (_request, response: SettingsResponse) => {
    response.json({ mailboxes: deps.store.list(response.locals.user_key) });
  });

  router.post("/mailboxes/test", async (request, response: SettingsResponse, next) => {
    let credentials: MailboxCredentials | undefined;
    try {
      const input = TestMailboxRequestSchema.parse(request.body);
      credentials = { username: input.username, password: input.password };
      const result = await deps.tester.test(settingsFrom(input), credentials);
      response.status(result.status === "PASS" ? 200 : 422).json({ test: result });
    } catch (error) {
      next(error);
    } finally {
      clearCredentials(credentials, request.body);
    }
  });

  router.post("/mailboxes", async (request, response: SettingsResponse, next) => {
    let credentials: MailboxCredentials | undefined;
    try {
      const input = CreateMailboxRequestSchema.parse(request.body);
      credentials = { username: input.username, password: input.password };
      const settings = settingsFrom(input);
      const test = await deps.tester.test(settings, credentials);
      if (test.status !== "PASS") {
        response.status(422).json({ error: "connection_test_failed", test });
        return;
      }
      const id = `mbx_${randomUUID().replaceAll("-", "")}`;
      const mailbox = deps.store.create(response.locals.user_key, id, settings, credentials, test);
      response.status(201).json({ mailbox, test });
    } catch (error) {
      next(error);
    } finally {
      clearCredentials(credentials, request.body);
    }
  });

  router.patch("/mailboxes/:mailboxId", (request, response: SettingsResponse, next) => {
    try {
      const id = mailboxId.parse(request.params.mailboxId);
      const patch = UpdateMailboxRequestSchema.parse(request.body);
      const current = deps.store.get(response.locals.user_key, id);
      const settings = MailboxSettingsSchema.parse({ ...current, ...patch, enabled: false });
      const mailbox = deps.store.update(response.locals.user_key, id, settings);
      response.json({ mailbox, retest_required: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/mailboxes/:mailboxId/test", async (request, response: SettingsResponse, next) => {
    let credentials: MailboxCredentials | undefined;
    try {
      enabledSchema.parse(request.body ?? {});
      const id = mailboxId.parse(request.params.mailboxId);
      const runtime = deps.store.runtimeMailbox(response.locals.user_key, id);
      credentials = runtime.credentials;
      const test = await deps.tester.test(settingsFrom(runtime.view), credentials);
      const mailbox = deps.store.recordHealth(response.locals.user_key, id, test);
      response.status(test.status === "PASS" ? 200 : 422).json({ mailbox, test });
    } catch (error) {
      next(error);
    } finally {
      clearCredentials(credentials, request.body);
    }
  });

  router.post("/mailboxes/:mailboxId/replace-credentials", async (request, response: SettingsResponse, next) => {
    let credentials: MailboxCredentials | undefined;
    try {
      const id = mailboxId.parse(request.params.mailboxId);
      credentials = CredentialsSchema.parse(request.body);
      const current = deps.store.get(response.locals.user_key, id);
      const test = await deps.tester.test(settingsFrom(current), credentials);
      if (test.status !== "PASS") {
        response.status(422).json({ error: "connection_test_failed", test });
        return;
      }
      const mailbox = deps.store.replaceCredentials(response.locals.user_key, id, credentials, test);
      response.json({ mailbox, test });
    } catch (error) {
      next(error);
    } finally {
      clearCredentials(credentials, request.body);
    }
  });

  router.post("/mailboxes/:mailboxId/enable", (request, response: SettingsResponse, next) => {
    setEnabled(request, response, next, deps, true);
  });
  router.post("/mailboxes/:mailboxId/disable", (request, response: SettingsResponse, next) => {
    setEnabled(request, response, next, deps, false);
  });

  router.get("/mailboxes/:mailboxId/send-policy", (request, response: SettingsResponse, next) => {
    try {
      const id = mailboxId.parse(request.params.mailboxId);
      response.json({ policy: deps.store.getSendPolicy(response.locals.user_key, id) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/mailboxes/:mailboxId/send-policy", (request, response: SettingsResponse, next) => {
    try {
      const id = mailboxId.parse(request.params.mailboxId);
      const policy = SendPolicySchema.parse(request.body);
      response.json({ policy: deps.store.setSendPolicy(response.locals.user_key, id, policy) });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/mailboxes/:mailboxId", (request, response: SettingsResponse, next) => {
    try {
      const id = mailboxId.parse(request.params.mailboxId);
      const confirmation = deleteMailboxSchema.parse(request.body);
      if (confirmation.confirmation !== id) throw new Error("Mailbox deletion confirmation did not match");
      deps.store.deleteMailbox(response.locals.user_key, id);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.delete("/account/data", (request, response: SettingsResponse, next) => {
    try {
      deleteAllSchema.parse(request.body);
      const userKey = response.locals.user_key;
      const result = deps.store.deleteAll(userKey);
      deps.sessions.revokeUser(userKey);
      response.json({ ...result, credentials_deleted: true });
    } catch (error) {
      next(error);
    }
  });

  router.use((error: unknown, _request: Request, response: SettingsResponse, _next: NextFunction) => {
    const validation = error instanceof z.ZodError;
    const notFound = error instanceof Error && error.message === "Mailbox not found";
    response.status(validation ? 400 : notFound ? 404 : 422).json({
      error: validation ? "invalid_request" : notFound ? "mailbox_not_found" : "settings_operation_failed",
    });
  });
  return router;
}

function authorizeSettings(
  request: Request,
  response: SettingsResponse,
  next: NextFunction,
  deps: SettingsApiDependencies,
): void {
  const match = /^Settings\s+([A-Za-z0-9_-]{20,256})$/.exec(request.header("authorization") ?? "");
  const csrf = request.header("x-mailbridge-csrf") ?? "";
  try {
    if (!match?.[1]) throw new Error("Missing settings authorization");
    const consumed = deps.sessions.consume(match[1], csrf);
    if (!consumed.scopes.includes("mail.settings.write")) throw new Error("Mailbox settings scope is required");
    const rotated = deps.sessions.issue(consumed.user_key, {
      scopes: consumed.scopes,
      client_id: consumed.client_id,
      oauth_expires_at_seconds: Math.floor(consumed.expires_at_ms / 1000),
    });
    response.locals.user_key = consumed.user_key;
    response.locals.session_expires_at_ms = consumed.expires_at_ms;
    response.locals.scopes = consumed.scopes;
    response.locals.client_id = consumed.client_id;
    response.setHeader("Access-Control-Expose-Headers", "X-MailBridge-Settings-Token, X-MailBridge-Settings-CSRF, X-MailBridge-Settings-Expires");
    response.setHeader("X-MailBridge-Settings-Token", rotated.token);
    response.setHeader("X-MailBridge-Settings-CSRF", rotated.csrf);
    response.setHeader("X-MailBridge-Settings-Expires", rotated.expires_at);
    next();
  } catch {
    response.status(401).json({ error: "settings_authorization_invalid" });
  }
}

function settingsCors(
  request: Request,
  response: Response,
  next: NextFunction,
  allowedOrigin: string,
  localDemo: boolean,
): void {
  const requestOrigin = request.header("origin")?.replace(/\/$/, "");
  if (requestOrigin !== allowedOrigin && !(localDemo && !requestOrigin)) {
    response.status(403).json({ error: "origin_not_allowed" });
    return;
  }
  response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-MailBridge-CSRF");
  response.setHeader("Cache-Control", "no-store");
  next();
}

function setEnabled(
  request: Request,
  response: SettingsResponse,
  next: NextFunction,
  deps: SettingsApiDependencies,
  enabled: boolean,
): void {
  try {
    enabledSchema.parse(request.body ?? {});
    const id = mailboxId.parse(request.params.mailboxId);
    response.json({ mailbox: deps.store.setEnabled(response.locals.user_key, id, enabled) });
  } catch (error) {
    next(error);
  }
}

function settingsFrom(value: Omit<MailboxSettings, "enabled"> & { enabled?: boolean }): MailboxSettings {
  const parsed = MailboxSettingsSchema.parse({
    display_name: value.display_name,
    email: value.email,
    brand: value.brand,
    purpose: value.purpose,
    imap_host: value.imap_host,
    imap_port: value.imap_port,
    tls_mode: value.tls_mode,
    allowed_folders: value.allowed_folders,
    send_enabled: value.send_enabled,
    send_transport: value.send_transport,
    smtp_host: value.smtp_host,
    smtp_port: value.smtp_port,
    smtp_tls_mode: value.smtp_tls_mode,
    enabled: value.enabled ?? false,
  });
  if (parsed.send_enabled && !parsed.smtp_host) throw new Error("SMTP hostname is required when sending is enabled");
  return parsed;
}

function clearCredentials(credentials: MailboxCredentials | undefined, body: unknown): void {
  if (credentials) {
    credentials.username = "";
    credentials.password = "";
  }
  if (body && typeof body === "object") {
    const mutable = body as Record<string, unknown>;
    if ("username" in mutable) mutable.username = "";
    if ("password" in mutable) mutable.password = "";
  }
}
