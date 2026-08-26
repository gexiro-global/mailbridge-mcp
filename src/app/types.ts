import { z } from "zod";

export const MailboxBrandSchema = z.enum(["GENERAL", "BUSINESS", "PRIVATE", "OTHER"]);
export const TlsModeSchema = z.enum(["implicit", "starttls"]);
export const SendTransportSchema = z.literal("smtp");
export const SendModeSchema = z.enum(["disabled", "draft_only", "direct_allowed"]);
export const ExternalRecipientPolicySchema = z.enum(["allow", "warn", "block"]);

const policyDomain = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .regex(/^(?!.*\.\.)(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/, "A canonical DNS domain is required");

export const SendPolicySchema = z.object({
  send_mode: SendModeSchema.default("draft_only"),
  require_confirmation: z.literal(true).default(true),
  allowed_domains: z.array(policyDomain).max(128).default([]),
  denied_domains: z.array(policyDomain).max(128).default([]),
  max_recipients: z.number().int().min(1).max(50).default(10),
  max_per_hour: z.number().int().min(1).max(500).default(20),
  max_per_day: z.number().int().min(1).max(5000).default(100),
  external_recipients: ExternalRecipientPolicySchema.default("warn"),
  confirmation_ttl_seconds: z.number().int().min(30).max(600).default(180),
}).strict();

const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .regex(/^(?!.*\.\.)(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/, "A public DNS hostname is required");

export const MailboxSettingsSchema = z.object({
  display_name: z.string().trim().min(1).max(160),
  email: z.email(),
  brand: MailboxBrandSchema,
  purpose: z.string().trim().min(1).max(300),
  imap_host: hostname,
  imap_port: z.number().int().min(1).max(65535).default(993),
  tls_mode: TlsModeSchema.default("implicit"),
  allowed_folders: z.array(z.string().trim().min(1).max(512)).min(1).max(100).default(["INBOX"]),
  send_enabled: z.boolean().default(false),
  send_transport: SendTransportSchema.default("smtp"),
  smtp_host: hostname.nullable().default(null),
  smtp_port: z.number().int().min(1).max(65535).default(465),
  smtp_tls_mode: TlsModeSchema.default("implicit"),
  enabled: z.boolean().default(true),
}).strict();

export const CredentialsSchema = z.object({
  username: z.string().min(1).max(512),
  password: z.string().min(1).max(16 * 1024),
}).strict();

export const CreateMailboxRequestSchema = MailboxSettingsSchema.extend(CredentialsSchema.shape);
export const TestMailboxRequestSchema = CreateMailboxRequestSchema.omit({ enabled: true });
export const UpdateMailboxRequestSchema = MailboxSettingsSchema.partial().omit({ enabled: true });
export const ReplaceCredentialsRequestSchema = CredentialsSchema;

export type MailboxSettings = z.infer<typeof MailboxSettingsSchema>;
export type MailboxCredentials = z.infer<typeof CredentialsSchema>;
export type SendPolicyInput = z.infer<typeof SendPolicySchema>;

export interface MailboxView extends MailboxSettings {
  mailbox_id: string;
  credentials_stored: true;
  connection_status: "unknown" | "connected" | "error";
  last_successful_check: string | null;
  last_error_category: string | null;
  created_at: string;
  updated_at: string;
}

export interface CertificateView {
  subject: string | null;
  issuer: string | null;
  san: string[];
  valid_to: string | null;
  protocol: string | null;
}

export interface MailboxConnectionTestResult {
  status: "PASS" | "FAIL";
  dns_resolution: { success: boolean; address_count: number };
  tcp_connection: { success: boolean; latency_ms: number | null };
  tls_verification: { success: boolean; mode: "implicit" | "starttls"; certificate: CertificateView | null };
  authentication: { success: boolean };
  examine: { success: boolean };
  folder_discovery: { success: boolean; folders: Array<{ folder_id: string; special_use: string | null; selectable: boolean }> };
  body_peek: {
    success: boolean;
    flags_before: string[] | null;
    flags_after: string[] | null;
    unchanged: boolean | null;
    reason: string;
  };
  latency_ms: number;
  error_category: string | null;
}

export interface StoredCredentialEnvelope {
  version: 1;
  algorithm: "AES-256-GCM";
  key_version: string;
  payload_iv: string;
  payload_tag: string;
  payload_ciphertext: string;
  wrapped_key_iv: string;
  wrapped_key_tag: string;
  wrapped_key_ciphertext: string;
}

export interface RuntimeMailbox {
  view: MailboxView;
  credentials: MailboxCredentials;
}

export interface DraftPayload {
  mailbox_id: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text_body: string;
  in_reply_to: string | null;
  references: string[];
}

export interface MailDraftView extends DraftPayload {
  draft_id: string;
  version: number;
  status: "draft" | "sent";
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  message_id: string | null;
}

export interface SendReceipt {
  mailbox_id: string;
  message_id: string;
  accepted: string[];
  rejected: string[];
  sent_at: string;
}

export interface SendPolicyView extends SendPolicyInput {
  mailbox_id: string;
  policy_version: number;
  updated_at: string | null;
}

export interface DraftValidation {
  draft_id: string;
  draft_version: number;
  mailbox_id: string;
  policy_version: number;
  blocked: boolean;
  reasons: string[];
  warnings: string[];
  recipient_count: number;
  external_recipient_count: number;
  remaining_hour: number;
  remaining_day: number;
}

export interface SendConfirmationView {
  confirmation_id: string;
  draft_id: string;
  draft_version: number;
  expires_at: string;
  validation: DraftValidation;
}

export type SendOperationState = "submitting" | "smtp_accepted" | "partial_rejected" | "rejected" | "unknown";

export interface SendOperationView {
  operation_id: string;
  mailbox_id: string;
  state: SendOperationState;
  accepted_count: number;
  rejected_count: number;
  created_at: string;
  updated_at: string;
  error_code: string | null;
}

export interface SendAuditEventView {
  event_id: number;
  operation_id: string | null;
  mailbox_id: string;
  action: string;
  result: "PASS" | "FAIL";
  state: SendOperationState | null;
  recipient_count: number;
  external_recipient_count: number;
  reason_code: string | null;
  at: string;
}
