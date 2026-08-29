import { ImapFlow, type ImapFlowOptions } from "imapflow";
import type { MailboxConfig } from "../config/schema.js";
import type { SecretReader } from "../imap/factory.js";
import type { SentCopyResult } from "../app/types.js";
import { resolvePublicEndpoint, type ResolvedPublicEndpoint } from "../security/networkPolicy.js";
import { MAILBRIDGE_VERSION } from "../version.js";

const DEFAULT_MAX_RAW_BYTES = 32 * 1024 * 1024;

export interface SentCopyWriter {
  save(mailbox: MailboxConfig, raw: Buffer, messageId: string, sentAt: string): Promise<SentCopyResult>;
}

export interface SentCopyFolder {
  path: string;
  specialUse?: string;
  flags: Set<string>;
}

export interface SentCopyClient {
  usable: boolean;
  connect(): Promise<void>;
  list(): Promise<SentCopyFolder[]>;
  mailboxOpen(path: string, options: { readOnly: true }): Promise<{ readOnly: boolean }>;
  mailboxClose(): Promise<unknown>;
  search(query: { header: { "Message-ID": string } }, options: { uid: true }): Promise<number[] | false>;
  append(path: string, content: Buffer, flags: string[], internalDate: Date): Promise<unknown | false>;
  logout(): Promise<void>;
  close(): void;
}

export type SentCopyClientFactory = (options: ImapFlowOptions) => SentCopyClient;

export interface SentCopyOptions {
  observationDelaysMs: number[];
  maxAttempts: number;
  retryDelayMs: number;
  maxRawBytes: number;
  sleep: (milliseconds: number) => Promise<void>;
}

const defaults: SentCopyOptions = {
  observationDelaysMs: [0, 250, 750, 1500, 2500],
  maxAttempts: 3,
  retryDelayMs: 500,
  maxRawBytes: DEFAULT_MAX_RAW_BYTES,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

export class ImapSentCopyWriter implements SentCopyWriter {
  readonly options: SentCopyOptions;

  constructor(
    readonly secrets: SecretReader,
    options: Partial<SentCopyOptions> = {},
    readonly clientFactory: SentCopyClientFactory = defaultClientFactory,
    readonly endpointResolver: typeof resolvePublicEndpoint = resolvePublicEndpoint,
  ) {
    this.options = { ...defaults, ...options };
    if (this.options.maxAttempts < 1 || this.options.maxAttempts > 5) throw new Error("Sent-copy attempt count is invalid");
    if (this.options.maxRawBytes < 1024 || this.options.maxRawBytes > DEFAULT_MAX_RAW_BYTES) {
      throw new Error("Sent-copy raw-message limit is invalid");
    }
  }

  async save(mailbox: MailboxConfig, raw: Buffer, messageId: string, sentAt: string): Promise<SentCopyResult> {
    if (raw.byteLength > this.options.maxRawBytes) {
      return failed(0, null, "SENT_COPY_MESSAGE_TOO_LARGE");
    }
    let lastError = "SENT_COPY_FAILED";
    let lastFolder: string | null = null;
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      let client: SentCopyClient | undefined;
      try {
        const endpoint = await this.endpointResolver(mailbox.imap_host);
        const [username, password] = await Promise.all([
          this.secrets.read(mailbox.username_secret),
          this.secrets.read(mailbox.password_secret),
        ]);
        client = this.clientFactory(clientOptions(mailbox, username, password, endpoint));
        await client.connect();
        const folders = await client.list();
        const sentFolder = folders.find((folder) =>
          folder.specialUse?.toLowerCase() === "\\sent" && !folder.flags.has("\\Noselect"),
        );
        if (!sentFolder) return failed(attempt, null, "SENT_FOLDER_NOT_FOUND");
        lastFolder = sentFolder.path;

        const delays = attempt === 1 ? this.options.observationDelaysMs : [0];
        if (await observeExisting(client, sentFolder.path, messageId, delays, this.options.sleep)) {
          return {
            state: "provider_saved",
            folder: sentFolder.path,
            attempts: attempt,
            error_code: null,
          };
        }
        const appended = await client.append(sentFolder.path, raw, ["\\Seen"], new Date(sentAt));
        if (!appended) {
          lastError = "SENT_COPY_APPEND_REJECTED";
        } else {
          return {
            state: "imap_appended",
            folder: sentFolder.path,
            attempts: attempt,
            error_code: null,
          };
        }
      } catch (error) {
        lastError = classifySentCopyError(error);
      } finally {
        await closeClient(client);
      }
      if (attempt < this.options.maxAttempts) await this.options.sleep(this.options.retryDelayMs);
    }
    return failed(this.options.maxAttempts, lastFolder, lastError);
  }
}

async function observeExisting(
  client: SentCopyClient,
  folder: string,
  messageId: string,
  delays: number[],
  sleep: (milliseconds: number) => Promise<void>,
): Promise<boolean> {
  const opened = await client.mailboxOpen(folder, { readOnly: true });
  if (opened.readOnly !== true) throw new Error("SENT_COPY_EXAMINE_REQUIRED");
  try {
    for (const delay of delays) {
      if (delay > 0) await sleep(delay);
      const found = await client.search({ header: { "Message-ID": messageId } }, { uid: true });
      if (Array.isArray(found) && found.length > 0) return true;
    }
    return false;
  } finally {
    await client.mailboxClose();
  }
}

function clientOptions(
  mailbox: MailboxConfig,
  username: string,
  password: string,
  endpoint: ResolvedPublicEndpoint,
): ImapFlowOptions {
  return {
    host: endpoint.address,
    port: mailbox.imap_port,
    secure: mailbox.tls,
    ...(mailbox.tls ? {} : { doSTARTTLS: true }),
    auth: { user: username, pass: password },
    tls: {
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      servername: endpoint.hostname,
    },
    logger: false,
    logRaw: false,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    maxLiteralSize: DEFAULT_MAX_RAW_BYTES,
    clientInfo: { name: "mailbridge-mcp", version: MAILBRIDGE_VERSION, vendor: "MailBridge" },
  };
}

function defaultClientFactory(options: ImapFlowOptions): SentCopyClient {
  const client = new ImapFlow(options);
  client.on("error", () => {
    // Intentionally redacted: raw IMAP errors can contain server or account data.
  });
  return client as unknown as SentCopyClient;
}

function failed(attempts: number, folder: string | null, errorCode: string): SentCopyResult {
  return { state: "failed", folder, attempts, error_code: errorCode };
}

function classifySentCopyError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const code = error && typeof error === "object" && "code" in error ? String(error.code).toLowerCase() : "";
  if (message.includes("sent_copy_examine_required")) return "SENT_COPY_READ_CHECK_FAILED";
  if (/certificate|hostname|self.signed|tls/.test(message)) return "SENT_COPY_TLS_FAILED";
  if (/auth|login|credential/.test(message)) return "SENT_COPY_AUTH_FAILED";
  if (/timeout|timed out/.test(message) || code.includes("timeout")) return "SENT_COPY_TIMEOUT";
  if (/econn|noconnection|socket/.test(message) || code.includes("econn")) return "SENT_COPY_CONNECTION_FAILED";
  return "SENT_COPY_IMAP_FAILED";
}

async function closeClient(client: SentCopyClient | undefined): Promise<void> {
  if (!client) return;
  try {
    if (client.usable) await client.logout();
    else client.close();
  } catch {
    client.close();
  }
}
