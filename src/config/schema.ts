import { z } from "zod";

const secretReference = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/, "Secret references must be simple filenames");

const mailboxId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/, "mailbox id must be lowercase and URL-safe");

const brandId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Z][A-Z0-9_-]*$/, "brand must be an uppercase identifier");

const PanelConfigSchema = z.object({
  enabled: z.boolean().default(false),
  bind_host: z.string().min(1).default("127.0.0.1"),
  port: z.number().int().min(1).max(65535).default(8792),
  allowed_hosts: z.array(z.string().min(1)).min(1).max(16).default(["127.0.0.1", "localhost"]),
  allowed_origins: z.array(z.url()).min(1).max(16).default(["https://127.0.0.1:8792", "https://localhost:8792"]),
  operator_username: z.string().min(3).max(64).default("operator"),
  password_secret: secretReference.default("panel_operator_password"),
  session_key_secret: secretReference.default("panel_session_hmac_key"),
  session_timeout_ms: z.number().int().min(5 * 60 * 1000).max(8 * 60 * 60 * 1000).default(30 * 60 * 1000),
  secure_cookie: z.literal(true).default(true),
  request_max_bytes: z.number().int().min(1024).max(256 * 1024).default(64 * 1024),
  audit_log_path: z.string().min(1).max(1024).default("./data/admin-audit.jsonl"),
  rate_limit: z.object({
    window_ms: z.number().int().min(1000).max(60 * 60 * 1000).default(60_000),
    max_requests: z.number().int().min(1).max(1000).default(60),
    max_login_attempts: z.number().int().min(1).max(100).default(5),
  }).default({ window_ms: 60_000, max_requests: 60, max_login_attempts: 5 }),
});

const PrivateAppConfigSchema = z.object({
  enabled: z.boolean().default(false),
  database_path: z.string().min(1).max(1024).default("./data/mailbridge-private.sqlite"),
  widget_origin: z.url().default("https://web-sandbox.oaiusercontent.com"),
  credential_master_key_secret: secretReference.default("mailbridge_credential_master_key"),
  credential_key_version: z.string().min(1).max(64).default("v1"),
  user_key_mode: z.enum(["oauth_subject", "fixed_private_owner"]).default("oauth_subject"),
  user_key_hmac_secret: secretReference.default("mailbridge_user_key_hmac"),
  fixed_owner_user_key_secret: secretReference.default("mailbridge_fixed_owner_user_key"),
  message_id_hmac_secret: secretReference.default("mailbridge_id_hmac_key"),
  settings_session_ttl_ms: z.number().int().min(30_000).max(10 * 60_000).default(5 * 60_000),
  max_mailboxes_per_user: z.number().int().min(1).max(100).default(50),
  settings_rate_limit: z.object({
    window_ms: z.number().int().min(1000).max(60 * 60 * 1000).default(60_000),
    max_requests: z.number().int().min(1).max(1000).default(60),
  }).default({ window_ms: 60_000, max_requests: 60 }),
});

export const MailboxConfigSchema = z.object({
  id: mailboxId,
  display_name: z.string().min(1).max(160),
  email: z.email(),
  brand: brandId,
  purpose: z.string().min(1).max(300),
  imap_host: z.string().min(1).max(253),
  imap_port: z.number().int().min(1).max(65535).default(993),
  tls: z.boolean().default(true),
  username_secret: secretReference,
  password_secret: secretReference,
  send_enabled: z.boolean().default(false),
  send_transport: z.literal("smtp").default("smtp"),
  smtp_host: z.string().min(1).max(253).nullable().default(null),
  smtp_port: z.number().int().min(1).max(65535).default(465),
  smtp_tls_mode: z.enum(["implicit", "starttls"]).default("implicit"),
  enabled: z.boolean().default(false),
  folder_access: z.enum(["allowlist", "all_selectable"]).default("allowlist"),
  allowed_folders: z.array(z.string().min(1).max(512)).min(1).max(100),
  result_limit: z.number().int().min(1).max(100).default(50),
  tags: z.array(z.string().min(1).max(64)).max(32).default([]),
  brand_hints: z
    .object({
      organisation_names: z.array(z.string().min(2).max(160)).max(64).default([]),
      domains: z.array(z.string().min(3).max(253)).max(64).default([]),
      private: z.boolean().default(false),
    })
    .default({ organisation_names: [], domains: [], private: false }),
});

export const MailBridgeConfigSchema = z
  .object({
    server: z.object({
      name: z.literal("mailbridge-mcp"),
      version: z.string().regex(/^\d+\.\d+\.\d+$/),
      bind_host: z.string().min(1).default("127.0.0.1"),
      port: z.number().int().min(1).max(65535).default(3091),
      public_base_url: z.url(),
      allowed_hosts: z.array(z.string().min(1)).min(1).max(64),
      allowed_origins: z.array(z.url()).max(64).default([]),
      request_max_bytes: z.number().int().min(1024).max(10 * 1024 * 1024).default(1024 * 1024),
      rate_limit: z.object({
        window_ms: z.number().int().min(1000).max(60 * 60 * 1000).default(60_000),
        max_requests: z.number().int().min(1).max(10_000).default(60),
      }),
    }),
    auth: z.object({
      mode: z.enum(["oauth", "cloudflare_access", "disabled_dev"]),
      issuer: z.url(),
      audience: z.url(),
      jwks_uri: z.url(),
      scopes: z.array(z.string().min(1).max(128)).min(1).max(32),
      allowed_subjects: z.array(z.string().min(1).max(512)).max(128).default([]),
      access_audience: z.string().min(1).max(512).optional(),
    }),
    privacy: z.object({
      snippet_max_chars: z.number().int().min(80).max(1000).default(320),
      body_max_chars: z.number().int().min(1000).max(100_000).default(20_000),
      source_max_bytes: z.number().int().min(64 * 1024).max(20 * 1024 * 1024).default(5 * 1024 * 1024),
      attachment_max_bytes: z.number().int().min(64 * 1024).max(25 * 1024 * 1024).default(25 * 1024 * 1024),
      audit_retention_days: z.number().int().min(1).max(365).default(30),
    }),
    panel: PanelConfigSchema.default({
      enabled: false,
      bind_host: "127.0.0.1",
      port: 8792,
      allowed_hosts: ["127.0.0.1", "localhost"],
      allowed_origins: ["https://127.0.0.1:8792", "https://localhost:8792"],
      operator_username: "operator",
      password_secret: "panel_operator_password",
      session_key_secret: "panel_session_hmac_key",
      session_timeout_ms: 30 * 60 * 1000,
      secure_cookie: true,
      request_max_bytes: 64 * 1024,
      audit_log_path: "./data/admin-audit.jsonl",
      rate_limit: { window_ms: 60_000, max_requests: 60, max_login_attempts: 5 },
    }),
    app: PrivateAppConfigSchema.default({
      enabled: false,
      database_path: "./data/mailbridge-private.sqlite",
      widget_origin: "https://web-sandbox.oaiusercontent.com",
      credential_master_key_secret: "mailbridge_credential_master_key",
      credential_key_version: "v1",
      user_key_mode: "oauth_subject",
      user_key_hmac_secret: "mailbridge_user_key_hmac",
      fixed_owner_user_key_secret: "mailbridge_fixed_owner_user_key",
      message_id_hmac_secret: "mailbridge_id_hmac_key",
      settings_session_ttl_ms: 5 * 60_000,
      max_mailboxes_per_user: 50,
      settings_rate_limit: { window_ms: 60_000, max_requests: 60 },
    }),
    mailboxes: z.array(MailboxConfigSchema).max(100),
  })
  .superRefine((config, context) => {
    const ids = new Set<string>();
    for (const mailbox of config.mailboxes) {
      if (ids.has(mailbox.id)) {
        context.addIssue({
          code: "custom",
          path: ["mailboxes"],
          message: `Duplicate mailbox id: ${mailbox.id}`,
        });
      }
      ids.add(mailbox.id);
    }
  });

export type MailboxConfig = z.infer<typeof MailboxConfigSchema>;
export type MailBridgeConfig = z.infer<typeof MailBridgeConfigSchema>;

export function assertRuntimeSafety(config: MailBridgeConfig, environment: string): void {
  const loopback = new Set(["127.0.0.1", "localhost", "::1"]);
  const publicUrl = new URL(config.server.public_base_url);
  const issuerUrl = new URL(config.auth.issuer);
  const audienceUrl = new URL(config.auth.audience);
  const jwksUrl = new URL(config.auth.jwks_uri);
  const widgetUrl = new URL(config.app.widget_origin);

  if (environment === "production" && !["oauth", "cloudflare_access"].includes(config.auth.mode)) {
    throw new Error("Production HTTP requires an authenticated OAuth mode");
  }
  if (config.auth.mode === "disabled_dev" && !loopback.has(config.server.bind_host)) {
    throw new Error("disabled_dev authentication may bind only to loopback");
  }
  if (!loopback.has(config.panel.bind_host)) {
    throw new Error("Private admin panel may bind only to loopback");
  }
  if (environment === "production" && !config.app.enabled) {
    throw new Error("Production ChatGPT App mode must be explicitly enabled");
  }
  if (environment === "production") {
    for (const [label, url] of [
      ["server.public_base_url", publicUrl],
      ["auth.issuer", issuerUrl],
      ["auth.audience", audienceUrl],
      ["auth.jwks_uri", jwksUrl],
      ["app.widget_origin", widgetUrl],
    ] as const) {
      if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS in production`);
    }
    if (loopback.has(publicUrl.hostname)) {
      throw new Error("Production public_base_url must be reachable from every authorized device, not loopback");
    }
    if (publicUrl.origin !== audienceUrl.origin) {
      throw new Error("OAuth audience must use the same origin as public_base_url");
    }
    if (!config.server.allowed_hosts.includes(publicUrl.hostname)) {
      throw new Error("Production allowed_hosts must include the public_base_url hostname");
    }
    if (config.auth.allowed_subjects.length === 0) {
      throw new Error("Private production mode requires an explicit OAuth subject allowlist");
    }
    if (config.auth.mode === "cloudflare_access" && !config.auth.access_audience) {
      throw new Error("Cloudflare Access mode requires the immutable Access application AUD tag");
    }
    if (config.app.user_key_mode === "fixed_private_owner" && config.auth.allowed_subjects.length !== 1) {
      throw new Error("fixed_private_owner mode requires exactly one allowed OAuth subject");
    }
  }
}
