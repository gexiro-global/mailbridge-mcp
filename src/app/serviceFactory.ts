import { createHmac } from "node:crypto";
import type { MailBridgeConfig, MailboxConfig } from "../config/schema.js";
import { DefaultImapAdapterFactory, type SecretReader } from "../imap/factory.js";
import { StableIdCodec } from "../security/stableId.js";
import { MailService, type InitialConnectionStates } from "../services/mailService.js";
import { MailSendService } from "../services/mailSendService.js";
import { SmtpMailTransport } from "../send/smtpAdapter.js";
import { ImapSentCopyWriter } from "../send/sentCopy.js";
import type { MailboxStore } from "./store.js";

export interface ScopedMailService {
  service: MailService;
  writer?: MailSendService;
  dispose(): void;
}

export class PrivateAppServiceFactory {
  readonly #messageIdMaster: Buffer;

  constructor(
    readonly baseConfig: MailBridgeConfig,
    readonly store: MailboxStore,
    messageIdMaster: Buffer | string,
    readonly allowSend = false,
    readonly saveSentCopy = false,
    readonly sentCopyMailboxIds: ReadonlySet<string> = new Set(),
  ) {
    this.#messageIdMaster = Buffer.isBuffer(messageIdMaster) ? Buffer.from(messageIdMaster) : Buffer.from(messageIdMaster, "utf8");
    if (this.#messageIdMaster.byteLength < 32) throw new Error("Message-ID HMAC master must contain at least 32 bytes");
  }

  create(userKey: string): ScopedMailService {
    const runtime = this.store.runtimeMailboxes(userKey);
    const secrets = new Map<string, string>();
    const mailboxes: MailboxConfig[] = runtime.map(({ view, credentials }, index) => {
      const usernameRef = `runtime_${index}_username`;
      const passwordRef = `runtime_${index}_password`;
      secrets.set(usernameRef, credentials.username);
      secrets.set(passwordRef, credentials.password);
      credentials.username = "";
      credentials.password = "";
      return {
        id: view.mailbox_id,
        display_name: view.display_name,
        email: view.email,
        brand: view.brand,
        purpose: view.purpose,
        imap_host: view.imap_host,
        imap_port: view.imap_port,
        tls: view.tls_mode === "implicit",
        username_secret: usernameRef,
        password_secret: passwordRef,
        send_enabled: view.send_enabled,
        send_transport: view.send_transport,
        smtp_host: view.smtp_host,
        smtp_port: view.smtp_port,
        smtp_tls_mode: view.smtp_tls_mode,
        enabled: view.enabled,
        folder_access: "all_selectable",
        allowed_folders: view.allowed_folders,
        result_limit: 50,
        tags: [],
        brand_hints: { organisation_names: [], domains: [], private: view.brand === "PRIVATE" },
      };
    });
    const config = structuredClone(this.baseConfig);
    config.mailboxes = mailboxes;
    const reader: SecretReader = {
      read: async (reference) => {
        const value = secrets.get(reference);
        if (value === undefined) throw new Error("Runtime credential is unavailable");
        return value;
      },
    };
    const states: InitialConnectionStates = new Map(runtime.map(({ view }) => [view.mailbox_id, {
      status: view.connection_status,
      last_successful_check: view.last_successful_check,
    }]));
    const userIdKey = createHmac("sha256", this.#messageIdMaster).update(userKey, "utf8").digest();
    const service = new MailService(config, new DefaultImapAdapterFactory(config, reader), new StableIdCodec(userIdKey), states);
    const sentCopy = this.allowSend && this.saveSentCopy ? new ImapSentCopyWriter(reader) : undefined;
    const writer = this.allowSend
      ? new MailSendService(userKey, this.store, service, new SmtpMailTransport(reader, sentCopy, undefined, this.sentCopyMailboxIds))
      : undefined;
    return {
      service,
      ...(writer ? { writer } : {}),
      dispose: () => {
        for (const key of secrets.keys()) secrets.set(key, "");
        secrets.clear();
        userIdKey.fill(0);
      },
    };
  }
}
