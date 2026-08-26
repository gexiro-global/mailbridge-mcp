import type { FolderSummary } from "../domain/types.js";

export interface CertificateSummary {
  subject: string | null;
  issuer: string | null;
  san: string[];
  valid_to: string | null;
  protocol: string | null;
}

export interface AdminConnectionTestResult {
  mailbox_id: string;
  checked_at: string;
  last_successful_check: string | null;
  status: "PASS" | "FAIL";
  dns_resolution: { success: boolean; address_count: number };
  tcp_connection: { success: boolean; latency_ms: number | null };
  tls_verification: { success: boolean; mode: "implicit" | "starttls"; certificate: CertificateSummary | null };
  authentication: { success: boolean };
  folder_discovery: { success: boolean; count: number; folders: FolderSummary[] };
  body_peek: { success: boolean | null; flags_unchanged: boolean | null; reason: string };
  latency_ms: number;
  error_category: string | null;
}

export interface AdminAuditEvent {
  at: string;
  actor: string;
  mailbox_id: string | null;
  action: string;
  result: "PASS" | "FAIL";
}
