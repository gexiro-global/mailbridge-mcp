import type { AddressValue, FolderSummary, HealthResult } from "../domain/types.js";

export interface RawAttachment {
  part: string;
  filename: string | null;
  mime_type: string;
  size: number | null;
  disposition: string | null;
  inline: boolean;
}

export interface RawMessageSummary {
  uid: number;
  uid_validity: bigint;
  folder: string;
  from: AddressValue[];
  to: AddressValue[];
  cc: AddressValue[];
  subject: string;
  received_at: string;
  unread: boolean;
  attachments: RawAttachment[];
  snippet: string | null;
  message_id: string | null;
  in_reply_to: string | null;
}

export interface RawMessageDetail extends RawMessageSummary {
  headers: Record<string, string | string[]>;
  text_body: string;
  html_body: string | null;
  references: string[];
  source_truncated: boolean;
}

export interface RawAttachmentContent {
  part: string;
  filename: string | null;
  mime_type: string;
  declared_size: number | null;
  bytes: Buffer;
  truncated: boolean;
}

export interface FolderSearchInput {
  folder: string;
  free_text?: string;
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  after?: Date;
  before?: Date;
  unread_only?: boolean;
  has_attachment?: boolean;
  thread_identifiers?: string[];
  limit: number;
}

export interface ReadOnlyImapAdapter {
  health(): Promise<HealthResult>;
  listFolders(): Promise<FolderSummary[]>;
  discoverFolders(): Promise<FolderSummary[]>;
  search(input: FolderSearchInput): Promise<RawMessageSummary[]>;
  fetch(folder: string, uidValidity: bigint, uid: number, maxBytes: number): Promise<RawMessageDetail>;
  listAttachmentParts(folder: string, uidValidity: bigint, uid: number): Promise<RawAttachment[]>;
  fetchAttachment(folder: string, uidValidity: bigint, uid: number, part: string, maxBytes: number): Promise<RawAttachmentContent>;
  verifyPeekInvariant(folder: string, maxBytes: number): Promise<{
    success: boolean;
    flags_before: string[] | null;
    flags_after: string[] | null;
    unchanged: boolean;
    reason: string;
  }>;
}
