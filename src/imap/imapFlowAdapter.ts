import { ImapFlow } from "imapflow";
import type {
  FetchMessageObject,
  MessageAddressObject,
  MessageStructureObject,
  SearchObject,
} from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import type { MailboxConfig } from "../config/schema.js";
import type { AddressValue, FolderSummary, HealthResult } from "../domain/types.js";
import { MailBridgeError } from "../domain/errors.js";
import { textSnippet } from "../security/content.js";
import { logger } from "../util/logger.js";
import { MAILBRIDGE_VERSION } from "../version.js";
import { resolvePublicEndpoint } from "../security/networkPolicy.js";
import type {
  FolderSearchInput,
  RawAttachment,
  RawAttachmentContent,
  RawMessageDetail,
  RawMessageSummary,
  ReadOnlyImapAdapter,
} from "./types.js";

interface AdapterOptions {
  sourceMaxBytes: number;
  snippetMaxChars: number;
  attachmentMaxBytes: number;
  endpointResolver?: typeof resolvePublicEndpoint;
}

export class ImapFlowReadOnlyAdapter implements ReadOnlyImapAdapter {
  constructor(
    readonly mailbox: MailboxConfig,
    readonly username: string,
    readonly password: string,
    readonly options: AdapterOptions,
  ) {}

  async health(): Promise<HealthResult> {
    const started = performance.now();
    const checkedAt = new Date().toISOString();
    let client: ImapFlow | undefined;
    try {
      client = await this.#createClient();
      await client.connect();
      await client.list({ statusQuery: { messages: true, unseen: true } });
      return {
        mailbox_id: this.mailbox.id,
        connected: true,
        tls_verified: client.secureConnection,
        authentication_successful: Boolean(client.authenticated),
        folder_discovery_successful: true,
        latency_ms: Math.round(performance.now() - started),
        error_category: null,
        checked_at: checkedAt,
      };
    } catch (error) {
      const category = classifyImapError(error);
      return {
        mailbox_id: this.mailbox.id,
        connected: false,
        tls_verified: false,
        authentication_successful: false,
        folder_discovery_successful: false,
        latency_ms: Math.round(performance.now() - started),
        error_category: category,
        checked_at: checkedAt,
      };
    } finally {
      await closeClient(client);
    }
  }

  async listFolders(): Promise<FolderSummary[]> {
    return (await this.discoverFolders()).filter((folder) => this.mailbox.allowed_folders.includes(folder.folder_id));
  }

  async discoverFolders(): Promise<FolderSummary[]> {
    const client = await this.#createClient();
    try {
      await client.connect();
      const folders = await client.list({ statusQuery: { messages: true, unseen: true } });
      return folders.map((folder) => ({
          folder_id: folder.path,
          display_name: folder.name,
          special_use: folder.specialUse ?? null,
          selectable: !folder.flags.has("\\Noselect"),
          message_count: folder.status?.messages ?? null,
          unread_count: folder.status?.unseen ?? null,
        }));
    } catch (error) {
      throw toMailBridgeError(error);
    } finally {
      await closeClient(client);
    }
  }

  async search(input: FolderSearchInput): Promise<RawMessageSummary[]> {
    const client = await this.#createClient();
    try {
      await client.connect();
      const lock = await client.getMailboxLock(input.folder, {
        readOnly: true,
        acquireTimeout: 10_000,
        maxLockHoldTime: 30_000,
      });
      try {
        assertReadOnlyMailbox(client);
        const query = buildSearchQuery(input);
        const found = await client.search(query, { uid: true });
        const uids = Array.isArray(found) ? found : [];
        const candidateLimit = Math.min(Math.max(input.limit * 5, 50), 500);
        const candidates = uids.slice(-candidateLimit).reverse();
        if (candidates.length === 0) return [];

        const messages = await client.fetchAll(
          candidates,
          {
            uid: true,
            flags: true,
            envelope: true,
            internalDate: true,
            bodyStructure: true,
            size: true,
            source: { maxLength: 16 * 1024 },
          },
          { uid: true },
        );
        const uidValidity = currentUidValidity(client);
        const summaries = await Promise.all(
          messages.map((message) => this.#toSummary(message, input.folder, uidValidity)),
        );
        return summaries
          .filter((message) => input.has_attachment === undefined || message.attachments.length > 0 === input.has_attachment)
          .sort((a, b) => b.received_at.localeCompare(a.received_at))
          .slice(0, input.limit);
      } finally {
        lock.release();
      }
    } catch (error) {
      throw toMailBridgeError(error);
    } finally {
      await closeClient(client);
    }
  }

  async fetch(folder: string, uidValidity: bigint, uid: number, maxBytes: number): Promise<RawMessageDetail> {
    const client = await this.#createClient();
    try {
      await client.connect();
      const lock = await client.getMailboxLock(folder, {
        readOnly: true,
        acquireTimeout: 10_000,
        maxLockHoldTime: 30_000,
      });
      try {
        assertReadOnlyMailbox(client);
        if (currentUidValidity(client) !== uidValidity) {
          throw new MailBridgeError("Message identifier is stale after UIDVALIDITY changed", "UIDVALIDITY_CHANGED");
        }
        const boundedBytes = Math.min(maxBytes, this.options.sourceMaxBytes);
        const message = await client.fetchOne(
          uid,
          {
            uid: true,
            flags: true,
            envelope: true,
            internalDate: true,
            bodyStructure: true,
            size: true,
            headers: ["message-id", "in-reply-to", "references", "date", "from", "to", "cc", "subject"],
            source: { maxLength: boundedBytes },
          },
          { uid: true },
        );
        if (!message) throw new MailBridgeError("Message no longer exists", "MESSAGE_NOT_FOUND");
        const parsed = await parseSource(message.source);
        const summary = await this.#toSummary(message, folder, uidValidity, parsed);
        return {
          ...summary,
          headers: serializeHeaders(parsed),
          text_body: parsed?.text ?? "",
          html_body: typeof parsed?.html === "string" ? parsed.html : null,
          references: normalizeReferences(parsed?.references),
          source_truncated: Boolean(message.size && message.source && message.source.byteLength < message.size),
        };
      } finally {
        lock.release();
      }
    } catch (error) {
      if (error instanceof MailBridgeError) throw error;
      throw toMailBridgeError(error);
    } finally {
      await closeClient(client);
    }
  }

  async listAttachmentParts(folder: string, uidValidity: bigint, uid: number): Promise<RawAttachment[]> {
    const client = await this.#createClient();
    try {
      await client.connect();
      const lock = await client.getMailboxLock(folder, {
        readOnly: true,
        acquireTimeout: 10_000,
        maxLockHoldTime: 30_000,
      });
      try {
        assertReadOnlyMailbox(client);
        if (currentUidValidity(client) !== uidValidity) {
          throw new MailBridgeError("Message identifier is stale after UIDVALIDITY changed", "UIDVALIDITY_CHANGED");
        }
        const message = await client.fetchOne(uid, { uid: true, bodyStructure: true }, { uid: true });
        if (!message) throw new MailBridgeError("Message no longer exists", "MESSAGE_NOT_FOUND");
        return collectAttachments(message.bodyStructure);
      } finally {
        lock.release();
      }
    } catch (error) {
      if (error instanceof MailBridgeError) throw error;
      throw toMailBridgeError(error);
    } finally {
      await closeClient(client);
    }
  }

  async fetchAttachment(
    folder: string,
    uidValidity: bigint,
    uid: number,
    part: string,
    maxBytes: number,
  ): Promise<RawAttachmentContent> {
    const client = await this.#createClient();
    try {
      await client.connect();
      const lock = await client.getMailboxLock(folder, {
        readOnly: true,
        acquireTimeout: 10_000,
        maxLockHoldTime: 30_000,
      });
      try {
        assertReadOnlyMailbox(client);
        if (currentUidValidity(client) !== uidValidity) {
          throw new MailBridgeError("Message identifier is stale after UIDVALIDITY changed", "UIDVALIDITY_CHANGED");
        }
        const structure = await client.fetchOne(uid, { uid: true, bodyStructure: true }, { uid: true });
        if (!structure) throw new MailBridgeError("Message no longer exists", "MESSAGE_NOT_FOUND");
        const meta = collectAttachments(structure.bodyStructure).find((attachment) => attachment.part === part);
        if (!meta) throw new MailBridgeError("Attachment part does not exist on this message", "ATTACHMENT_NOT_FOUND");

        const cap = Math.max(1, Math.min(maxBytes, this.options.attachmentMaxBytes));
        // BODY.PEEK semantics: the folder is opened read-only (EXAMINE), so downloading a
        // body part cannot set \Seen or mutate any flag on the server.
        const download = await client.download(String(uid), part, { uid: true });
        const chunks: Buffer[] = [];
        let total = 0;
        let truncated = false;
        try {
          for await (const chunk of download.content) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            if (total + buffer.byteLength > cap) {
              const remaining = cap - total;
              if (remaining > 0) chunks.push(buffer.subarray(0, remaining));
              total = cap;
              truncated = true;
              download.content.destroy();
              break;
            }
            chunks.push(buffer);
            total += buffer.byteLength;
          }
        } catch (streamError) {
          if (!truncated) throw streamError;
        }
        return {
          part,
          filename: meta.filename,
          mime_type: meta.mime_type,
          declared_size: meta.size,
          bytes: Buffer.concat(chunks),
          truncated,
        };
      } finally {
        lock.release();
      }
    } catch (error) {
      if (error instanceof MailBridgeError) throw error;
      throw toMailBridgeError(error);
    } finally {
      await closeClient(client);
    }
  }

  async verifyPeekInvariant(folder: string, maxBytes: number): Promise<{
    success: boolean;
    flags_before: string[] | null;
    flags_after: string[] | null;
    unchanged: boolean;
    reason: string;
  }> {
    const client = await this.#createClient();
    try {
      await client.connect();
      const lock = await client.getMailboxLock(folder, {
        readOnly: true,
        acquireTimeout: 10_000,
        maxLockHoldTime: 30_000,
      });
      try {
        assertReadOnlyMailbox(client);
        const found = await client.search({ all: true }, { uid: true });
        const uid = Array.isArray(found) ? found.at(-1) : undefined;
        if (!uid) {
          return {
            success: true,
            flags_before: null,
            flags_after: null,
            unchanged: true,
            reason: "MAILBOX_EMPTY_READ_ONLY_EXAMINE_CONFIRMED",
          };
        }
        const before = await client.fetchOne(uid, { uid: true, flags: true }, { uid: true });
        await client.fetchOne(
          uid,
          { uid: true, source: { maxLength: Math.min(maxBytes, this.options.sourceMaxBytes) } },
          { uid: true },
        );
        const after = await client.fetchOne(uid, { uid: true, flags: true }, { uid: true });
        const flagsBefore = sortedFlags(before ? before.flags : undefined);
        const flagsAfter = sortedFlags(after ? after.flags : undefined);
        const unchanged = JSON.stringify(flagsBefore) === JSON.stringify(flagsAfter);
        return {
          success: unchanged,
          flags_before: flagsBefore,
          flags_after: flagsAfter,
          unchanged,
          reason: unchanged ? "BODY_PEEK_FLAGS_UNCHANGED" : "FLAGS_CHANGED_UNEXPECTEDLY",
        };
      } finally {
        lock.release();
      }
    } catch (error) {
      if (error instanceof MailBridgeError) throw error;
      throw toMailBridgeError(error);
    } finally {
      await closeClient(client);
    }
  }

  async #createClient(): Promise<ImapFlow> {
    const endpoint = await (this.options.endpointResolver ?? resolvePublicEndpoint)(this.mailbox.imap_host);
    const client = new ImapFlow({
      host: endpoint.address,
      servername: endpoint.hostname,
      port: this.mailbox.imap_port,
      secure: this.mailbox.tls,
      ...(this.mailbox.tls ? {} : { doSTARTTLS: true }),
      auth: { user: this.username, pass: this.password },
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
      maxLineLength: 256 * 1024,
      maxLiteralSize: this.options.sourceMaxBytes,
      clientInfo: { name: "mailbridge-mcp", version: MAILBRIDGE_VERSION, vendor: "MailBridge" },
    });
    // ImapFlow may emit an asynchronous `error` event after an operation has
    // already returned (for example when a connection disappears while the
    // client negotiates COMPRESS). Without a listener, EventEmitter treats it
    // as an uncaught exception and terminates the entire stdio MCP process.
    // Keep the log deliberately redacted; the operation itself still rejects
    // through its normal promise path and is mapped to MailBridgeError.
    client.on("error", (error: unknown) => {
      logger.warn(
        { mailbox_id: this.mailbox.id, error_category: classifyImapError(error) },
        "imap_client_error",
      );
    });
    return client;
  }

  async #toSummary(
    message: FetchMessageObject,
    folder: string,
    uidValidity: bigint,
    parsed?: ParsedMail | null,
  ): Promise<RawMessageSummary> {
    const mail = parsed === undefined ? await parseSource(message.source) : parsed;
    const attachments = collectAttachments(message.bodyStructure);
    return {
      uid: message.uid,
      uid_validity: uidValidity,
      folder,
      from: addresses(message.envelope?.from),
      to: addresses(message.envelope?.to),
      cc: addresses(message.envelope?.cc),
      subject: message.envelope?.subject ?? "",
      received_at: normalizeDate(message.internalDate ?? message.envelope?.date),
      unread: !message.flags?.has("\\Seen"),
      attachments,
      snippet: textSnippet(mail?.text, this.options.snippetMaxChars),
      message_id: message.envelope?.messageId ?? mail?.messageId ?? null,
      in_reply_to: message.envelope?.inReplyTo ?? normalizeInReplyTo(mail?.inReplyTo),
    };
  }
}

function buildSearchQuery(input: FolderSearchInput): SearchObject {
  const query: SearchObject = {};
  if (input.free_text) query.text = input.free_text;
  if (input.from) query.from = input.from;
  if (input.to) query.to = input.to;
  if (input.cc) query.cc = input.cc;
  if (input.subject) query.subject = input.subject;
  if (input.after) query.since = input.after;
  if (input.before) query.before = input.before;
  if (input.unread_only) query.seen = false;
  if (input.thread_identifiers?.length) {
    const alternatives: SearchObject[] = [];
    for (const identifier of input.thread_identifiers.slice(0, 20)) {
      alternatives.push(
        { header: { "Message-ID": identifier } },
        { header: { "In-Reply-To": identifier } },
        { header: { References: identifier } },
      );
    }
    if (alternatives.length >= 2) query.or = alternatives;
    else if (alternatives[0]) Object.assign(query, alternatives[0]);
  }
  if (Object.keys(query).length === 0) query.all = true;
  return query;
}

function assertReadOnlyMailbox(client: ImapFlow): void {
  if (!client.mailbox || client.mailbox.readOnly !== true) {
    throw new MailBridgeError("IMAP folder was not opened read-only", "READ_ONLY_INVARIANT_FAILED");
  }
}

function currentUidValidity(client: ImapFlow): bigint {
  if (!client.mailbox) throw new MailBridgeError("No mailbox is open", "IMAP_STATE_ERROR");
  return client.mailbox.uidValidity;
}

function sortedFlags(flags: Set<string> | undefined): string[] {
  return [...(flags ?? [])].sort();
}

function collectAttachments(structure: MessageStructureObject | undefined): RawAttachment[] {
  const values: RawAttachment[] = [];
  const visit = (node: MessageStructureObject | undefined): void => {
    if (!node) return;
    const filename = node.dispositionParameters?.filename ?? node.parameters?.name ?? null;
    const disposition = node.disposition?.toLowerCase() ?? null;
    if (node.part && (filename || disposition === "attachment" || disposition === "inline")) {
      values.push({
        part: node.part,
        filename,
        mime_type: node.type.toLowerCase(),
        size: node.size ?? null,
        disposition,
        inline: disposition === "inline",
      });
    }
    node.childNodes?.forEach(visit);
  };
  visit(structure);
  return values;
}

function addresses(values: MessageAddressObject[] | undefined): AddressValue[] {
  return (values ?? []).map((value) => ({
    ...(value.name ? { name: value.name } : {}),
    ...(value.address ? { address: value.address } : {}),
  }));
}

async function parseSource(source: Buffer | undefined): Promise<ParsedMail | null> {
  if (!source?.length) return null;
  try {
    return await simpleParser(source, {
      skipHtmlToText: true,
      skipTextToHtml: true,
      skipImageLinks: true,
      maxHtmlLengthToParse: 2 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function serializeHeaders(parsed: ParsedMail | null): Record<string, string | string[]> {
  if (!parsed) return {};
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of parsed.headers) {
    if (typeof value === "string") result[key] = value;
    else if (Array.isArray(value)) result[key] = value.map(String);
    else result[key] = JSON.stringify(value);
  }
  return result;
}

function normalizeReferences(value: string[] | string | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeInReplyTo(value: string | undefined): string | null {
  return value || null;
}

function normalizeDate(value: Date | string | undefined): string {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date(0);
  return Number.isNaN(date.valueOf()) ? new Date(0).toISOString() : date.toISOString();
}

function classifyImapError(error: unknown): string {
  if (error && typeof error === "object" && "authenticationFailed" in error) return "AUTHENTICATION_FAILED";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (/certificate|tls|hostname|self.signed/.test(message)) return "TLS_VALIDATION_FAILED";
  if (/timeout/i.test(code) || /timed out|timeout/.test(message)) return "TIMEOUT";
  if (/enotfound|eai_again/i.test(code)) return "DNS_FAILED";
  if (/noconnection|econnrefused|econnreset/i.test(code)) return "CONNECTION_FAILED";
  return "IMAP_ERROR";
}

function toMailBridgeError(error: unknown): MailBridgeError {
  const category = classifyImapError(error);
  return new MailBridgeError("IMAP operation failed", category, category === "TIMEOUT" || category === "CONNECTION_FAILED");
}

async function closeClient(client: ImapFlow | undefined): Promise<void> {
  if (!client) return;
  try {
    if (client.usable) await client.logout();
    else client.close();
  } catch {
    client.close();
  }
}
