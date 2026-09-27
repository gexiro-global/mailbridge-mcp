import type { MailBridgeConfig, MailboxConfig } from "../config/schema.js";
import { MailboxRegistry } from "../config/registry.js";
import { MailBridgeError, safeError } from "../domain/errors.js";
import { createHash } from "node:crypto";
import {
  UNTRUSTED_EMAIL_WARNING,
  type AttachmentContent,
  type AttachmentMetadata,
  type CrossBrandResult,
  type HealthResult,
  type MessageDetail,
  type MessageSummary,
  type PartialFailure,
  type SearchMessagesInput,
  type SearchMessagesResult,
} from "../domain/types.js";
import type { ImapAdapterFactory } from "../imap/factory.js";
import type { FolderSearchInput, RawAttachment, RawMessageDetail, RawMessageSummary } from "../imap/types.js";
import { checkBrandContext, type BrandContextInput, type BrandContextResult } from "../security/brandGuard.js";
import { findCrossBrandFindings } from "../security/crossBrand.js";
import { boundedText, sanitizeEmailHtml } from "../security/content.js";
import { StableIdCodec, type DecodedMessageLocator } from "../security/stableId.js";
import { Semaphore, withTimeout } from "../util/concurrency.js";
import { dedupeSummaries, parseKnowledgeQuery, selectScopedMailboxes, type KnowledgeSearchOptions } from "./knowledgeScope.js";
import { summarizeAuthentication } from "./messageAuth.js";

interface ConnectionState {
  status: "unknown" | "connected" | "error";
  last_successful_check: string | null;
}

export type InitialConnectionStates = ReadonlyMap<string, ConnectionState>;

export interface FetchMessageOptions {
  include_html: boolean;
  max_body_chars: number;
}

const FOLDER_CACHE_TTL_MS = 300_000;

export class MailService {
  readonly registry: MailboxRegistry;
  readonly #mailboxSemaphores = new Map<string, Semaphore>();
  readonly #fanout = new Semaphore(4);
  readonly #connectionState = new Map<string, ConnectionState>();
  readonly #folderCache = new Map<string, { folders: string[]; default_search_folders: string[]; expires_at: number }>();

  constructor(
    readonly config: MailBridgeConfig,
    readonly adapters: ImapAdapterFactory,
    readonly ids: StableIdCodec,
    initialConnectionStates?: InitialConnectionStates,
  ) {
    this.registry = new MailboxRegistry(config.mailboxes);
    for (const mailbox of config.mailboxes) {
      this.#mailboxSemaphores.set(mailbox.id, new Semaphore(2));
      this.#connectionState.set(
        mailbox.id,
        initialConnectionStates?.get(mailbox.id) ?? { status: "unknown", last_successful_check: null },
      );
    }
  }

  listMailboxes() {
    return this.registry.list().map((mailbox) => {
      const state = this.#connectionState.get(mailbox.id) ?? { status: "unknown", last_successful_check: null };
      return {
        mailbox_id: mailbox.id,
        display_name: mailbox.display_name,
        email: mailbox.email,
        mailbox_email: mailbox.email,
        brand: mailbox.brand,
        purpose: mailbox.purpose,
        enabled: mailbox.enabled,
        connection_status: state.status,
        last_successful_check: state.last_successful_check,
      };
    });
  }

  mailboxContext(mailboxId: string): { mailbox_id: string; mailbox_email: string; brand: string } {
    const mailbox = this.registry.get(mailboxId);
    return { mailbox_id: mailbox.id, mailbox_email: mailbox.email, brand: mailbox.brand };
  }

  messageContext(stableMessageId: string): { mailbox_id: string; mailbox_email: string; brand: string; source_folder: string } {
    const locator = this.ids.decode(stableMessageId);
    return { ...this.mailboxContext(locator.mailbox_id), source_folder: locator.folder_id };
  }

  async mailboxHealth(mailboxId?: string): Promise<HealthResult[]> {
    const mailboxes = mailboxId
      ? [this.registry.get(mailboxId)]
      : this.registry.list().filter((mailbox) => mailbox.enabled);
    return Promise.all(
      mailboxes.map((mailbox) =>
        this.#fanout.use(() =>
          this.#forMailbox(mailbox, async () => {
            const adapter = await this.adapters.create(mailbox);
            const result = await withTimeout(adapter.health(), 25_000, "mailbox health");
            this.#connectionState.set(mailbox.id, {
              status: result.connected ? "connected" : "error",
              last_successful_check: result.connected ? result.checked_at : this.#connectionState.get(mailbox.id)?.last_successful_check ?? null,
            });
            return result;
          }),
        ),
      ),
    );
  }

  async listFolders(mailboxId: string) {
    const mailbox = this.registry.get(mailboxId);
    return this.#forMailbox(mailbox, async () => {
      const adapter = await this.adapters.create(mailbox);
      const folders = mailbox.folder_access === "all_selectable"
        ? await withTimeout(adapter.discoverFolders(), 25_000, "discover folders")
        : await withTimeout(adapter.listFolders(), 25_000, "list folders");
      return folders;
    });
  }

  async searchKnowledge(query: string, options: KnowledgeSearchOptions = {}) {
    const parsed = parseKnowledgeQuery(query);
    const explicitScopes = options.mailbox_ids ?? [];
    const inlineScopes = parsed.scopes;
    const enabled = this.registry.list().filter((mailbox) => mailbox.enabled);
    const resolveScopes = (scopes: string[]) => {
      const groups = scopes.map((scope) => selectScopedMailboxes(enabled, [scope]));
      if (groups.some((group) => group.length === 0)) {
        throw new MailBridgeError("No enabled mailbox matches the requested scope", "MAILBOX_SCOPE_NOT_FOUND");
      }
      const ids = new Set(groups.flat().map((mailbox) => mailbox.id));
      return enabled.filter((mailbox) => ids.has(mailbox.id));
    };
    const explicit = explicitScopes.length ? resolveScopes(explicitScopes) : null;
    const inline = inlineScopes.length ? resolveScopes(inlineScopes) : null;
    const scoped = explicit && inline
      ? explicit.filter((mailbox) => inline.some((candidate) => candidate.id === mailbox.id))
      : explicit ?? inline ?? enabled;
    if ((explicit || inline) && scoped.length === 0) {
      throw new MailBridgeError("Conflicting mailbox scopes", "MAILBOX_SCOPE_NOT_FOUND");
    }
    if (scoped.length === 0) return {
      results: [] as Array<{ id: string; title: string; url: string }>,
      partial_failures: [] as PartialFailure[],
      truncated: false,
    };
    const searched = await this.searchMessages({
      mailbox_ids: scoped.map((mailbox) => mailbox.id),
      free_text: parsed.free_text,
      limit: options.limit ?? 50,
      ...(options.folders?.length ? { folders: unique(options.folders) } : {}),
      ...(options.after ? { after: options.after } : {}),
      ...(options.before ? { before: options.before } : {}),
      ...(options.unread_only === undefined ? {} : { unread_only: options.unread_only }),
      ...(options.has_attachment === undefined ? {} : { has_attachment: options.has_attachment }),
    }, true);
    return {
      results: searched.messages.map((message) => ({
        id: message.stable_message_id,
        title: message.subject || "(no subject)",
        url: this.messageUrl(message.stable_message_id),
      })),
      partial_failures: searched.partial_failures,
      truncated: searched.truncated,
    };
  }

  async fetchKnowledge(id: string) {
    const message = await this.fetchMessage(id, {
      include_html: false,
      max_body_chars: this.config.privacy.body_max_chars,
    });
    const addresses = (values: Array<{ name?: string; address?: string }>) => values
      .map((value) => value.name && value.address ? `${value.name} <${value.address}>` : value.address ?? value.name ?? "")
      .filter(Boolean)
      .join(", ");
    return {
      id,
      title: message.subject || "(no subject)",
      text: [
        `Subject: ${message.subject}`,
        `From: ${addresses(message.from)}`,
        `To: ${addresses(message.to)}`,
        `Cc: ${addresses(message.cc)}`,
        `Received: ${message.received_at}`,
        `Folder: ${message.source_folder}`,
        "",
        message.text_body,
      ].join("\n"),
      url: this.messageUrl(id),
      metadata: {
        mailbox_id: message.mailbox_id,
        mailbox_email: message.mailbox_email,
        brand: message.brand,
        source_folder: message.source_folder,
        received_at: message.received_at,
        has_attachments: message.has_attachments,
        untrusted_content_warning: message.untrusted_content_warning,
      },
    };
  }

  async listRecentMessages(input: {
    mailbox_ids: string[];
    folder?: string;
    limit: number;
    unread_only?: boolean;
    after?: string;
    before?: string;
  }): Promise<SearchMessagesResult> {
    return this.#searchFanout({
      mailbox_ids: input.mailbox_ids,
      ...(input.folder ? { folders: [input.folder] } : {}),
      limit: input.limit,
      ...(input.unread_only === undefined ? {} : { unread_only: input.unread_only }),
      ...(input.after ? { after: input.after } : {}),
      ...(input.before ? { before: input.before } : {}),
    });
  }

  async listMessagesPage(input: {
    mailbox_id: string;
    folder: string;
    limit: number;
    before_uid?: number;
    uid_validity?: string;
  }) {
    if ((input.before_uid === undefined) !== (input.uid_validity === undefined)) {
      throw new MailBridgeError("Both before_uid and uid_validity are required for continuation", "INVALID_ARGUMENT");
    }
    const expected = input.uid_validity === undefined ? undefined : BigInt(input.uid_validity);
    const mailbox = this.registry.get(input.mailbox_id);
    await this.#resolveSearchFolders(mailbox, [input.folder]);
    const limit = Math.min(Math.max(input.limit, 1), 100);
    return this.#forMailbox(mailbox, async () => {
      const adapter = await this.adapters.create(mailbox);
      const raw = await withTimeout(adapter.search({
        folder: input.folder,
        limit: limit + 1,
        page_by_uid: true,
        ...(input.before_uid === undefined ? {} : { before_uid: input.before_uid }),
        ...(expected === undefined ? {} : { expected_uid_validity: expected }),
      }), 25_000, "message page");
      const ordered = raw.sort((a, b) => b.uid - a.uid);
      if ((expected !== undefined && ordered.some((message) => message.uid_validity !== expected)) ||
          ordered.some((message) => message.uid_validity !== ordered[0]?.uid_validity)) {
        throw new MailBridgeError("Mailbox UIDVALIDITY changed while paging", "UIDVALIDITY_CHANGED");
      }
      const page = ordered.slice(0, limit);
      return {
        mailbox_id: mailbox.id,
        folder: input.folder,
        messages: page.map((message) => this.#summary(mailbox, message)),
        uid_validity: (page[0]?.uid_validity ?? expected)?.toString() ?? null,
        next_before_uid: ordered.length > limit ? page.at(-1)!.uid : null,
      };
    });
  }

  async searchMessages(input: SearchMessagesInput, dedupeAcrossFolders = false): Promise<SearchMessagesResult> {
    const hasNarrowingFilter = Boolean(
      input.free_text ||
        input.from ||
        input.to ||
        input.cc ||
        input.subject ||
        input.after ||
        input.before ||
        input.unread_only ||
        input.has_attachment !== undefined,
    );
    if (!hasNarrowingFilter) {
      throw new MailBridgeError("search_messages requires at least one narrowing filter", "UNBOUNDED_SEARCH_REJECTED");
    }
    return this.#searchFanout(input, dedupeAcrossFolders);
  }

  async fetchMessage(stableMessageId: string, options: FetchMessageOptions): Promise<MessageDetail> {
    const locator = this.ids.decode(stableMessageId);
    const mailbox = this.registry.get(locator.mailbox_id);
    this.registry.assertFolderAllowed(mailbox, locator.folder_id);
    const maxChars = Math.min(options.max_body_chars, this.config.privacy.body_max_chars);
    return this.#forMailbox(mailbox, async () => {
      const adapter = await this.adapters.create(mailbox);
      const raw = await withTimeout(
        adapter.fetch(locator.folder_id, locator.uid_validity, locator.uid, this.config.privacy.source_max_bytes),
        30_000,
        "fetch message",
      );
      return this.#detail(mailbox, raw, options.include_html, maxChars);
    });
  }

  async fetchMessages(stableMessageIds: string[], options: FetchMessageOptions) {
    const messages: MessageDetail[] = [];
    const partial_failures: PartialFailure[] = [];
    for (const stableMessageId of unique(stableMessageIds)) {
      try {
        messages.push(await this.fetchMessage(stableMessageId, options));
      } catch (error) {
        const safe = safeError(error);
        let mailboxId = "unknown";
        try {
          mailboxId = this.ids.decode(stableMessageId).mailbox_id;
        } catch {
          mailboxId = "unknown";
        }
        partial_failures.push({ mailbox_id: mailboxId, code: safe.code, retryable: safe.retryable });
      }
    }
    return { messages, partial_failures };
  }

  async fetchRawMessage(stableMessageId: string, options: { max_bytes: number; offset?: number }) {
    const locator = this.ids.decode(stableMessageId);
    const mailbox = this.registry.get(locator.mailbox_id);
    this.registry.assertFolderAllowed(mailbox, locator.folder_id);
    const window = Math.min(Math.max(options.max_bytes, 1), this.config.privacy.source_max_bytes);
    const start = Math.max(Math.trunc(options.offset ?? 0), 0);
    return this.#forMailbox(mailbox, async () => {
      const adapter = await this.adapters.create(mailbox);
      const raw = await withTimeout(
        adapter.fetchRawSourceRange(locator.folder_id, locator.uid_validity, locator.uid, start, window),
        30_000,
        "fetch raw message",
      );
      const chunk = raw.bytes;
      if (chunk.byteLength === 0 && (raw.total_size === null || start < raw.total_size)) {
        throw new MailBridgeError("Raw message source is unavailable from this mailbox adapter", "RAW_SOURCE_UNAVAILABLE");
      }
      const delivered = start + chunk.byteLength;
      const more = raw.total_size === null ? chunk.byteLength === window : delivered < raw.total_size;
      return {
        ...this.messageContext(stableMessageId),
        headers: raw.headers,
        authentication: summarizeAuthentication(raw.headers),
        offset: start,
        next_offset: more ? delivered : null,
        returned_bytes: chunk.byteLength,
        truncated: more,
        sha256: createHash("sha256").update(chunk).digest("hex"),
        source_base64: Buffer.from(chunk).toString("base64"),
        untrusted_content_warning: UNTRUSTED_EMAIL_WARNING,
      };
    });
  }

  async fetchThread(stableMessageId: string, maxMessages: number) {
    const seed = await this.fetchMessage(stableMessageId, {
      include_html: false,
      max_body_chars: this.config.privacy.body_max_chars,
    });
    const locator = this.ids.decode(stableMessageId);
    const mailbox = this.registry.get(locator.mailbox_id);
    const identifiers = unique([seed.message_id, seed.in_reply_to, ...seed.references].filter(isString)).slice(0, 20);
    if (identifiers.length === 0) {
      return { messages: [seed], confidence: "LOW", partial_failures: [] as PartialFailure[] };
    }

    const folders = await this.#resolveSearchFolders(mailbox);
    const folderResults = await Promise.all(folders.map((folder) => this.#fanout.use(async () => {
      try {
        const adapter = await this.adapters.create(mailbox);
        const messages = await this.#forMailbox(mailbox, () =>
          withTimeout(
            adapter.search({ folder, thread_identifiers: identifiers, limit: maxMessages }),
            25_000,
            "thread search",
          ),
        );
        return { messages, failure: null };
      } catch (error) {
        const safe = safeError(error);
        return {
          messages: [] as RawMessageSummary[],
          failure: { mailbox_id: mailbox.id, folder, code: safe.code, retryable: safe.retryable } as PartialFailure,
        };
      }
    })));
    const summaries: RawMessageSummary[] = [];
    const failures: PartialFailure[] = [];
    for (const result of folderResults) {
      summaries.push(...result.messages);
      if (result.failure) failures.push(result.failure);
    }

    const locators = uniqueBy(
      summaries.map((message) => ({
        mailbox_id: mailbox.id,
        folder_id: message.folder,
        uid_validity: message.uid_validity,
        uid: message.uid,
      })),
      (value) => `${value.folder_id}\0${value.uid_validity}\0${value.uid}`,
    ).slice(0, maxMessages);

    const details: MessageDetail[] = [];
    for (const item of locators) {
      const id = this.ids.encode(item);
      try {
        details.push(
          await this.fetchMessage(id, {
            include_html: false,
            max_body_chars: this.config.privacy.body_max_chars,
          }),
        );
      } catch (error) {
        const safe = safeError(error);
        failures.push({ mailbox_id: mailbox.id, folder: item.folder_id, code: safe.code, retryable: safe.retryable });
      }
    }

    if (!details.some((message) => message.stable_message_id === stableMessageId)) details.push(seed);
    details.sort((a, b) => a.received_at.localeCompare(b.received_at));
    return {
      messages: uniqueBy(details, (message) => message.stable_message_id).slice(0, maxMessages),
      confidence: seed.message_id ? "HIGH" : "LOW",
      partial_failures: failures,
    };
  }

  async listAttachments(stableMessageId: string): Promise<AttachmentMetadata[]> {
    const message = await this.fetchMessage(stableMessageId, { include_html: false, max_body_chars: 1000 });
    return message.attachments;
  }

  async fetchAttachment(stableMessageId: string, attachmentId: string, maxBytes: number, offset = 0): Promise<AttachmentContent> {
    const locator = this.ids.decode(stableMessageId);
    const mailbox = this.registry.get(locator.mailbox_id);
    this.registry.assertFolderAllowed(mailbox, locator.folder_id);
    const window = Math.min(Math.max(maxBytes, 1), this.config.privacy.attachment_max_bytes);
    const start = Math.max(Math.trunc(offset), 0);
    return this.#forMailbox(mailbox, async () => {
      const adapter = await this.adapters.create(mailbox);
      const parts = await withTimeout(
        adapter.listAttachmentParts(locator.folder_id, locator.uid_validity, locator.uid),
        30_000,
        "list attachment parts",
      );
      const match = parts.find(
        (attachment) => this.ids.opaqueAttachmentId(stableMessageId, attachment.part) === attachmentId,
      );
      if (!match) throw new MailBridgeError("Attachment not found on this message", "ATTACHMENT_NOT_FOUND");
      const raw = await withTimeout(
        adapter.fetchAttachment(locator.folder_id, locator.uid_validity, locator.uid, match.part, start, window),
        60_000,
        "fetch attachment",
      );
      const chunk = raw.bytes;
      const delivered = start + chunk.byteLength;
      const more = raw.truncated;
      if (more && chunk.byteLength === 0) {
        throw new MailBridgeError("Attachment stream made no progress", "ATTACHMENT_SOURCE_UNAVAILABLE");
      }
      return {
        attachment_id: attachmentId,
        filename: raw.filename,
        mime_type: raw.mime_type,
        declared_size: raw.declared_size,
        offset: start,
        returned_bytes: chunk.byteLength,
        next_offset: more ? delivered : null,
        truncated: more,
        sha256: createHash("sha256").update(chunk).digest("hex"),
        content_base64: Buffer.from(chunk).toString("base64"),
        untrusted_content_warning: UNTRUSTED_EMAIL_WARNING,
      };
    });
  }

  checkBrandContext(input: BrandContextInput): BrandContextResult {
    return checkBrandContext(this.config.mailboxes, input);
  }

  async findCrossBrandThreads(input: {
    mailbox_ids: string[];
    after?: string;
    before?: string;
    limit: number;
  }): Promise<CrossBrandResult> {
    const limit = Math.min(Math.max(input.limit, 1), 50);
    const defaultAfter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const searched = await this.#searchFanout({
      mailbox_ids: input.mailbox_ids,
      after: input.after ?? defaultAfter,
      ...(input.before ? { before: input.before } : {}),
      limit: Math.min(limit * 3, 100),
    });
    const findings = findCrossBrandFindings(this.config.mailboxes, searched.messages);
    return {
      findings: findings.slice(0, limit),
      partial_failures: searched.partial_failures,
      truncated: searched.truncated || findings.length > limit,
      advisory_only: true,
    };
  }

  async #searchFanout(input: SearchMessagesInput, dedupeAcrossFolders = false): Promise<SearchMessagesResult> {
    const requested = unique(input.mailbox_ids);
    if (requested.length === 0 || requested.length > 20) {
      throw new MailBridgeError("mailbox_ids must contain between 1 and 20 entries", "INVALID_ARGUMENT");
    }
    const limit = Math.min(Math.max(input.limit, 1), 200);
    const messages: MessageSummary[] = [];
    const failures: PartialFailure[] = [];
    const tasks: Promise<void>[] = [];
    let folderAtLimit = false;

    for (const mailboxId of requested) {
      const mailbox = this.registry.get(mailboxId);
      let folders: string[];
      try {
        folders = await this.#resolveSearchFolders(mailbox, input.folders);
      } catch (error) {
        const safe = safeError(error);
        failures.push({ mailbox_id: mailbox.id, code: safe.code, retryable: safe.retryable });
        continue;
      }
      for (const folder of folders) {
        tasks.push(
          this.#fanout.use(async () => {
            try {
              const adapter = await this.adapters.create(mailbox);
              const folderInput: FolderSearchInput = {
                folder,
                limit: Math.min(limit, mailbox.result_limit),
                ...(input.free_text ? { free_text: input.free_text } : {}),
                ...(input.from ? { from: input.from } : {}),
                ...(input.to ? { to: input.to } : {}),
                ...(input.cc ? { cc: input.cc } : {}),
                ...(input.subject ? { subject: input.subject } : {}),
                ...(input.after ? { after: new Date(input.after) } : {}),
                ...(input.before ? { before: new Date(input.before) } : {}),
                ...(input.unread_only === undefined ? {} : { unread_only: input.unread_only }),
                ...(input.has_attachment === undefined ? {} : { has_attachment: input.has_attachment }),
              };
              const raw = await this.#forMailbox(mailbox, () =>
                withTimeout(adapter.search(folderInput), 25_000, "message search"),
              );
              if (raw.length >= folderInput.limit) folderAtLimit = true;
              messages.push(...raw.map((message) => this.#summary(mailbox, message)));
            } catch (error) {
              const safe = safeError(error);
              failures.push({ mailbox_id: mailbox.id, folder, code: safe.code, retryable: safe.retryable });
            }
          }),
        );
      }
    }
    await Promise.all(tasks);
    const ordered = messages.sort((a, b) => b.received_at.localeCompare(a.received_at));
    const selected = dedupeAcrossFolders ? dedupeSummaries(ordered) : ordered;
    return { messages: selected.slice(0, limit), partial_failures: failures, truncated: folderAtLimit || selected.length > limit };
  }

  async #selectableFolders(mailbox: MailboxConfig): Promise<string[]> {
    const cached = this.#folderCache.get(mailbox.id);
    if (cached && cached.expires_at > Date.now()) return cached.folders;
    const adapter = await this.adapters.create(mailbox);
    const discovered = await this.#forMailbox(mailbox, () =>
      withTimeout(adapter.discoverFolders(), 25_000, "discover folders"),
    );
    const selectable = discovered.filter((folder) => folder.selectable);
    const folders = selectable.map((folder) => folder.folder_id);
    const all = selectable.find((folder) => folder.special_use?.toLowerCase() === "\\all");
    const defaultSearchFolders = all
      ? [all, ...selectable.filter((folder) => ["\\drafts", "\\junk", "\\trash"].includes(folder.special_use?.toLowerCase() ?? ""))]
          .map((folder) => folder.folder_id)
      : folders;
    this.#folderCache.set(mailbox.id, { folders, default_search_folders: defaultSearchFolders, expires_at: Date.now() + FOLDER_CACHE_TTL_MS });
    return folders;
  }

  async #resolveSearchFolders(mailbox: MailboxConfig, requested?: string[]): Promise<string[]> {
    if (mailbox.folder_access !== "all_selectable") {
      const folders = requested?.length ? unique(requested) : mailbox.allowed_folders;
      for (const folder of folders) this.registry.assertFolderAllowed(mailbox, folder);
      return folders;
    }

    const selectable = new Set(await this.#selectableFolders(mailbox));
    const folders = requested?.length
      ? unique(requested)
      : this.#folderCache.get(mailbox.id)?.default_search_folders ?? [...selectable];
    const outside = folders.find((folder) => !selectable.has(folder));
    if (outside) throw new MailBridgeError("Folder is not selectable or was not discovered", "FOLDER_NOT_ALLOWED");
    return folders;
  }

  messageUrl(stableMessageId: string): string {
    const url = new URL(this.config.server.public_base_url);
    const basePath = url.pathname.replace(/\/$/, "");
    url.pathname = `${basePath}/messages/${encodeURIComponent(stableMessageId)}`;
    return url.toString();
  }

  #summary(mailbox: MailboxConfig, raw: RawMessageSummary): MessageSummary {
    const stableId = this.ids.encode({
      mailbox_id: mailbox.id,
      folder_id: raw.folder,
      uid_validity: raw.uid_validity,
      uid: raw.uid,
    });
    return {
      stable_message_id: stableId,
      mailbox_id: mailbox.id,
      mailbox_email: mailbox.email,
      brand: mailbox.brand,
      folder: raw.folder,
      source_folder: raw.folder,
      from: raw.from,
      to: raw.to,
      cc: raw.cc,
      subject: raw.subject,
      received_at: raw.received_at,
      unread: raw.unread,
      has_attachments: raw.attachments.length > 0,
      attachment_count: raw.attachments.length,
      safe_snippet: raw.snippet,
      untrusted_content_warning: UNTRUSTED_EMAIL_WARNING,
    };
  }

  #detail(mailbox: MailboxConfig, raw: RawMessageDetail, includeHtml: boolean, maxChars: number): MessageDetail {
    const summary = this.#summary(mailbox, raw);
    return {
      ...summary,
      headers: raw.headers,
      text_body: boundedText(raw.text_body, maxChars),
      ...(includeHtml && raw.html_body
        ? { sanitized_html: sanitizeEmailHtml(raw.html_body, maxChars) }
        : {}),
      attachments: raw.attachments.map((attachment) => this.#attachment(summary.stable_message_id, attachment)),
      message_id: raw.message_id,
      in_reply_to: raw.in_reply_to,
      references: raw.references,
      source_truncated: raw.source_truncated,
    };
  }

  #attachment(stableMessageId: string, value: RawAttachment): AttachmentMetadata {
    return {
      attachment_id: this.ids.opaqueAttachmentId(stableMessageId, value.part),
      filename: value.filename,
      mime_type: value.mime_type,
      size: value.size,
      disposition: value.disposition,
      inline: value.inline,
    };
  }

  #forMailbox<T>(mailbox: MailboxConfig, operation: () => Promise<T>): Promise<T> {
    const semaphore = this.#mailboxSemaphores.get(mailbox.id);
    if (!semaphore) throw new MailBridgeError("Mailbox concurrency state missing", "INTERNAL_ERROR");
    return semaphore.use(operation);
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const candidate = key(value);
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });
}

function isString(value: string | null): value is string {
  return Boolean(value);
}
