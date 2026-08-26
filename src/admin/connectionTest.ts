import { lookup } from "node:dns/promises";
import { connect as connectTcp } from "node:net";
import { connect as connectTls } from "node:tls";
import type { MailBridgeConfig, MailboxConfig } from "../config/schema.js";
import { FileSecretProvider } from "../config/secrets.js";
import { safeError } from "../domain/errors.js";
import { DefaultImapAdapterFactory } from "../imap/factory.js";
import type { CertificateSummary, AdminConnectionTestResult } from "./types.js";

export class AdminConnectionTester {
  constructor(readonly secrets: FileSecretProvider) {}

  async test(config: MailBridgeConfig, mailbox: MailboxConfig): Promise<AdminConnectionTestResult> {
    const started = performance.now();
    const checkedAt = new Date().toISOString();
    const result: AdminConnectionTestResult = {
      mailbox_id: mailbox.id,
      checked_at: checkedAt,
      last_successful_check: null,
      status: "FAIL",
      dns_resolution: { success: false, address_count: 0 },
      tcp_connection: { success: false, latency_ms: null },
      tls_verification: { success: false, mode: mailbox.tls ? "implicit" : "starttls", certificate: null },
      authentication: { success: false },
      folder_discovery: { success: false, count: 0, folders: [] },
      body_peek: { success: null, flags_unchanged: null, reason: "NOT_ATTEMPTED" },
      latency_ms: 0,
      error_category: null,
    };

    try {
      const addresses = await lookup(mailbox.imap_host, { all: true });
      result.dns_resolution = { success: addresses.length > 0, address_count: addresses.length };
      result.tcp_connection = await tcpProbe(mailbox.imap_host, mailbox.imap_port);
      if (!result.tcp_connection.success) throw new Error("TCP_CONNECTION_FAILED");

      if (mailbox.tls) {
        result.tls_verification = {
          success: true,
          mode: "implicit",
          certificate: await tlsProbe(mailbox.imap_host, mailbox.imap_port),
        };
      }

      const adapter = await new DefaultImapAdapterFactory(config, this.secrets).create(mailbox);
      const health = await adapter.health();
      result.authentication.success = health.authentication_successful;
      if (!mailbox.tls) result.tls_verification.success = health.tls_verified;
      if (!health.connected || !health.authentication_successful) {
        result.error_category = health.error_category ?? "IMAP_HEALTH_FAILED";
        return finalize(result, started);
      }

      const folders = await adapter.discoverFolders();
      result.folder_discovery = { success: true, count: folders.length, folders };
      const probeFolder = mailbox.allowed_folders.find((allowed) => folders.some((folder) => folder.folder_id === allowed && folder.selectable));
      if (!probeFolder) {
        result.body_peek = { success: null, flags_unchanged: null, reason: "NO_ALLOWED_SELECTABLE_FOLDER" };
      } else {
        const before = (await adapter.search({ folder: probeFolder, limit: 1 }))[0];
        if (!before) {
          result.body_peek = { success: null, flags_unchanged: null, reason: "NO_MESSAGE_AVAILABLE" };
        } else {
          await adapter.fetch(probeFolder, before.uid_validity, before.uid, Math.min(config.privacy.source_max_bytes, 64 * 1024));
          const after = (await adapter.search({ folder: probeFolder, limit: 10 })).find((message) => message.uid === before.uid);
          const unchanged = Boolean(after && after.unread === before.unread);
          result.body_peek = { success: unchanged, flags_unchanged: unchanged, reason: unchanged ? "FLAGS_UNCHANGED" : "FLAG_STATE_CHANGED_OR_MESSAGE_MISSING" };
        }
      }
      result.status = result.tls_verification.success && result.folder_discovery.success && result.body_peek.success !== false ? "PASS" : "FAIL";
      return finalize(result, started);
    } catch (error) {
      result.error_category = safeError(error).code;
      return finalize(result, started);
    }
  }
}

async function tcpProbe(host: string, port: number): Promise<{ success: boolean; latency_ms: number | null }> {
  const started = performance.now();
  return new Promise((resolve) => {
    const socket = connectTcp({ host, port });
    let settled = false;
    const finish = (success: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ success, latency_ms: Math.round(performance.now() - started) });
    };
    socket.setTimeout(5_000, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function tlsProbe(host: string, port: number): Promise<CertificateSummary> {
  return new Promise((resolve, reject) => {
    const socket = connectTls({ host, port, servername: host, rejectUnauthorized: true, minVersion: "TLSv1.2" });
    socket.setTimeout(7_000, () => socket.destroy(new Error("TLS_TIMEOUT")));
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerX509Certificate();
      const summary: CertificateSummary = {
        subject: certificate?.subject ?? null,
        issuer: certificate?.issuer ?? null,
        san: certificate?.subjectAltName?.split(/,\s*/).slice(0, 64) ?? [],
        valid_to: certificate?.validTo ? new Date(certificate.validTo).toISOString() : null,
        protocol: socket.getProtocol(),
      };
      socket.end();
      resolve(summary);
    });
    socket.once("error", reject);
  });
}

function finalize(result: AdminConnectionTestResult, started: number): AdminConnectionTestResult {
  result.latency_ms = Math.round(performance.now() - started);
  if (result.status !== "PASS") result.status = "FAIL";
  if (result.status === "PASS") result.last_successful_check = result.checked_at;
  return result;
}
