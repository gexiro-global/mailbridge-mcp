import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { MailBridgeConfig } from "../config/schema.js";
import type { FileSecretProvider } from "../config/secrets.js";
import { CredentialEnvelopeCipher } from "./crypto.js";
import { FixedPrivateOwnerUserKeyResolver, UserKeyDeriver, type UserKeyResolver } from "./identity.js";
import { DirectMailboxConnectionTester, type MailboxConnectionTester } from "./connectionTest.js";
import { PrivateAppServiceFactory } from "./serviceFactory.js";
import { OneTimeSettingsSessions } from "./settingsSessions.js";
import { MailboxStore } from "./store.js";

export interface PrivateAppRuntime {
  store: MailboxStore;
  sessions: OneTimeSettingsSessions;
  tester: MailboxConnectionTester;
  services: PrivateAppServiceFactory;
  userKeys: UserKeyResolver;
  close(): void;
}

export async function createPrivateAppRuntime(
  config: MailBridgeConfig,
  secrets: FileSecretProvider,
): Promise<PrivateAppRuntime> {
  if (!config.app.enabled) throw new Error("Private ChatGPT App mode is disabled in configuration");
  const [masterEncoded, userHmacEncoded, messageIdEncoded, fixedOwnerUserKey] = await Promise.all([
    secrets.read(config.app.credential_master_key_secret),
    secrets.read(config.app.user_key_hmac_secret),
    secrets.read(config.app.message_id_hmac_secret),
    config.app.user_key_mode === "fixed_private_owner"
      ? secrets.read(config.app.fixed_owner_user_key_secret)
      : Promise.resolve(null),
  ]);
  const master = decodeKey(masterEncoded, "Credential master key", true);
  const userHmac = decodeKey(userHmacEncoded, "User-key HMAC secret", false);
  const messageIdHmac = decodeKey(messageIdEncoded, "Message-ID HMAC secret", false);
  const userKeys: UserKeyResolver = config.app.user_key_mode === "fixed_private_owner"
    ? new FixedPrivateOwnerUserKeyResolver(fixedOwnerUserKey ?? "")
    : new UserKeyDeriver(userHmac);
  const databasePath = resolve(config.app.database_path);
  await mkdir(dirname(databasePath), { recursive: true, mode: 0o700 });
  const cipher = new CredentialEnvelopeCipher(config.app.credential_key_version, new Map([
    [config.app.credential_key_version, master],
  ]));
  const store = new MailboxStore(databasePath, cipher, config.app.max_mailboxes_per_user);
  const sessions = new OneTimeSettingsSessions(config.app.settings_session_ttl_ms);
  const services = new PrivateAppServiceFactory(
    config,
    store,
    messageIdHmac,
    process.env.MAILBRIDGE_ALLOW_SEND === "true",
    process.env.MAILBRIDGE_SAVE_SENT_COPY === "true",
    parseMailboxIdAllowlist(process.env.MAILBRIDGE_SENT_COPY_MAILBOX_IDS),
  );
  master.fill(0);
  userHmac.fill(0);
  messageIdHmac.fill(0);
  return {
    store,
    sessions,
    tester: new DirectMailboxConnectionTester(config),
    services,
    userKeys,
    close: () => store.close(),
  };
}

function parseMailboxIdAllowlist(value: string | undefined): ReadonlySet<string> {
  const ids = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (ids.some((id) => !/^mbx_[a-z0-9_]{1,120}$/i.test(id))) {
    throw new Error("Sent-copy mailbox allowlist is invalid");
  }
  return new Set(ids);
}

function decodeKey(encoded: string, label: string, exact32: boolean): Buffer {
  const normalized = encoded.startsWith("base64url:") ? encoded.slice("base64url:".length) : encoded;
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) throw new Error(`${label} must use base64url encoding`);
  const key = Buffer.from(normalized, "base64url");
  if ((exact32 && key.byteLength !== 32) || (!exact32 && key.byteLength < 32)) {
    key.fill(0);
    throw new Error(`${label} has an invalid length`);
  }
  return key;
}
