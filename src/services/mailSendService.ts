import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  DraftPayload,
  DraftAttachment,
  DraftValidation,
  MailDraftView,
  SendAuditEventView,
  SendConfirmationView,
  SendOperationView,
  SendPolicyInput,
  SendPolicyView,
  SendReceipt,
} from "../app/types.js";
import type { MailboxStore } from "../app/store.js";
import { MailBridgeError, safeError } from "../domain/errors.js";
import { addressDomain, evaluateSendPolicy } from "../send/safeSendPolicy.js";
import type { MailTransport } from "../send/smtpAdapter.js";
import type { MailService } from "./mailService.js";

const email = z.email();
const MAX_ATTACHMENT_COUNT = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 18 * 1024 * 1024;
const BLOCKED_ATTACHMENT_EXTENSIONS = new Set([
  "apk", "app", "bat", "cmd", "com", "dmg", "exe", "hta", "img", "iso",
  "jar", "js", "jse", "lnk", "msi", "msp", "pif", "ps1", "scr", "vbs", "vbe", "wsf",
]);
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MIME = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;

export interface ComposeInput {
  mailbox_id: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text_body: string;
}

export interface ReplyInput {
  mailbox_id: string;
  stable_message_id: string;
  text_body: string;
}

export interface DraftAttachmentInput {
  filename: string;
  mime_type: string;
  content_base64: string;
}

export interface SendExecutionResult {
  receipt: SendReceipt;
  operation: SendOperationView;
  replayed: boolean;
}

export class MailSendService {
  constructor(
    readonly userKey: string,
    readonly store: MailboxStore,
    readonly mail: MailService,
    readonly transport: MailTransport,
  ) {}

  createDraft(input: ComposeInput): MailDraftView {
    return this.store.createDraft(this.userKey, this.#compose(input));
  }

  async createReplyDraft(input: ReplyInput): Promise<MailDraftView> {
    return this.store.createDraft(this.userKey, await this.#reply(input));
  }

  getDraft(draftId: string): MailDraftView {
    return this.store.getDraft(this.userKey, draftId);
  }

  updateDraft(draftId: string, expectedVersion: number, input: ComposeInput): MailDraftView {
    const current = this.store.getDraft(this.userKey, draftId);
    if (current.mailbox_id !== input.mailbox_id) throw new MailBridgeError("Draft mailbox cannot be changed", "MAILBOX_MISMATCH");
    const payload = this.store.getDraftPayload(this.userKey, draftId);
    return this.store.updateDraft(
      this.userKey,
      draftId,
      expectedVersion,
      { ...this.#compose(input), attachments: payload.attachments },
    );
  }

  addDraftAttachment(draftId: string, expectedVersion: number, input: DraftAttachmentInput): MailDraftView {
    const draft = this.store.getDraft(this.userKey, draftId);
    if (draft.status !== "draft") throw new MailBridgeError("A sent draft cannot be edited", "DRAFT_ALREADY_SENT");
    if (draft.version !== expectedVersion) throw new MailBridgeError("Draft changed since it was opened", "DRAFT_VERSION_CONFLICT");
    if (draft.attachments.length >= MAX_ATTACHMENT_COUNT) {
      throw new MailBridgeError("Attachment count limit exceeded", "ATTACHMENT_LIMIT_EXCEEDED");
    }
    const attachment = normalizeDraftAttachment(input);
    const total = draft.attachments.reduce((sum, item) => sum + item.size, 0) + attachment.size;
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new MailBridgeError("Total attachment size limit exceeded", "ATTACHMENT_LIMIT_EXCEEDED");
    }
    return this.store.addDraftAttachment(this.userKey, draftId, expectedVersion, attachment);
  }

  removeDraftAttachment(draftId: string, expectedVersion: number, attachmentId: string): MailDraftView {
    return this.store.removeDraftAttachment(this.userKey, draftId, expectedVersion, attachmentId);
  }

  getSendPolicy(mailboxId: string): SendPolicyView {
    this.mail.registry.get(mailboxId);
    return this.store.getSendPolicy(this.userKey, mailboxId);
  }

  updateSendPolicy(mailboxId: string, input: SendPolicyInput): SendPolicyView {
    this.mail.registry.get(mailboxId);
    return this.store.setSendPolicy(this.userKey, mailboxId, input);
  }

  validateDraft(draftId: string): DraftValidation {
    const draft = this.store.getDraft(this.userKey, draftId);
    if (draft.status !== "draft") throw new MailBridgeError("Draft has already been sent", "DRAFT_ALREADY_SENT");
    return this.#validate(draftId, draft.version, this.store.getDraftPayload(this.userKey, draftId));
  }

  prepareDraftSend(draftId: string): SendConfirmationView {
    const draft = this.store.getDraft(this.userKey, draftId);
    const payload = this.store.getDraftPayload(this.userKey, draftId);
    const validation = this.validateDraft(draftId);
    if (validation.blocked) throw new MailBridgeError(`Draft is blocked: ${validation.reasons.join(", ")}`, "SEND_POLICY_BLOCKED");
    const policy = this.getSendPolicy(draft.mailbox_id);
    return this.store.createSendConfirmation(
      this.userKey,
      draftId,
      hashPayload(payload),
      validation,
      policy.confirmation_ttl_seconds,
    );
  }

  async sendDraft(
    draftId: string,
    confirmationId?: string,
    expectedVersion?: number,
  ): Promise<{ draft: MailDraftView } & SendExecutionResult> {
    const draft = this.store.getDraft(this.userKey, draftId);
    const payload = this.store.getDraftPayload(this.userKey, draftId);
    const key = `draft:${draftId}`;
    const payloadHash = hashPayload(payload);
    const previous = this.store.getSendReceipt(this.userKey, key);
    if (previous) {
      if (previous.payload_hash !== payloadHash) throw new MailBridgeError("Draft payload changed after send", "IDEMPOTENCY_CONFLICT");
      return {
        draft,
        receipt: previous.receipt,
        operation: this.store.getSendOperationByKey(this.userKey, key) ?? legacyOperation(draft.mailbox_id, key, previous.receipt),
        replayed: true,
      };
    }
    if (draft.status !== "draft") throw new MailBridgeError("Draft has already been sent", "DRAFT_ALREADY_SENT");
    const policy = this.getSendPolicy(draft.mailbox_id);
    const validation = this.#validate(draftId, draft.version, payload);
    if (validation.blocked) throw new MailBridgeError(`Draft is blocked: ${validation.reasons.join(", ")}`, "SEND_POLICY_BLOCKED");
    if (policy.require_confirmation) {
      if (!confirmationId || expectedVersion === undefined) {
        throw new MailBridgeError("Prepare and explicitly confirm this draft before sending", "SEND_CONFIRMATION_REQUIRED");
      }
      if (expectedVersion !== draft.version) throw new MailBridgeError("Draft changed after it was presented", "DRAFT_VERSION_CONFLICT");
      this.store.consumeSendConfirmation(
        this.userKey, confirmationId, draftId, expectedVersion, payloadHash, policy.policy_version,
      );
    }
    const sent = await this.#sendOnce(payload, key, policy, validation);
    return {
      draft: sent.receipt.accepted.length > 0 ? this.store.markDraftSent(this.userKey, draftId, sent.receipt) : draft,
      ...sent,
    };
  }

  async sendEmail(input: ComposeInput, idempotencyKey: string): Promise<SendExecutionResult> {
    return this.#sendDirect(this.#compose(input), idempotencyKey);
  }

  async replyEmail(input: ReplyInput, idempotencyKey: string): Promise<SendExecutionResult> {
    return this.#sendDirect(await this.#reply(input), idempotencyKey);
  }

  getSendStatus(operationId: string): SendOperationView {
    return this.store.getSendOperation(this.userKey, operationId);
  }

  listSendAudit(limit = 50): SendAuditEventView[] {
    return this.store.listSendAudit(this.userKey, limit);
  }

  async #sendDirect(payload: DraftPayload, idempotencyKey: string): Promise<SendExecutionResult> {
    const key = `direct:${idempotencyKey}`;
    const payloadHash = hashPayload(payload);
    const previous = this.store.getSendReceipt(this.userKey, key);
    if (previous) {
      if (previous.payload_hash !== payloadHash) throw new MailBridgeError("Idempotency key was reused for different content", "IDEMPOTENCY_CONFLICT");
      return {
        receipt: previous.receipt,
        operation: this.store.getSendOperationByKey(this.userKey, key) ?? legacyOperation(payload.mailbox_id, key, previous.receipt),
        replayed: true,
      };
    }
    const policy = this.getSendPolicy(payload.mailbox_id);
    if (policy.send_mode !== "direct_allowed") {
      throw new MailBridgeError("This mailbox requires the draft preview and confirmation flow", "DRAFT_CONFIRMATION_REQUIRED");
    }
    const validation = this.#validate("direct", 0, payload);
    if (validation.blocked) throw new MailBridgeError(`Message is blocked: ${validation.reasons.join(", ")}`, "SEND_POLICY_BLOCKED");
    return this.#sendOnce(payload, key, policy, validation);
  }

  async #sendOnce(
    payload: DraftPayload,
    key: string,
    policy: SendPolicyView,
    validation: DraftValidation,
  ): Promise<SendExecutionResult> {
    const payloadHash = hashPayload(payload);
    const reservation = this.store.reserveSendOperation(
      this.userKey, key, payload.mailbox_id, payloadHash, policy,
      validation.recipient_count, validation.external_recipient_count,
    );
    if (reservation.replayed && reservation.receipt) {
      return { receipt: reservation.receipt, operation: reservation.operation, replayed: true };
    }
    try {
      const receipt = await this.#deliver(payload, deterministicMessageId(this.userKey, key, this.#domain(payload.mailbox_id)));
      const operation = this.store.completeSendOperation(
        this.userKey, key, receipt, validation.recipient_count, validation.external_recipient_count,
      );
      return { receipt, operation, replayed: false };
    } catch (error) {
      const failure = safeError(error);
      try {
        this.store.markSendOperationUnknown(
          this.userKey, key, failure.code, validation.recipient_count, validation.external_recipient_count,
        );
      } catch {
        // The original SMTP uncertainty remains the only safe error to expose.
      }
      throw new MailBridgeError("SMTP outcome is unknown; automatic retry is blocked to prevent duplicates", "SEND_STATUS_UNKNOWN");
    }
  }

  #validate(draftId: string, draftVersion: number, payload: DraftPayload): DraftValidation {
    const mailbox = this.mail.registry.get(payload.mailbox_id);
    if (!mailbox.send_enabled) throw new MailBridgeError("Sending is disabled for this mailbox", "SEND_NOT_CONFIGURED");
    const policy = this.getSendPolicy(payload.mailbox_id);
    return evaluateSendPolicy(
      mailbox.email,
      draftId,
      draftVersion,
      payload,
      policy,
      this.store.sendUsage(this.userKey, payload.mailbox_id),
    );
  }

  async #deliver(payload: DraftPayload, messageId: string): Promise<SendReceipt> {
    const mailbox = this.mail.registry.get(payload.mailbox_id);
    if (!mailbox.send_enabled) throw new MailBridgeError("Sending is disabled for this mailbox", "SEND_NOT_CONFIGURED");
    return this.transport.send(mailbox, payload, messageId);
  }

  #compose(input: ComposeInput): DraftPayload {
    this.mail.registry.get(input.mailbox_id);
    const to = addresses(input.to);
    const cc = addresses(input.cc ?? []);
    const bcc = addresses(input.bcc ?? []);
    if (to.length + cc.length + bcc.length === 0) throw new MailBridgeError("At least one recipient is required", "INVALID_ARGUMENT");
    if (to.length + cc.length + bcc.length > 50) throw new MailBridgeError("Recipient limit exceeded", "INVALID_ARGUMENT");
    return {
      mailbox_id: input.mailbox_id,
      to,
      cc,
      bcc,
      subject: headerValue(input.subject, "subject", 998),
      text_body: bodyValue(input.text_body),
      in_reply_to: null,
      references: [],
      attachments: [],
    };
  }

  async #reply(input: ReplyInput): Promise<DraftPayload> {
    const mailbox = this.mail.registry.get(input.mailbox_id);
    const original = await this.mail.fetchMessage(input.stable_message_id, { include_html: false, max_body_chars: 2_000 });
    if (original.mailbox_id !== mailbox.id) throw new MailBridgeError("Reply source belongs to another mailbox", "MAILBOX_MISMATCH");
    if (!original.message_id) throw new MailBridgeError("Original message has no Message-ID", "THREADING_HEADERS_MISSING");
    const replyTo = replyAddress(original.headers["reply-to"] ?? original.headers["Reply-To"], original.from);
    const references = unique([...original.references, original.message_id]).slice(-50);
    return {
      mailbox_id: mailbox.id,
      to: [replyTo],
      cc: [],
      bcc: [],
      subject: /^\s*re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`,
      text_body: bodyValue(input.text_body),
      in_reply_to: original.message_id,
      references,
      attachments: [],
    };
  }

  #domain(mailboxId: string): string {
    return addressDomain(this.mail.registry.get(mailboxId).email);
  }
}

function addresses(values: string[]): string[] {
  return unique(values.map((value) => value.trim().toLowerCase()).filter(Boolean).map((value) => email.parse(value)));
}

function headerValue(value: string, label: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\r\n]/.test(normalized)) {
    throw new MailBridgeError(`Invalid ${label}`, "INVALID_ARGUMENT");
  }
  return normalized;
}

function bodyValue(value: string): string {
  if (!value.trim() || value.length > 200_000) throw new MailBridgeError("Email body is empty or too large", "INVALID_ARGUMENT");
  return value;
}

function replyAddress(value: string | string[] | undefined, from: Array<{ address?: string }>): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw) {
    const bracketed = /<([^<>]+)>/.exec(raw)?.[1];
    const candidate = (bracketed ?? raw.split(",")[0] ?? "").trim();
    const parsed = email.safeParse(candidate);
    if (parsed.success) return parsed.data.toLowerCase();
  }
  const fallback = from.find((entry) => entry.address)?.address;
  if (!fallback) throw new MailBridgeError("Original message has no reply address", "REPLY_ADDRESS_MISSING");
  return email.parse(fallback).toLowerCase();
}

function deterministicMessageId(userKey: string, key: string, domain: string): string {
  const local = createHash("sha256").update(JSON.stringify(["mailbridge-send-v1", userKey, key]), "utf8").digest("hex").slice(0, 40);
  return `<${local}@${domain}>`;
}

function hashPayload(payload: DraftPayload): string {
  return createHash("sha256").update(JSON.stringify({
    mailbox_id: payload.mailbox_id,
    to: payload.to,
    cc: payload.cc,
    bcc: payload.bcc,
    subject: payload.subject,
    text_body: payload.text_body,
    in_reply_to: payload.in_reply_to,
    references: payload.references,
    attachments: payload.attachments.map(({ attachment_id, filename, mime_type, size, sha256 }) => ({
      attachment_id, filename, mime_type, size, sha256,
    })),
  }), "utf8").digest("hex");
}

function normalizeDraftAttachment(input: DraftAttachmentInput): DraftAttachment {
  const filename = input.filename.normalize("NFC").trim();
  if (
    !filename || filename.length > 255 || filename === "." || filename === ".." ||
    /[\u0000-\u001f\u007f/\\]/.test(filename)
  ) throw new MailBridgeError("Invalid attachment filename", "INVALID_ATTACHMENT");
  const extension = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  if (BLOCKED_ATTACHMENT_EXTENSIONS.has(extension)) {
    throw new MailBridgeError("Executable attachment types are blocked", "ATTACHMENT_TYPE_BLOCKED");
  }
  const mimeType = input.mime_type.trim().toLowerCase();
  if (!MIME.test(mimeType) || mimeType.length > 127) {
    throw new MailBridgeError("Invalid attachment MIME type", "INVALID_ATTACHMENT");
  }
  if (
    !input.content_base64 || input.content_base64.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 4 ||
    !BASE64.test(input.content_base64)
  ) throw new MailBridgeError("Attachment content is not valid bounded base64", "INVALID_ATTACHMENT");
  const bytes = Buffer.from(input.content_base64, "base64");
  try {
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new MailBridgeError("Attachment size limit exceeded", "ATTACHMENT_LIMIT_EXCEEDED");
    }
    return {
      attachment_id: `datt_${randomUUID().replaceAll("-", "")}`,
      filename,
      mime_type: mimeType,
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      content_base64: bytes.toString("base64"),
    };
  } finally {
    bytes.fill(0);
  }
}

function legacyOperation(mailboxId: string, key: string, receipt: SendReceipt): SendOperationView {
  const accepted = receipt.accepted.length;
  const rejected = receipt.rejected.length;
  return {
    operation_id: `legacy_${createHash("sha256").update(key).digest("hex").slice(0, 32)}`,
    mailbox_id: mailboxId,
    state: accepted === 0 ? "rejected" : rejected > 0 ? "partial_rejected" : "smtp_accepted",
    accepted_count: accepted,
    rejected_count: rejected,
    created_at: receipt.sent_at,
    updated_at: receipt.sent_at,
    error_code: null,
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
