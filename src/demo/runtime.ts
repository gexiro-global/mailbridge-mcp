import { createHmac } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { CredentialEnvelopeCipher } from "../app/crypto.js";
import type { MailboxConnectionTester } from "../app/connectionTest.js";
import type { ScopedMailService } from "../app/serviceFactory.js";
import { OneTimeSettingsSessions } from "../app/settingsSessions.js";
import { MailboxStore } from "../app/store.js";
import type { MailboxSettings, MailboxView } from "../app/types.js";
import { MailBridgeConfigSchema, type MailBridgeConfig, type MailboxConfig } from "../config/schema.js";
import { StableIdCodec } from "../security/stableId.js";
import { MailSendService } from "../services/mailSendService.js";
import { MailService } from "../services/mailService.js";
import { SyntheticImapAdapterFactory, SyntheticMailboxConnectionTester, syntheticConnectionResult } from "./synthetic.js";
import { SyntheticMailTransport } from "./syntheticSend.js";
import { MAILBRIDGE_VERSION } from "../version.js";

export interface LocalDemoOptions {
  runtimePath: string;
  credentialKey: Buffer;
  userKey: Buffer;
  idKey: Buffer;
  port?: number;
  safeSend?: boolean;
}

export interface LocalDemoRuntime {
  config: MailBridgeConfig;
  store: MailboxStore;
  sessions: OneTimeSettingsSessions;
  tester: MailboxConnectionTester;
  userKey: string;
  safeSend: boolean;
  syntheticSendCount(): number;
  services: { create(): ScopedMailService; close(): void };
  close(): void;
}

export async function createLocalDemoRuntimeFromEnvironment(): Promise<LocalDemoRuntime> {
  if (process.env.MAILBRIDGE_LOCAL_DEMO !== "1") {
    throw new Error("Local demo requires MAILBRIDGE_LOCAL_DEMO=1");
  }
  if ((process.env.NODE_ENV ?? "development") === "production") {
    throw new Error("Local demo is forbidden in production mode");
  }
  return createLocalDemoRuntime({
    runtimePath: resolve(process.env.MAILBRIDGE_LOCAL_RUNTIME ?? "./runtime"),
    credentialKey: environmentKey("MAILBRIDGE_LOCAL_CREDENTIAL_KEY"),
    userKey: environmentKey("MAILBRIDGE_LOCAL_USER_KEY"),
    idKey: environmentKey("MAILBRIDGE_LOCAL_ID_KEY"),
    port: parsePort(process.env.MAILBRIDGE_LOCAL_PORT),
  });
}

export async function createSafeSendDemoRuntimeFromEnvironment(): Promise<LocalDemoRuntime> {
  if (process.env.MAILBRIDGE_SAFE_SEND_DEMO !== "1") {
    throw new Error("Safe Send staging requires MAILBRIDGE_SAFE_SEND_DEMO=1");
  }
  if ((process.env.NODE_ENV ?? "development") === "production") {
    throw new Error("Safe Send staging is forbidden in production mode");
  }
  return createLocalDemoRuntime({
    runtimePath: resolve(process.env.MAILBRIDGE_LOCAL_RUNTIME ?? "./runtime-safe-send"),
    credentialKey: environmentKey("MAILBRIDGE_LOCAL_CREDENTIAL_KEY"),
    userKey: environmentKey("MAILBRIDGE_LOCAL_USER_KEY"),
    idKey: environmentKey("MAILBRIDGE_LOCAL_ID_KEY"),
    port: parsePort(process.env.MAILBRIDGE_LOCAL_PORT),
    safeSend: true,
  });
}

export async function createLocalDemoRuntime(options: LocalDemoOptions): Promise<LocalDemoRuntime> {
  assertKey(options.credentialKey, "credentialKey");
  assertKey(options.userKey, "userKey");
  assertKey(options.idKey, "idKey");
  const runtimePath = resolve(options.runtimePath);
  await mkdir(runtimePath, { recursive: true, mode: 0o700 });
  const port = options.port ?? 3091;
  const safeSend = options.safeSend === true;
  const baseUrl = `http://127.0.0.1:${port}`;
  const databasePath = resolve(runtimePath, "mailbridge-local-demo.sqlite");
  const config = MailBridgeConfigSchema.parse({
    server: {
      name: "mailbridge-mcp",
      version: MAILBRIDGE_VERSION,
      bind_host: "127.0.0.1",
      port,
      public_base_url: baseUrl,
      allowed_hosts: ["127.0.0.1", "localhost"],
      allowed_origins: [baseUrl],
      request_max_bytes: 1024 * 1024,
      rate_limit: { window_ms: 60_000, max_requests: 600 },
    },
    auth: {
      mode: "disabled_dev",
      issuer: `${baseUrl}/local-demo-identity`,
      audience: baseUrl,
      jwks_uri: `${baseUrl}/local-demo-jwks-unused`,
      scopes: safeSend
        ? ["mail.read", "mail.health.read", "mail.settings.write", "mail.send"]
        : ["mail.read", "mail.health.read", "mail.settings.write"],
      allowed_subjects: ["local-demo-operator"],
    },
    privacy: {
      snippet_max_chars: 320,
      body_max_chars: 20_000,
      source_max_bytes: 5 * 1024 * 1024,
      audit_retention_days: 1,
    },
    panel: {
      enabled: false,
      bind_host: "127.0.0.1",
      port: 8792,
      allowed_hosts: ["127.0.0.1", "localhost"],
      allowed_origins: [baseUrl],
      operator_username: "local-demo-disabled",
      password_secret: "unused_local_demo_panel_password",
      session_key_secret: "unused_local_demo_panel_session",
      session_timeout_ms: 30 * 60_000,
      secure_cookie: true,
      request_max_bytes: 64 * 1024,
      audit_log_path: resolve(runtimePath, "disabled-admin-audit.jsonl"),
      rate_limit: { window_ms: 60_000, max_requests: 60, max_login_attempts: 5 },
    },
    app: {
      enabled: true,
      database_path: databasePath,
      widget_origin: baseUrl,
      credential_master_key_secret: "local_demo_credential_key",
      credential_key_version: "local-demo-v1",
      user_key_hmac_secret: "local_demo_user_key",
      message_id_hmac_secret: "local_demo_id_key",
      settings_session_ttl_ms: 5 * 60_000,
      max_mailboxes_per_user: 50,
      settings_rate_limit: { window_ms: 60_000, max_requests: 600 },
    },
    mailboxes: [],
  });
  const cipher = new CredentialEnvelopeCipher("local-demo-v1", new Map([
    ["local-demo-v1", Buffer.from(options.credentialKey)],
  ]));
  const store = new MailboxStore(databasePath, cipher, 50);
  const userKey = createHmac("sha256", options.userKey)
    .update(JSON.stringify(["local-demo-identity", "local-demo-operator"]), "utf8")
    .digest("base64url");
  seedSyntheticMailboxes(store, userKey, safeSend);
  const sessions = new OneTimeSettingsSessions(config.app.settings_session_ttl_ms);
  const syntheticTransport = new SyntheticMailTransport();
  const services = new LocalDemoServiceFactory(config, store, userKey, options.idKey, safeSend, syntheticTransport);
  options.credentialKey.fill(0);
  options.userKey.fill(0);
  options.idKey.fill(0);
  let closed = false;
  return {
    config,
    store,
    sessions,
    tester: new SyntheticMailboxConnectionTester(),
    userKey,
    safeSend,
    syntheticSendCount: () => syntheticTransport.sendCount,
    services,
    close: () => {
      if (closed) return;
      closed = true;
      services.close();
      store.close();
    },
  };
}

class LocalDemoServiceFactory {
  readonly #idKey: Buffer;

  constructor(
    readonly baseConfig: MailBridgeConfig,
    readonly store: MailboxStore,
    readonly userKey: string,
    idKey: Buffer,
    readonly safeSend: boolean,
    readonly syntheticTransport: SyntheticMailTransport,
  ) {
    this.#idKey = Buffer.from(idKey);
  }

  create(): ScopedMailService {
    const config = structuredClone(this.baseConfig);
    config.mailboxes = this.store.list(this.userKey).map((view) => toMailboxConfig(view, this.safeSend));
    const service = new MailService(config, new SyntheticImapAdapterFactory(), new StableIdCodec(this.#idKey));
    const writer = this.safeSend
      ? new MailSendService(this.userKey, this.store, service, this.syntheticTransport)
      : undefined;
    return {
      service,
      ...(writer ? { writer } : {}),
      dispose: () => undefined,
    };
  }

  close(): void {
    this.#idKey.fill(0);
  }
}

function seedSyntheticMailboxes(store: MailboxStore, userKey: string, safeSend: boolean): void {
  if (store.list(userKey).length > 0) return;
  const seeds: Array<{ id: string; settings: MailboxSettings }> = [
    {
      id: "mbx_11111111111111111111111111111111",
      settings: {
        display_name: "Atlas — demo",
        email: "operator@atlas.synthetic.invalid",
        brand: "BUSINESS",
        purpose: "Syntetyczna skrzynka demonstracyjna",
        imap_host: "imap.atlas.synthetic.invalid",
        imap_port: 993,
        tls_mode: "implicit",
        allowed_folders: ["INBOX", "Sent"],
        send_enabled: safeSend,
        send_transport: "smtp",
        smtp_host: safeSend ? "smtp.atlas.synthetic.invalid" : null,
        smtp_port: 465,
        smtp_tls_mode: "implicit",
        enabled: true,
      },
    },
    {
      id: "mbx_22222222222222222222222222222222",
      settings: {
        display_name: "PRIVATE — demo",
        email: "operator@private.synthetic.invalid",
        brand: "PRIVATE",
        purpose: "Druga syntetyczna skrzynka demonstracyjna",
        imap_host: "imap.private.synthetic.invalid",
        imap_port: 993,
        tls_mode: "implicit",
        allowed_folders: ["INBOX"],
        send_enabled: safeSend,
        send_transport: "smtp",
        smtp_host: safeSend ? "smtp.private.synthetic.invalid" : null,
        smtp_port: 465,
        smtp_tls_mode: "implicit",
        enabled: true,
      },
    },
  ];
  for (const seed of seeds) {
    store.create(
      userKey,
      seed.id,
      seed.settings,
      { username: "synthetic-local-only", password: "synthetic-local-only" },
      syntheticConnectionResult(seed.settings.tls_mode, seed.settings.allowed_folders),
    );
  }
}

function toMailboxConfig(view: MailboxView, safeSend: boolean): MailboxConfig {
  return {
    id: view.mailbox_id,
    display_name: view.display_name,
    email: view.email,
    brand: view.brand,
    purpose: view.purpose,
    imap_host: view.imap_host,
    imap_port: view.imap_port,
    tls: view.tls_mode === "implicit",
    username_secret: "local_demo_unused_username",
    password_secret: "local_demo_unused_password",
    send_enabled: safeSend && view.send_enabled,
    send_transport: "smtp",
    smtp_host: safeSend ? view.smtp_host : null,
    smtp_port: 465,
    smtp_tls_mode: "implicit",
    enabled: view.enabled,
    folder_access: "all_selectable",
    allowed_folders: view.allowed_folders,
    result_limit: 50,
    tags: safeSend ? ["LOCAL_SYNTHETIC_DEMO", "LOCAL_SYNTHETIC_SAFE_SEND"] : ["LOCAL_SYNTHETIC_DEMO"],
    brand_hints: { organisation_names: [], domains: [], private: view.brand === "PRIVATE" },
  };
}

function environmentKey(name: string): Buffer {
  const encoded = process.env[name];
  if (!encoded) throw new Error(`${name} is required for local demo`);
  const key = /^[A-Za-z0-9_-]+$/.test(encoded)
    ? Buffer.from(encoded, "base64url")
    : Buffer.from(encoded, "base64");
  assertKey(key, name);
  return key;
}

function assertKey(key: Buffer, name: string): void {
  if (key.byteLength !== 32) throw new Error(`${name} must contain exactly 32 bytes`);
}

function parsePort(value: string | undefined): number {
  const port = value ? Number(value) : 3091;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("MAILBRIDGE_LOCAL_PORT is invalid");
  return port;
}
