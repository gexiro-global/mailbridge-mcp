import { describe, expect, it } from "vitest";
import type { ImapFlowOptions } from "imapflow";
import type { MailboxConfig } from "../src/config/schema.js";
import {
  ImapSentCopyWriter,
  type SentCopyClient,
  type SentCopyClientFactory,
  type SentCopyFolder,
} from "../src/send/sentCopy.js";

describe("IMAP Sent-copy writer", () => {
  it("uses an existing provider copy and never appends a duplicate", async () => {
    const client = new FakeClient({ searches: [[7]] });
    const writer = createWriter(() => client);
    const result = await writer.save(mailbox, Buffer.from("raw"), "<msg@example.invalid>", timestamp);

    expect(result).toEqual({ state: "provider_saved", folder: "Sent", attempts: 1, error_code: null });
    expect(client.appends).toHaveLength(0);
    expect(client.openedReadOnly).toBe(true);
  });

  it("appends the exact raw message once with Seen after provider observation", async () => {
    const client = new FakeClient({ searches: [false] });
    const writer = createWriter(() => client);
    const raw = Buffer.from("Message-ID: <msg@example.invalid>\r\n\r\nbody", "utf8");
    const result = await writer.save(mailbox, raw, "<msg@example.invalid>", timestamp);

    expect(result).toEqual({ state: "imap_appended", folder: "Sent", attempts: 1, error_code: null });
    expect(client.appends).toEqual([{ folder: "Sent", raw, flags: ["\\Seen"], date: new Date(timestamp) }]);
  });

  it("recovers an uncertain append by searching Message-ID before retrying", async () => {
    const first = new FakeClient({ searches: [false], appendError: new Error("socket reset") });
    const second = new FakeClient({ searches: [[9]] });
    const clients = [first, second];
    const writer = createWriter(() => clients.shift()! , { maxAttempts: 2 });
    const result = await writer.save(mailbox, Buffer.from("raw"), "<msg@example.invalid>", timestamp);

    expect(result).toEqual({ state: "provider_saved", folder: "Sent", attempts: 2, error_code: null });
    expect(first.appends).toHaveLength(1);
    expect(second.appends).toHaveLength(0);
  });

  it("fails closed when no selectable special-use Sent folder exists", async () => {
    const client = new FakeClient({ folders: [{ path: "Archive", specialUse: "\\Archive", flags: new Set() }] });
    const writer = createWriter(() => client);
    const result = await writer.save(mailbox, Buffer.from("raw"), "<msg@example.invalid>", timestamp);

    expect(result).toEqual({ state: "failed", folder: null, attempts: 1, error_code: "SENT_FOLDER_NOT_FOUND" });
    expect(client.appends).toHaveLength(0);
  });

  it("requires verified TLS with hostname validation", async () => {
    let options: ImapFlowOptions | undefined;
    const writer = createWriter((value) => {
      options = value;
      return new FakeClient({ searches: [[1]] });
    });
    await writer.save(mailbox, Buffer.from("raw"), "<msg@example.invalid>", timestamp);

    expect(options).toMatchObject({
      host: "93.184.216.34",
      port: 993,
      secure: true,
      tls: { rejectUnauthorized: true, servername: "imap.example.invalid", minVersion: "TLSv1.2" },
      logger: false,
      logRaw: false,
    });
  });

  it("fails before reading credentials when endpoint policy rejects the IMAP host", async () => {
    let secretReads = 0;
    let clientCreations = 0;
    const writer = new ImapSentCopyWriter(
      { read: async () => { secretReads += 1; return "must-not-be-read"; } },
      { observationDelaysMs: [0], retryDelayMs: 0, sleep: async () => undefined, maxAttempts: 1 },
      () => { clientCreations += 1; return new FakeClient({}); },
      async () => { throw new Error("prohibited network"); },
    );

    const result = await writer.save(mailbox, Buffer.from("raw"), "<msg@example.invalid>", timestamp);
    expect(result).toMatchObject({ state: "failed", error_code: "SENT_COPY_IMAP_FAILED" });
    expect(secretReads).toBe(0);
    expect(clientCreations).toBe(0);
  });
});

function createWriter(factory: SentCopyClientFactory, overrides: { maxAttempts?: number } = {}): ImapSentCopyWriter {
  return new ImapSentCopyWriter(
    { read: async (reference) => reference.includes("username") ? "synthetic-user" : "synthetic-password" },
    {
      observationDelaysMs: [0],
      retryDelayMs: 0,
      sleep: async () => undefined,
      maxAttempts: overrides.maxAttempts ?? 1,
    },
    factory,
    syntheticEndpoint,
  );
}

async function syntheticEndpoint(hostname: string) {
  return { hostname, address: "93.184.216.34", family: 4 as const, address_count: 1 };
}

class FakeClient implements SentCopyClient {
  usable = true;
  openedReadOnly = false;
  readonly appends: Array<{ folder: string; raw: Buffer; flags: string[]; date: Date }> = [];
  readonly folders: SentCopyFolder[];
  readonly searches: Array<number[] | false>;

  constructor(readonly options: {
    folders?: SentCopyFolder[];
    searches?: Array<number[] | false>;
    appendError?: Error;
  }) {
    this.folders = options.folders ?? [{ path: "Sent", specialUse: "\\Sent", flags: new Set() }];
    this.searches = [...(options.searches ?? [false])];
  }

  async connect(): Promise<void> {}
  async list(): Promise<SentCopyFolder[]> { return this.folders; }
  async mailboxOpen(_path: string, options: { readOnly: true }): Promise<{ readOnly: boolean }> {
    this.openedReadOnly = options.readOnly;
    return { readOnly: options.readOnly };
  }
  async mailboxClose(): Promise<void> {}
  async search(): Promise<number[] | false> { return this.searches.shift() ?? false; }
  async append(folder: string, raw: Buffer, flags: string[], date: Date): Promise<object> {
    this.appends.push({ folder, raw: Buffer.from(raw), flags: [...flags], date });
    if (this.options.appendError) throw this.options.appendError;
    return { uid: 1 };
  }
  async logout(): Promise<void> { this.usable = false; }
  close(): void { this.usable = false; }
}

const timestamp = "2026-08-29T09:00:00.000Z";
const mailbox: MailboxConfig = {
  id: "mbx_synthetic",
  display_name: "Synthetic",
  email: "sender@example.invalid",
  brand: "OTHER",
  purpose: "Synthetic Sent-copy test",
  imap_host: "imap.example.invalid",
  imap_port: 993,
  tls: true,
  username_secret: "synthetic_username",
  password_secret: "synthetic_password",
  send_enabled: true,
  send_transport: "smtp",
  smtp_host: "smtp.example.invalid",
  smtp_port: 465,
  smtp_tls_mode: "implicit",
  enabled: true,
  folder_access: "all_selectable",
  allowed_folders: ["INBOX"],
  result_limit: 50,
  tags: [],
  brand_hints: { organisation_names: [], domains: [], private: false },
};
