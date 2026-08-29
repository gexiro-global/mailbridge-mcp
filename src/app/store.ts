import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { CredentialEnvelopeCipher } from "./crypto.js";
import type {
  DraftAttachment,
  DraftValidation,
  DraftPayload,
  MailDraftView,
  MailboxConnectionTestResult,
  MailboxSettings,
  MailboxView,
  RuntimeMailbox,
  SendAuditEventView,
  SendConfirmationView,
  SendOperationState,
  SendOperationView,
  SendPolicyInput,
  SendPolicyView,
  SendReceipt,
  StoredCredentialEnvelope,
} from "./types.js";
import { SendPolicySchema } from "./types.js";
import { MailBridgeError } from "../domain/errors.js";

interface MailboxRow {
  mailbox_id: string;
  user_key: string;
  display_name: string;
  email: string;
  brand: string;
  purpose: string;
  imap_host: string;
  imap_port: number;
  tls_mode: string;
  send_enabled: number;
  send_transport: string;
  smtp_host: string | null;
  smtp_port: number;
  smtp_tls_mode: string;
  encrypted_credentials: string;
  enabled: number;
  folders_json: string;
  created_at: string;
  updated_at: string;
  last_health_status: string;
  last_successful_check: string | null;
  last_error_category: string | null;
}

interface DraftRow {
  draft_id: string;
  user_key: string;
  mailbox_id: string;
  version: number;
  encrypted_payload: string;
  status: "draft" | "sent";
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  message_id: string | null;
}

interface ReceiptRow {
  payload_hash: string;
  receipt_json: string;
}

interface SendPolicyRow {
  mailbox_id: string;
  send_mode: string;
  require_confirmation: number;
  allowed_domains_json: string;
  denied_domains_json: string;
  max_recipients: number;
  max_per_hour: number;
  max_per_day: number;
  external_recipients: string;
  confirmation_ttl_seconds: number;
  policy_version: number;
  updated_at: string;
}

interface ConfirmationRow {
  confirmation_id: string;
  draft_id: string;
  draft_version: number;
  payload_hash: string;
  policy_version: number;
  expires_at: string;
  used_at: string | null;
}

interface SendOperationRow {
  operation_id: string;
  idempotency_key: string;
  mailbox_id: string;
  payload_hash: string;
  state: SendOperationState;
  accepted_count: number;
  rejected_count: number;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

export class MailboxStore {
  readonly #db: DatabaseSync;

  constructor(
    readonly databasePath: string,
    readonly cipher: CredentialEnvelopeCipher,
    readonly maxMailboxesPerUser = 50,
  ) {
    this.#db = new DatabaseSync(databasePath);
    this.#db.exec("PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON; PRAGMA busy_timeout=5000;");
    if (databasePath !== ":memory:") this.#db.exec("PRAGMA journal_mode=WAL;");
    this.#migrate();
  }

  close(): void {
    this.#db.close();
  }

  list(userKey: string): MailboxView[] {
    const rows = this.#db
      .prepare("SELECT * FROM mailboxes WHERE user_key = ? ORDER BY created_at, mailbox_id")
      .all(userKey) as unknown as MailboxRow[];
    return rows.map(toView);
  }

  get(userKey: string, mailboxId: string): MailboxView {
    return toView(this.#row(userKey, mailboxId));
  }

  runtimeMailboxes(userKey: string): RuntimeMailbox[] {
    const rows = this.#db
      .prepare("SELECT * FROM mailboxes WHERE user_key = ? ORDER BY created_at, mailbox_id")
      .all(userKey) as unknown as MailboxRow[];
    return rows.map((row) => ({
      view: toView(row),
      credentials: this.cipher.decrypt(userKey, row.mailbox_id, parseEnvelope(row.encrypted_credentials)),
    }));
  }

  runtimeMailbox(userKey: string, mailboxId: string): RuntimeMailbox {
    const row = this.#row(userKey, mailboxId);
    return {
      view: toView(row),
      credentials: this.cipher.decrypt(userKey, row.mailbox_id, parseEnvelope(row.encrypted_credentials)),
    };
  }

  create(
    userKey: string,
    mailboxId: string,
    settings: MailboxSettings,
    credentials: { username: string; password: string },
    test: MailboxConnectionTestResult,
  ): MailboxView {
    if (test.status !== "PASS") throw new Error("A mailbox cannot be saved before the read-only connection test passes");
    const now = new Date().toISOString();
    const envelope = this.cipher.encrypt(userKey, mailboxId, credentials);
    this.#transaction(() => {
      this.#ensureUser(userKey, now);
      const countRow = this.#db.prepare("SELECT COUNT(*) AS count FROM mailboxes WHERE user_key = ?").get(userKey) as { count: number };
      if (Number(countRow.count) >= this.maxMailboxesPerUser) throw new Error("Mailbox limit reached");
      this.#db.prepare(`
        INSERT INTO mailboxes (
          mailbox_id, user_key, display_name, email, brand, purpose, imap_host, imap_port, tls_mode,
          send_enabled, send_transport, smtp_host, smtp_port, smtp_tls_mode,
          encrypted_credentials, enabled, folders_json, created_at, updated_at, last_health_status,
          last_successful_check, last_error_category
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?, NULL)
      `).run(
        mailboxId, userKey, settings.display_name, settings.email, settings.brand, settings.purpose,
        settings.imap_host, settings.imap_port, settings.tls_mode,
        (settings.send_enabled ?? false) ? 1 : 0, settings.send_transport ?? "smtp", settings.smtp_host ?? null,
        settings.smtp_port ?? 465, settings.smtp_tls_mode ?? "implicit",
        JSON.stringify(envelope),
        settings.enabled ? 1 : 0, JSON.stringify(uniqueFolders(settings.allowed_folders)), now, now, now,
      );
      this.#audit(userKey, mailboxId, "MAILBOX_CREATED", "PASS", now);
    });
    return this.get(userKey, mailboxId);
  }

  update(userKey: string, mailboxId: string, settings: MailboxSettings): MailboxView {
    const now = new Date().toISOString();
    const info = this.#db.prepare(`
      UPDATE mailboxes SET display_name = ?, email = ?, brand = ?, purpose = ?, imap_host = ?, imap_port = ?,
        tls_mode = ?, send_enabled = ?, send_transport = ?, smtp_host = ?, smtp_port = ?, smtp_tls_mode = ?,
        folders_json = ?, enabled = 0, last_health_status = 'unknown', last_error_category = NULL,
        updated_at = ?
      WHERE user_key = ? AND mailbox_id = ?
    `).run(
      settings.display_name, settings.email, settings.brand, settings.purpose, settings.imap_host,
      settings.imap_port, settings.tls_mode, (settings.send_enabled ?? false) ? 1 : 0, settings.send_transport ?? "smtp",
      settings.smtp_host ?? null, settings.smtp_port ?? 465, settings.smtp_tls_mode ?? "implicit",
      JSON.stringify(uniqueFolders(settings.allowed_folders)), now,
      userKey, mailboxId,
    );
    if (Number(info.changes) !== 1) throw new Error("Mailbox not found");
    this.#audit(userKey, mailboxId, "MAILBOX_UPDATED", "PASS", now);
    return this.get(userKey, mailboxId);
  }

  replaceCredentials(
    userKey: string,
    mailboxId: string,
    credentials: { username: string; password: string },
    test: MailboxConnectionTestResult,
  ): MailboxView {
    if (test.status !== "PASS") throw new Error("Credentials were not replaced because the read-only test failed");
    this.#row(userKey, mailboxId);
    const envelope = this.cipher.encrypt(userKey, mailboxId, credentials);
    const now = new Date().toISOString();
    this.#db.prepare(`
      UPDATE mailboxes SET encrypted_credentials = ?, updated_at = ?, last_health_status = 'connected',
        last_successful_check = ?, last_error_category = NULL WHERE user_key = ? AND mailbox_id = ?
    `).run(JSON.stringify(envelope), now, now, userKey, mailboxId);
    this.#audit(userKey, mailboxId, "CREDENTIALS_REPLACED", "PASS", now);
    return this.get(userKey, mailboxId);
  }

  recordHealth(userKey: string, mailboxId: string, test: MailboxConnectionTestResult): MailboxView {
    const current = this.#row(userKey, mailboxId);
    const now = new Date().toISOString();
    this.#db.prepare(`
      UPDATE mailboxes SET last_health_status = ?, last_successful_check = ?, last_error_category = ?, updated_at = ?
      WHERE user_key = ? AND mailbox_id = ?
    `).run(
      test.status === "PASS" ? "connected" : "error",
      test.status === "PASS" ? now : current.last_successful_check,
      test.status === "PASS" ? null : test.error_category ?? "IMAP_TEST_FAILED",
      now, userKey, mailboxId,
    );
    this.#audit(userKey, mailboxId, "IMAP_CONNECTION_TEST", test.status, now);
    return this.get(userKey, mailboxId);
  }

  addAllowedFolders(userKey: string, mailboxId: string, folders: string[]): MailboxView {
    const row = this.#row(userKey, mailboxId);
    const current = parseFolders(row.folders_json);
    const merged = uniqueFolders([...current, ...folders.map((folder) => folder.trim()).filter(Boolean)]);
    if (merged.length === current.length && merged.every((folder, index) => folder === current[index])) {
      return this.get(userKey, mailboxId);
    }
    if (merged.length > 100) throw new Error("Allowed-folder limit reached");
    const now = new Date().toISOString();
    this.#transaction(() => {
      this.#db.prepare("UPDATE mailboxes SET folders_json = ?, updated_at = ? WHERE user_key = ? AND mailbox_id = ?")
        .run(JSON.stringify(merged), now, userKey, mailboxId);
      this.#audit(userKey, mailboxId, "ALLOWED_FOLDERS_EXPANDED", "PASS", now);
    });
    this.#checkpoint();
    return this.get(userKey, mailboxId);
  }

  setEnabled(userKey: string, mailboxId: string, enabled: boolean): MailboxView {
    const current = this.#row(userKey, mailboxId);
    if (enabled && current.last_health_status !== "connected") throw new Error("Mailbox must pass a connection test before it can be enabled");
    const now = new Date().toISOString();
    this.#db.prepare("UPDATE mailboxes SET enabled = ?, updated_at = ? WHERE user_key = ? AND mailbox_id = ?")
      .run(enabled ? 1 : 0, now, userKey, mailboxId);
    this.#audit(userKey, mailboxId, enabled ? "MAILBOX_ENABLED" : "MAILBOX_DISABLED", "PASS", now);
    return this.get(userKey, mailboxId);
  }

  configureSend(
    userKey: string,
    mailboxId: string,
    input: { enabled: boolean; transport: "smtp"; host: string | null; port: number; tls_mode: "implicit" | "starttls" },
  ): MailboxView {
    this.#row(userKey, mailboxId);
    if (input.enabled && !input.host) throw new Error("SMTP hostname is required when sending is enabled");
    const now = new Date().toISOString();
    const result = this.#db.prepare(`
      UPDATE mailboxes SET send_enabled = ?, send_transport = ?, smtp_host = ?, smtp_port = ?, smtp_tls_mode = ?, updated_at = ?
      WHERE user_key = ? AND mailbox_id = ?
    `).run(input.enabled ? 1 : 0, input.transport, input.host, input.port, input.tls_mode, now, userKey, mailboxId);
    if (Number(result.changes) !== 1) throw new Error("Mailbox not found");
    this.#audit(userKey, mailboxId, input.enabled ? "MAIL_SEND_ENABLED" : "MAIL_SEND_DISABLED", "PASS", now);
    return this.get(userKey, mailboxId);
  }

  getSendPolicy(userKey: string, mailboxId: string): SendPolicyView {
    this.#row(userKey, mailboxId);
    const row = this.#db.prepare(
      "SELECT * FROM send_policies WHERE user_key = ? AND mailbox_id = ?",
    ).get(userKey, mailboxId) as SendPolicyRow | undefined;
    if (!row) {
      return {
        mailbox_id: mailboxId,
        ...SendPolicySchema.parse({}),
        policy_version: 0,
        updated_at: null,
      };
    }
    return {
      mailbox_id: row.mailbox_id,
      send_mode: row.send_mode as SendPolicyView["send_mode"],
      require_confirmation: true,
      allowed_domains: parseStringArray(row.allowed_domains_json),
      denied_domains: parseStringArray(row.denied_domains_json),
      max_recipients: Number(row.max_recipients),
      max_per_hour: Number(row.max_per_hour),
      max_per_day: Number(row.max_per_day),
      external_recipients: row.external_recipients as SendPolicyView["external_recipients"],
      confirmation_ttl_seconds: Number(row.confirmation_ttl_seconds),
      policy_version: Number(row.policy_version),
      updated_at: row.updated_at,
    };
  }

  setSendPolicy(userKey: string, mailboxId: string, input: SendPolicyInput): SendPolicyView {
    this.#row(userKey, mailboxId);
    const policy = SendPolicySchema.parse(input);
    const now = new Date().toISOString();
    this.#transaction(() => {
      this.#db.prepare(`
        INSERT INTO send_policies (
          user_key, mailbox_id, send_mode, require_confirmation, allowed_domains_json, denied_domains_json,
          max_recipients, max_per_hour, max_per_day, external_recipients, confirmation_ttl_seconds,
          policy_version, updated_at
        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(user_key, mailbox_id) DO UPDATE SET
          send_mode = excluded.send_mode,
          require_confirmation = 1,
          allowed_domains_json = excluded.allowed_domains_json,
          denied_domains_json = excluded.denied_domains_json,
          max_recipients = excluded.max_recipients,
          max_per_hour = excluded.max_per_hour,
          max_per_day = excluded.max_per_day,
          external_recipients = excluded.external_recipients,
          confirmation_ttl_seconds = excluded.confirmation_ttl_seconds,
          policy_version = send_policies.policy_version + 1,
          updated_at = excluded.updated_at
      `).run(
        userKey, mailboxId, policy.send_mode, JSON.stringify(policy.allowed_domains), JSON.stringify(policy.denied_domains),
        policy.max_recipients, policy.max_per_hour, policy.max_per_day, policy.external_recipients,
        policy.confirmation_ttl_seconds, now,
      );
      this.#db.prepare(
        "DELETE FROM send_confirmations WHERE user_key = ? AND draft_id IN (SELECT draft_id FROM mail_drafts WHERE user_key = ? AND mailbox_id = ?)",
      ).run(userKey, userKey, mailboxId);
      this.#audit(userKey, mailboxId, "MAIL_SEND_POLICY_UPDATED", "PASS", now);
    });
    return this.getSendPolicy(userKey, mailboxId);
  }

  sendUsage(userKey: string, mailboxId: string, now = new Date()): { last_hour: number; last_day: number } {
    const hour = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const day = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const row = this.#db.prepare(`
      SELECT
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last_hour,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last_day
      FROM send_rate_events WHERE user_key = ? AND mailbox_id = ?
    `).get(hour, day, userKey, mailboxId) as { last_hour: number | null; last_day: number | null };
    return { last_hour: Number(row.last_hour ?? 0), last_day: Number(row.last_day ?? 0) };
  }

  deleteMailbox(userKey: string, mailboxId: string): void {
    this.#row(userKey, mailboxId);
    this.#transaction(() => {
      this.#audit(userKey, mailboxId, "MAILBOX_DELETED", "PASS", new Date().toISOString());
      this.#db.prepare("DELETE FROM mailboxes WHERE user_key = ? AND mailbox_id = ?").run(userKey, mailboxId);
    });
    this.#checkpoint();
  }

  deleteAll(userKey: string): { deleted_mailboxes: number; deletion_id: string } {
    const deletionId = `del_${randomUUID()}`;
    let deleted = 0;
    this.#transaction(() => {
      const result = this.#db.prepare("DELETE FROM mailboxes WHERE user_key = ?").run(userKey);
      deleted = Number(result.changes);
      this.#db.prepare("DELETE FROM audit_events WHERE user_key = ?").run(userKey);
      this.#db.prepare("DELETE FROM users WHERE user_key = ?").run(userKey);
    });
    this.#checkpoint();
    return { deleted_mailboxes: deleted, deletion_id: deletionId };
  }

  createDraft(userKey: string, payload: DraftPayload): MailDraftView {
    this.#row(userKey, payload.mailbox_id);
    const draftId = `draft_${randomUUID().replaceAll("-", "")}`;
    const now = new Date().toISOString();
    const envelope = this.cipher.encryptJson(userKey, draftId, "draft-v1", payload);
    this.#transaction(() => {
      this.#db.prepare(`
        INSERT INTO mail_drafts (
          draft_id, user_key, mailbox_id, version, encrypted_payload, status, created_at, updated_at, sent_at, message_id
        ) VALUES (?, ?, ?, 1, ?, 'draft', ?, ?, NULL, NULL)
      `).run(draftId, userKey, payload.mailbox_id, JSON.stringify(envelope), now, now);
      this.#audit(userKey, payload.mailbox_id, "MAIL_DRAFT_CREATED", "PASS", now);
    });
    return this.getDraft(userKey, draftId);
  }

  getDraft(userKey: string, draftId: string): MailDraftView {
    const row = this.#db.prepare("SELECT * FROM mail_drafts WHERE user_key = ? AND draft_id = ?")
      .get(userKey, draftId) as DraftRow | undefined;
    if (!row) throw new Error("Draft not found");
    const payload = this.getDraftPayload(userKey, draftId);
    const { attachments, ...message } = payload;
    return {
      draft_id: row.draft_id,
      version: Number(row.version),
      ...message,
      attachments: attachments.map(({ content_base64: _content, ...metadata }) => metadata),
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      sent_at: row.sent_at,
      message_id: row.message_id,
    };
  }

  getDraftPayload(userKey: string, draftId: string): DraftPayload {
    const row = this.#db.prepare("SELECT * FROM mail_drafts WHERE user_key = ? AND draft_id = ?")
      .get(userKey, draftId) as DraftRow | undefined;
    if (!row) throw new Error("Draft not found");
    return parseDraftPayload(this.cipher.decryptJson(
      userKey,
      row.draft_id,
      "draft-v1",
      parseEnvelope(row.encrypted_payload),
    ));
  }

  updateDraft(userKey: string, draftId: string, expectedVersion: number, payload: DraftPayload): MailDraftView {
    const current = this.getDraft(userKey, draftId);
    if (current.status !== "draft") throw new MailBridgeError("A sent draft cannot be edited", "DRAFT_ALREADY_SENT");
    if (current.version !== expectedVersion) throw new MailBridgeError("Draft changed since it was opened", "DRAFT_VERSION_CONFLICT");
    if (current.mailbox_id !== payload.mailbox_id) throw new MailBridgeError("Draft mailbox cannot be changed", "MAILBOX_MISMATCH");
    const now = new Date().toISOString();
    const envelope = this.cipher.encryptJson(userKey, draftId, "draft-v1", payload);
    this.#transaction(() => {
      const result = this.#db.prepare(`
        UPDATE mail_drafts SET encrypted_payload = ?, version = version + 1, updated_at = ?
        WHERE user_key = ? AND draft_id = ? AND version = ? AND status = 'draft'
      `).run(JSON.stringify(envelope), now, userKey, draftId, expectedVersion);
      if (Number(result.changes) !== 1) throw new MailBridgeError("Draft changed before the update completed", "DRAFT_VERSION_CONFLICT");
      this.#db.prepare("DELETE FROM send_confirmations WHERE user_key = ? AND draft_id = ?").run(userKey, draftId);
      this.#audit(userKey, current.mailbox_id, "MAIL_DRAFT_UPDATED", "PASS", now);
    });
    return this.getDraft(userKey, draftId);
  }

  addDraftAttachment(
    userKey: string,
    draftId: string,
    expectedVersion: number,
    attachment: DraftAttachment,
  ): MailDraftView {
    const payload = this.getDraftPayload(userKey, draftId);
    if (payload.attachments.some((item) => item.attachment_id === attachment.attachment_id)) {
      throw new MailBridgeError("Attachment identifier already exists", "ATTACHMENT_CONFLICT");
    }
    const updated = { ...payload, attachments: [...payload.attachments, attachment] };
    const view = this.updateDraft(userKey, draftId, expectedVersion, updated);
    this.#audit(userKey, payload.mailbox_id, "MAIL_DRAFT_ATTACHMENT_ADDED", "PASS", new Date().toISOString());
    return view;
  }

  removeDraftAttachment(
    userKey: string,
    draftId: string,
    expectedVersion: number,
    attachmentId: string,
  ): MailDraftView {
    const payload = this.getDraftPayload(userKey, draftId);
    const updatedAttachments = payload.attachments.filter((item) => item.attachment_id !== attachmentId);
    if (updatedAttachments.length === payload.attachments.length) {
      throw new MailBridgeError("Attachment not found on this draft", "ATTACHMENT_NOT_FOUND");
    }
    const view = this.updateDraft(
      userKey,
      draftId,
      expectedVersion,
      { ...payload, attachments: updatedAttachments },
    );
    this.#audit(userKey, payload.mailbox_id, "MAIL_DRAFT_ATTACHMENT_REMOVED", "PASS", new Date().toISOString());
    return view;
  }

  markDraftSent(userKey: string, draftId: string, receipt: SendReceipt): MailDraftView {
    const current = this.getDraft(userKey, draftId);
    if (current.status === "sent") return current;
    const now = receipt.sent_at;
    const result = this.#db.prepare(`
      UPDATE mail_drafts SET status = 'sent', sent_at = ?, message_id = ?, version = version + 1, updated_at = ?
      WHERE user_key = ? AND draft_id = ? AND status = 'draft'
    `).run(now, receipt.message_id, now, userKey, draftId);
    if (Number(result.changes) !== 1) throw new Error("Draft status changed before send completion");
    this.#audit(userKey, current.mailbox_id, "MAIL_DRAFT_SENT", "PASS", now);
    return this.getDraft(userKey, draftId);
  }

  createSendConfirmation(
    userKey: string,
    draftId: string,
    payloadHash: string,
    validation: DraftValidation,
    ttlSeconds: number,
  ): SendConfirmationView {
    if (validation.blocked) throw new MailBridgeError("Draft is blocked by send policy", "SEND_POLICY_BLOCKED");
    const draft = this.getDraft(userKey, draftId);
    if (draft.status !== "draft") throw new MailBridgeError("Draft has already been sent", "DRAFT_ALREADY_SENT");
    if (draft.version !== validation.draft_version) throw new MailBridgeError("Draft changed after validation", "DRAFT_VERSION_CONFLICT");
    const confirmationId = `confirm_${randomUUID().replaceAll("-", "")}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    this.#transaction(() => {
      this.#db.prepare("DELETE FROM send_confirmations WHERE user_key = ? AND draft_id = ?").run(userKey, draftId);
      this.#db.prepare(`
        INSERT INTO send_confirmations (
          confirmation_id, user_key, draft_id, draft_version, payload_hash, policy_version, expires_at, used_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
      `).run(
        confirmationId, userKey, draftId, validation.draft_version, payloadHash,
        validation.policy_version, expiresAt, now.toISOString(),
      );
      this.#sendAudit(userKey, null, draft.mailbox_id, "SEND_CONFIRMATION_PREPARED", "PASS", null,
        validation.recipient_count, validation.external_recipient_count, null, now.toISOString());
    });
    return {
      confirmation_id: confirmationId,
      draft_id: draftId,
      draft_version: validation.draft_version,
      expires_at: expiresAt,
      validation,
    };
  }

  consumeSendConfirmation(
    userKey: string,
    confirmationId: string,
    draftId: string,
    draftVersion: number,
    payloadHash: string,
    policyVersion: number,
  ): void {
    const now = new Date().toISOString();
    this.#transaction(() => {
      const row = this.#db.prepare(
        "SELECT * FROM send_confirmations WHERE user_key = ? AND confirmation_id = ?",
      ).get(userKey, confirmationId) as ConfirmationRow | undefined;
      if (!row || row.draft_id !== draftId) throw new MailBridgeError("Send confirmation is invalid", "SEND_CONFIRMATION_INVALID");
      if (row.used_at) throw new MailBridgeError("Send confirmation was already used", "SEND_CONFIRMATION_USED");
      if (row.expires_at <= now) throw new MailBridgeError("Send confirmation expired", "SEND_CONFIRMATION_EXPIRED");
      if (Number(row.draft_version) !== draftVersion || row.payload_hash !== payloadHash || Number(row.policy_version) !== policyVersion) {
        throw new MailBridgeError("Draft or policy changed after confirmation", "SEND_CONFIRMATION_STALE");
      }
      const result = this.#db.prepare(`
        UPDATE send_confirmations SET used_at = ?
        WHERE user_key = ? AND confirmation_id = ? AND used_at IS NULL
      `).run(now, userKey, confirmationId);
      if (Number(result.changes) !== 1) throw new MailBridgeError("Send confirmation could not be consumed", "SEND_CONFIRMATION_USED");
    });
  }

  reserveSendOperation(
    userKey: string,
    idempotencyKey: string,
    mailboxId: string,
    payloadHash: string,
    policy: SendPolicyView,
    recipientCount: number,
    externalRecipientCount: number,
  ): { operation: SendOperationView; replayed: boolean; receipt?: SendReceipt } {
    let result: { operation: SendOperationView; replayed: boolean; receipt?: SendReceipt } | undefined;
    this.#transaction(() => {
      const existing = this.#db.prepare(
        "SELECT * FROM send_operations WHERE user_key = ? AND idempotency_key = ?",
      ).get(userKey, idempotencyKey) as SendOperationRow | undefined;
      if (existing) {
        if (existing.payload_hash !== payloadHash) throw new MailBridgeError("Idempotency key was reused for different content", "IDEMPOTENCY_CONFLICT");
        if (["smtp_accepted", "partial_rejected", "rejected"].includes(existing.state)) {
          const prior = this.getSendReceipt(userKey, idempotencyKey);
          if (!prior) throw new MailBridgeError("Completed send receipt is unavailable", "SEND_RECEIPT_MISSING");
          result = { operation: toSendOperationView(existing), replayed: true, receipt: prior.receipt };
          return;
        }
        throw new MailBridgeError(
          existing.state === "submitting" ? "An identical send is already in progress" : "Previous send outcome is unknown; automatic retry is blocked",
          existing.state === "submitting" ? "SEND_ALREADY_SUBMITTING" : "SEND_STATUS_UNKNOWN",
        );
      }

      const usage = this.sendUsage(userKey, mailboxId);
      if (usage.last_hour >= policy.max_per_hour) throw new MailBridgeError("Hourly send limit exceeded", "HOURLY_SEND_LIMIT_EXCEEDED");
      if (usage.last_day >= policy.max_per_day) throw new MailBridgeError("Daily send limit exceeded", "DAILY_SEND_LIMIT_EXCEEDED");
      const operationId = `op_${randomUUID().replaceAll("-", "")}`;
      const now = new Date().toISOString();
      this.#db.prepare(`
        INSERT INTO send_operations (
          operation_id, user_key, idempotency_key, mailbox_id, payload_hash, state,
          accepted_count, rejected_count, error_code, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'submitting', 0, 0, NULL, ?, ?)
      `).run(operationId, userKey, idempotencyKey, mailboxId, payloadHash, now, now);
      this.#db.prepare(`
        INSERT INTO send_rate_events (operation_id, user_key, mailbox_id, created_at) VALUES (?, ?, ?, ?)
      `).run(operationId, userKey, mailboxId, now);
      this.#sendAudit(userKey, operationId, mailboxId, "SEND_SUBMITTING", "PASS", "submitting",
        recipientCount, externalRecipientCount, null, now);
      result = {
        operation: {
          operation_id: operationId,
          mailbox_id: mailboxId,
          state: "submitting",
          accepted_count: 0,
          rejected_count: 0,
          created_at: now,
          updated_at: now,
          error_code: null,
        },
        replayed: false,
      };
    });
    return result!;
  }

  completeSendOperation(
    userKey: string,
    idempotencyKey: string,
    receipt: SendReceipt,
    recipientCount: number,
    externalRecipientCount: number,
  ): SendOperationView {
    const state: SendOperationState = receipt.accepted.length === 0
      ? "rejected"
      : receipt.rejected.length > 0
        ? "partial_rejected"
        : "smtp_accepted";
    const envelope = this.cipher.encryptJson(userKey, idempotencyKey, "send-receipt-v1", receipt);
    this.#transaction(() => {
      const row = this.#db.prepare(
        "SELECT * FROM send_operations WHERE user_key = ? AND idempotency_key = ?",
      ).get(userKey, idempotencyKey) as SendOperationRow | undefined;
      if (!row) throw new MailBridgeError("Send operation is missing", "SEND_OPERATION_MISSING");
      if (row.state !== "submitting") throw new MailBridgeError("Send operation is not active", "SEND_OPERATION_STATE_CONFLICT");
      this.#db.prepare(`
        UPDATE send_operations SET state = ?, accepted_count = ?, rejected_count = ?, updated_at = ?
        WHERE user_key = ? AND idempotency_key = ? AND state = 'submitting'
      `).run(state, receipt.accepted.length, receipt.rejected.length, receipt.sent_at, userKey, idempotencyKey);
      this.#db.prepare(`
        INSERT INTO send_receipts (user_key, idempotency_key, payload_hash, receipt_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(userKey, idempotencyKey, row.payload_hash, JSON.stringify(envelope), receipt.sent_at);
      this.#sendAudit(userKey, row.operation_id, receipt.mailbox_id, "MAIL_SENT", state === "rejected" ? "FAIL" : "PASS", state,
        recipientCount, externalRecipientCount, state === "rejected" ? "SMTP_REJECTED" : null, receipt.sent_at);
    });
    return this.getSendOperation(userKey, this.#operationId(userKey, idempotencyKey));
  }

  markSendOperationUnknown(
    userKey: string,
    idempotencyKey: string,
    errorCode: string,
    recipientCount: number,
    externalRecipientCount: number,
  ): SendOperationView {
    const now = new Date().toISOString();
    let operationId = "";
    let mailboxId = "";
    this.#transaction(() => {
      const row = this.#db.prepare(
        "SELECT * FROM send_operations WHERE user_key = ? AND idempotency_key = ?",
      ).get(userKey, idempotencyKey) as SendOperationRow | undefined;
      if (!row) throw new MailBridgeError("Send operation is missing", "SEND_OPERATION_MISSING");
      operationId = row.operation_id;
      mailboxId = row.mailbox_id;
      this.#db.prepare(`
        UPDATE send_operations SET state = 'unknown', error_code = ?, updated_at = ?
        WHERE user_key = ? AND idempotency_key = ? AND state = 'submitting'
      `).run(errorCode, now, userKey, idempotencyKey);
      this.#sendAudit(userKey, row.operation_id, row.mailbox_id, "SEND_OUTCOME_UNKNOWN", "FAIL", "unknown",
        recipientCount, externalRecipientCount, errorCode, now);
    });
    return this.getSendOperation(userKey, operationId || this.#operationId(userKey, idempotencyKey));
  }

  getSendOperation(userKey: string, operationId: string): SendOperationView {
    const row = this.#db.prepare(
      "SELECT * FROM send_operations WHERE user_key = ? AND operation_id = ?",
    ).get(userKey, operationId) as SendOperationRow | undefined;
    if (!row) throw new MailBridgeError("Send operation not found", "SEND_OPERATION_NOT_FOUND");
    return toSendOperationView(row);
  }

  getSendOperationByKey(userKey: string, idempotencyKey: string): SendOperationView | null {
    const row = this.#db.prepare(
      "SELECT * FROM send_operations WHERE user_key = ? AND idempotency_key = ?",
    ).get(userKey, idempotencyKey) as SendOperationRow | undefined;
    return row ? toSendOperationView(row) : null;
  }

  listSendAudit(userKey: string, limit = 50): SendAuditEventView[] {
    return this.#db.prepare(`
      SELECT event_id, operation_id, mailbox_id, action, result, state, recipient_count,
        external_recipient_count, reason_code, at
      FROM send_audit_events WHERE user_key = ? ORDER BY event_id DESC LIMIT ?
    `).all(userKey, limit) as unknown as SendAuditEventView[];
  }

  getSendReceipt(userKey: string, idempotencyKey: string): { payload_hash: string; receipt: SendReceipt } | null {
    const row = this.#db.prepare(
      "SELECT payload_hash, receipt_json FROM send_receipts WHERE user_key = ? AND idempotency_key = ?",
    ).get(userKey, idempotencyKey) as ReceiptRow | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.receipt_json) as unknown;
    const receipt = isEnvelope(parsed)
      ? this.cipher.decryptJson(userKey, idempotencyKey, "send-receipt-v1", parsed)
      : parsed;
    return { payload_hash: row.payload_hash, receipt: parseSendReceipt(receipt) };
  }

  recordSendReceipt(userKey: string, idempotencyKey: string, payloadHash: string, receipt: SendReceipt): void {
    const envelope = this.cipher.encryptJson(userKey, idempotencyKey, "send-receipt-v1", receipt);
    this.#db.prepare(`
      INSERT INTO send_receipts (user_key, idempotency_key, payload_hash, receipt_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(userKey, idempotencyKey, payloadHash, JSON.stringify(envelope), receipt.sent_at);
    this.#audit(userKey, receipt.mailbox_id, "MAIL_SENT", "PASS", receipt.sent_at);
  }

  auditEvents(userKey: string): Array<{ mailbox_id: string | null; action: string; result: string; at: string }> {
    return this.#db.prepare(
      "SELECT mailbox_id, action, result, at FROM audit_events WHERE user_key = ? ORDER BY id",
    ).all(userKey) as Array<{ mailbox_id: string | null; action: string; result: string; at: string }>;
  }

  #migrate(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        user_key TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mailboxes (
        mailbox_id TEXT NOT NULL,
        user_key TEXT NOT NULL,
        display_name TEXT NOT NULL,
        email TEXT NOT NULL,
        brand TEXT NOT NULL,
        purpose TEXT NOT NULL,
        imap_host TEXT NOT NULL,
        imap_port INTEGER NOT NULL,
        tls_mode TEXT NOT NULL CHECK (tls_mode IN ('implicit', 'starttls')),
        encrypted_credentials TEXT NOT NULL,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        folders_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_health_status TEXT NOT NULL CHECK (last_health_status IN ('unknown', 'connected', 'error')),
        last_successful_check TEXT,
        last_error_category TEXT,
        PRIMARY KEY (user_key, mailbox_id),
        FOREIGN KEY (user_key) REFERENCES users(user_key) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_key TEXT NOT NULL,
        mailbox_id TEXT,
        action TEXT NOT NULL,
        result TEXT NOT NULL CHECK (result IN ('PASS', 'FAIL')),
        at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS mailboxes_user_key_idx ON mailboxes(user_key);
      CREATE INDEX IF NOT EXISTS audit_user_key_idx ON audit_events(user_key);
    `);
    this.#ensureColumn("mailboxes", "send_enabled", "INTEGER NOT NULL DEFAULT 0 CHECK (send_enabled IN (0, 1))");
    this.#ensureColumn("mailboxes", "send_transport", "TEXT NOT NULL DEFAULT 'smtp' CHECK (send_transport = 'smtp')");
    this.#ensureColumn("mailboxes", "smtp_host", "TEXT");
    this.#ensureColumn("mailboxes", "smtp_port", "INTEGER NOT NULL DEFAULT 465");
    this.#ensureColumn("mailboxes", "smtp_tls_mode", "TEXT NOT NULL DEFAULT 'implicit' CHECK (smtp_tls_mode IN ('implicit', 'starttls'))");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS mail_drafts (
        draft_id TEXT NOT NULL,
        user_key TEXT NOT NULL,
        mailbox_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        encrypted_payload TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'sent')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sent_at TEXT,
        message_id TEXT,
        PRIMARY KEY (user_key, draft_id),
        FOREIGN KEY (user_key, mailbox_id) REFERENCES mailboxes(user_key, mailbox_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS send_receipts (
        user_key TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        receipt_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_key, idempotency_key),
        FOREIGN KEY (user_key) REFERENCES users(user_key) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS mail_drafts_user_key_idx ON mail_drafts(user_key);
      CREATE INDEX IF NOT EXISTS send_receipts_user_key_idx ON send_receipts(user_key);
      CREATE TABLE IF NOT EXISTS send_policies (
        user_key TEXT NOT NULL,
        mailbox_id TEXT NOT NULL,
        send_mode TEXT NOT NULL CHECK (send_mode IN ('disabled', 'draft_only', 'direct_allowed')),
        require_confirmation INTEGER NOT NULL CHECK (require_confirmation = 1),
        allowed_domains_json TEXT NOT NULL,
        denied_domains_json TEXT NOT NULL,
        max_recipients INTEGER NOT NULL,
        max_per_hour INTEGER NOT NULL,
        max_per_day INTEGER NOT NULL,
        external_recipients TEXT NOT NULL CHECK (external_recipients IN ('allow', 'warn', 'block')),
        confirmation_ttl_seconds INTEGER NOT NULL,
        policy_version INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_key, mailbox_id),
        FOREIGN KEY (user_key, mailbox_id) REFERENCES mailboxes(user_key, mailbox_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS send_confirmations (
        confirmation_id TEXT NOT NULL,
        user_key TEXT NOT NULL,
        draft_id TEXT NOT NULL,
        draft_version INTEGER NOT NULL,
        payload_hash TEXT NOT NULL,
        policy_version INTEGER NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_key, confirmation_id),
        FOREIGN KEY (user_key, draft_id) REFERENCES mail_drafts(user_key, draft_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS send_operations (
        operation_id TEXT NOT NULL,
        user_key TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        mailbox_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('submitting', 'smtp_accepted', 'partial_rejected', 'rejected', 'unknown')),
        accepted_count INTEGER NOT NULL DEFAULT 0,
        rejected_count INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_key, operation_id),
        UNIQUE (user_key, idempotency_key),
        FOREIGN KEY (user_key, mailbox_id) REFERENCES mailboxes(user_key, mailbox_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS send_rate_events (
        operation_id TEXT NOT NULL,
        user_key TEXT NOT NULL,
        mailbox_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_key, operation_id),
        FOREIGN KEY (user_key, operation_id) REFERENCES send_operations(user_key, operation_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS send_audit_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_key TEXT NOT NULL,
        operation_id TEXT,
        mailbox_id TEXT NOT NULL,
        action TEXT NOT NULL,
        result TEXT NOT NULL CHECK (result IN ('PASS', 'FAIL')),
        state TEXT CHECK (state IS NULL OR state IN ('submitting', 'smtp_accepted', 'partial_rejected', 'rejected', 'unknown')),
        recipient_count INTEGER NOT NULL,
        external_recipient_count INTEGER NOT NULL,
        reason_code TEXT,
        at TEXT NOT NULL,
        FOREIGN KEY (user_key, mailbox_id) REFERENCES mailboxes(user_key, mailbox_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS send_confirmations_draft_idx ON send_confirmations(user_key, draft_id);
      CREATE INDEX IF NOT EXISTS send_operations_mailbox_idx ON send_operations(user_key, mailbox_id, created_at);
      CREATE INDEX IF NOT EXISTS send_rate_mailbox_idx ON send_rate_events(user_key, mailbox_id, created_at);
      CREATE INDEX IF NOT EXISTS send_audit_user_idx ON send_audit_events(user_key, event_id);
    `);
    this.#ensureColumn("mail_drafts", "version", "INTEGER NOT NULL DEFAULT 1");
  }

  #ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.#db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((entry) => entry.name === column)) {
      this.#db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  #row(userKey: string, mailboxId: string): MailboxRow {
    const row = this.#db.prepare("SELECT * FROM mailboxes WHERE user_key = ? AND mailbox_id = ?").get(userKey, mailboxId) as MailboxRow | undefined;
    if (!row) throw new Error("Mailbox not found");
    return row;
  }

  #ensureUser(userKey: string, now: string): void {
    this.#db.prepare(`
      INSERT INTO users (user_key, created_at, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(user_key) DO UPDATE SET updated_at = excluded.updated_at
    `).run(userKey, now, now);
  }

  #audit(userKey: string, mailboxId: string | null, action: string, result: "PASS" | "FAIL", at: string): void {
    this.#db.prepare("INSERT INTO audit_events (user_key, mailbox_id, action, result, at) VALUES (?, ?, ?, ?, ?)")
      .run(userKey, mailboxId, action, result, at);
  }

  #sendAudit(
    userKey: string,
    operationId: string | null,
    mailboxId: string,
    action: string,
    result: "PASS" | "FAIL",
    state: SendOperationState | null,
    recipientCount: number,
    externalRecipientCount: number,
    reasonCode: string | null,
    at: string,
  ): void {
    this.#db.prepare(`
      INSERT INTO send_audit_events (
        user_key, operation_id, mailbox_id, action, result, state, recipient_count,
        external_recipient_count, reason_code, at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userKey, operationId, mailboxId, action, result, state, recipientCount,
      externalRecipientCount, reasonCode, at,
    );
  }

  #operationId(userKey: string, idempotencyKey: string): string {
    const row = this.#db.prepare(
      "SELECT operation_id FROM send_operations WHERE user_key = ? AND idempotency_key = ?",
    ).get(userKey, idempotencyKey) as { operation_id: string } | undefined;
    if (!row) throw new MailBridgeError("Send operation is missing", "SEND_OPERATION_MISSING");
    return row.operation_id;
  }

  #transaction<T>(operation: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const value = operation();
      this.#db.exec("COMMIT");
      return value;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  #checkpoint(): void {
    if (this.databasePath !== ":memory:") this.#db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }
}

function toView(row: MailboxRow): MailboxView {
  return {
    mailbox_id: row.mailbox_id,
    display_name: row.display_name,
    email: row.email,
    brand: row.brand as MailboxView["brand"],
    purpose: row.purpose,
    imap_host: row.imap_host,
    imap_port: Number(row.imap_port),
    tls_mode: row.tls_mode as MailboxView["tls_mode"],
    send_enabled: Boolean(row.send_enabled),
    send_transport: "smtp",
    smtp_host: row.smtp_host,
    smtp_port: Number(row.smtp_port),
    smtp_tls_mode: row.smtp_tls_mode as MailboxView["smtp_tls_mode"],
    allowed_folders: parseFolders(row.folders_json),
    enabled: Boolean(row.enabled),
    credentials_stored: true,
    connection_status: row.last_health_status as MailboxView["connection_status"],
    last_successful_check: row.last_successful_check,
    last_error_category: row.last_error_category,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseFolders(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) throw new Error("Stored folders are invalid");
  return parsed;
}

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error("Stored string list is invalid");
  }
  return parsed;
}

function uniqueFolders(values: string[]): string[] {
  return [...new Set(values)];
}

function parseEnvelope(value: string): StoredCredentialEnvelope {
  return JSON.parse(value) as StoredCredentialEnvelope;
}

function isEnvelope(value: unknown): value is StoredCredentialEnvelope {
  return Boolean(
    value && typeof value === "object" &&
    (value as { version?: unknown }).version === 1 &&
    (value as { algorithm?: unknown }).algorithm === "AES-256-GCM",
  );
}

function parseSendReceipt(value: unknown): SendReceipt {
  if (!value || typeof value !== "object") throw new Error("Stored send receipt is invalid");
  const receipt = value as Partial<SendReceipt>;
  if (
    typeof receipt.mailbox_id !== "string" || typeof receipt.message_id !== "string" ||
    !Array.isArray(receipt.accepted) || !receipt.accepted.every((item) => typeof item === "string") ||
    !Array.isArray(receipt.rejected) || !receipt.rejected.every((item) => typeof item === "string") ||
    typeof receipt.sent_at !== "string"
  ) throw new Error("Stored send receipt is invalid");
  const sentCopy = receipt.sent_copy;
  if (sentCopy === undefined) {
    receipt.sent_copy = { state: "legacy_untracked", folder: null, attempts: 0, error_code: null };
  } else if (
    !["disabled", "not_applicable", "provider_saved", "imap_appended", "failed", "legacy_untracked"].includes(sentCopy.state) ||
    !(sentCopy.folder === null || typeof sentCopy.folder === "string") ||
    !Number.isSafeInteger(sentCopy.attempts) || sentCopy.attempts < 0 ||
    !(sentCopy.error_code === null || typeof sentCopy.error_code === "string")
  ) throw new Error("Stored Sent-copy receipt is invalid");
  return receipt as SendReceipt;
}

function toSendOperationView(row: SendOperationRow): SendOperationView {
  return {
    operation_id: row.operation_id,
    mailbox_id: row.mailbox_id,
    state: row.state,
    accepted_count: Number(row.accepted_count),
    rejected_count: Number(row.rejected_count),
    created_at: row.created_at,
    updated_at: row.updated_at,
    error_code: row.error_code,
  };
}

function parseDraftPayload(value: unknown): DraftPayload {
  if (!value || typeof value !== "object") throw new Error("Stored draft payload is invalid");
  const draft = value as Partial<DraftPayload>;
  if (
    typeof draft.mailbox_id !== "string" ||
    !Array.isArray(draft.to) || !draft.to.every((item) => typeof item === "string") ||
    !Array.isArray(draft.cc) || !draft.cc.every((item) => typeof item === "string") ||
    !Array.isArray(draft.bcc) || !draft.bcc.every((item) => typeof item === "string") ||
    typeof draft.subject !== "string" || typeof draft.text_body !== "string" ||
    !(draft.in_reply_to === null || typeof draft.in_reply_to === "string") ||
    !Array.isArray(draft.references) || !draft.references.every((item) => typeof item === "string")
  ) throw new Error("Stored draft payload is invalid");
  const attachments = draft.attachments ?? [];
  if (!Array.isArray(attachments) || !attachments.every((item) =>
    item && typeof item === "object" &&
    typeof item.attachment_id === "string" &&
    typeof item.filename === "string" &&
    typeof item.mime_type === "string" &&
    Number.isSafeInteger(item.size) && item.size >= 0 &&
    typeof item.sha256 === "string" &&
    typeof item.content_base64 === "string"
  )) throw new Error("Stored draft attachment payload is invalid");
  return { ...(draft as DraftPayload), attachments };
}
