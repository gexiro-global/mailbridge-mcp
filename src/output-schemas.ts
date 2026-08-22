import { z } from "zod";

const addressSchema = z.object({
  name: z.string().optional(),
  address: z.string(),
});

const partialFailureSchema = z.object({
  mailbox_id: z.string().optional(),
  folder: z.string().optional(),
  code: z.string(),
  message: z.string(),
});

const messageSummarySchema = z.object({
  stable_message_id: z.string(),
  mailbox_id: z.string(),
  folder: z.string(),
  from: z.array(addressSchema),
  to: z.array(addressSchema),
  cc: z.array(addressSchema),
  subject: z.string(),
  received_at: z.string(),
  unread: z.boolean(),
  has_attachments: z.boolean(),
  attachment_count: z.number().int().nonnegative(),
  safe_snippet: z.string(),
  untrusted_content_warning: z.string(),
});

const attachmentMetadataSchema = z.object({
  attachment_id: z.string(),
  filename: z.string(),
  mime_type: z.string(),
  declared_size: z.number().int().nonnegative(),
  inline: z.boolean(),
});

export const listMailboxesOutputSchema = z.object({
  mode: z.literal("SYNTHETIC_DEMO"),
  write_operations_available: z.literal(false),
  mailboxes: z.array(z.object({
    mailbox_id: z.string(),
    display_name: z.string(),
    mailbox_email: z.string(),
    brand: z.string(),
    purpose: z.string(),
    enabled: z.boolean(),
    access_mode: z.literal("READ_ONLY"),
    folder_count: z.number().int().nonnegative(),
    message_count: z.number().int().nonnegative(),
  })),
});

export const mailboxHealthOutputSchema = z.object({
  checked_at: z.string(),
  results: z.array(z.object({
    mailbox_id: z.string(),
    connected: z.boolean(),
    tls_verified: z.boolean(),
    authentication_successful: z.boolean(),
    folder_discovery_successful: z.boolean(),
    read_only_verified: z.boolean(),
    mode: z.literal("SYNTHETIC_DEMO"),
  })),
  partial_failures: z.array(partialFailureSchema),
});

export const listFoldersOutputSchema = z.object({
  mailboxes: z.array(z.object({
    mailbox_id: z.string(),
    folders: z.array(z.object({
      folder_id: z.string(),
      display_name: z.string(),
      selectable: z.boolean(),
      message_count: z.number().int().nonnegative(),
      unread_count: z.number().int().nonnegative(),
    })),
  })),
  partial_failures: z.array(partialFailureSchema),
});

export const messagesOutputSchema = z.object({
  messages: z.array(messageSummarySchema),
  partial_failures: z.array(partialFailureSchema),
  truncated: z.boolean(),
});

export const fetchMessageOutputSchema = z.object({
  message: messageSummarySchema.extend({
    headers: z.record(z.string(), z.string()),
    text_body: z.string(),
    message_id: z.string(),
    in_reply_to: z.string().nullable(),
    references: z.array(z.string()),
    attachments: z.array(attachmentMetadataSchema.extend({
      disposition: z.literal("attachment"),
    })),
    source_truncated: z.boolean(),
    read_state_changed: z.literal(false),
  }),
});

export const fetchThreadOutputSchema = z.object({
  messages: z.array(messageSummarySchema),
  confidence: z.literal("HIGH"),
  partial_failures: z.array(partialFailureSchema),
  truncated: z.boolean(),
});

export const listAttachmentsOutputSchema = z.object({
  stable_message_id: z.string(),
  attachments: z.array(attachmentMetadataSchema),
});

export const fetchAttachmentOutputSchema = z.object({
  attachment_id: z.string(),
  filename: z.string(),
  mime_type: z.string(),
  declared_size: z.number().int().nonnegative(),
  returned_bytes: z.number().int().nonnegative(),
  truncated: z.boolean(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  content_base64: z.string(),
  untrusted_content_warning: z.string(),
});
