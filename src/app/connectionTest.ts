import { connect as connectTcp } from "node:net";
import { connect as connectTls } from "node:tls";
import type { MailBridgeConfig, MailboxConfig } from "../config/schema.js";
import { safeError } from "../domain/errors.js";
import { DefaultImapAdapterFactory, type SecretReader } from "../imap/factory.js";
import type { MailboxConnectionTestResult, MailboxCredentials, MailboxSettings } from "./types.js";
import { resolvePublicEndpoint } from "../security/networkPolicy.js";

export interface MailboxConnectionTester {
  test(settings: MailboxSettings, credentials: MailboxCredentials): Promise<MailboxConnectionTestResult>;
}

export class DirectMailboxConnectionTester implements MailboxConnectionTester {
  constructor(readonly baseConfig: MailBridgeConfig) {}

  async test(settings: MailboxSettings, credentials: MailboxCredentials): Promise<MailboxConnectionTestResult> {
    const started = performance.now();
    const result = emptyResult(settings.tls_mode);
    try {
      const endpoint = await resolvePublicEndpoint(settings.imap_host);
      result.dns_resolution = { success: true, address_count: endpoint.address_count };
      result.tcp_connection = await tcpProbe(endpoint.address, settings.imap_port);
      if (!result.tcp_connection.success) throw new Error("TCP_CONNECTION_FAILED");

      if (settings.tls_mode === "implicit") {
        result.tls_verification = {
          success: true,
          mode: "implicit",
          certificate: await tlsProbe(endpoint.hostname, endpoint.address, settings.imap_port),
        };
      }

      const mailbox = runtimeConfig(settings);
      const reader: SecretReader = {
        read: async (reference) => reference === "runtime_username" ? credentials.username : credentials.password,
      };
      const config = structuredClone(this.baseConfig);
      config.mailboxes = [mailbox];
      const adapter = await new DefaultImapAdapterFactory(config, reader).create(mailbox);
      const health = await adapter.health();
      result.authentication.success = health.authentication_successful;
      if (settings.tls_mode === "starttls") result.tls_verification.success = health.tls_verified;
      if (!health.connected || !health.authentication_successful || !result.tls_verification.success) {
        result.error_category = health.error_category ?? "IMAP_HEALTH_FAILED";
        return finalize(result, started);
      }

      const folders = await adapter.discoverFolders();
      result.folder_discovery = {
        success: true,
        folders: folders.slice(0, 100).map((folder) => ({
          folder_id: folder.folder_id,
          special_use: folder.special_use,
          selectable: folder.selectable,
        })),
      };
      const probeFolder = settings.allowed_folders.find((allowed) =>
        folders.some((folder) => folder.folder_id === allowed && folder.selectable),
      );
      if (!probeFolder) throw new Error("NO_ALLOWED_SELECTABLE_FOLDER");
      const invariant = await adapter.verifyPeekInvariant(probeFolder, Math.min(this.baseConfig.privacy.source_max_bytes, 64 * 1024));
      result.examine.success = true;
      result.body_peek = invariant;
      result.status = invariant.success && invariant.unchanged ? "PASS" : "FAIL";
      return finalize(result, started);
    } catch (error) {
      result.error_category = safeError(error).code;
      return finalize(result, started);
    }
  }
}

function runtimeConfig(settings: MailboxSettings): MailboxConfig {
  return {
    id: "connection_test",
    display_name: settings.display_name,
    email: settings.email,
    brand: settings.brand,
    purpose: settings.purpose,
    imap_host: settings.imap_host,
    imap_port: settings.imap_port,
    tls: settings.tls_mode === "implicit",
    username_secret: "runtime_username",
    password_secret: "runtime_password",
    send_enabled: settings.send_enabled,
    send_transport: settings.send_transport,
    smtp_host: settings.smtp_host,
    smtp_port: settings.smtp_port,
    smtp_tls_mode: settings.smtp_tls_mode,
    enabled: false,
    folder_access: "allowlist",
    allowed_folders: settings.allowed_folders,
    result_limit: 50,
    tags: [],
    brand_hints: { organisation_names: [], domains: [], private: settings.brand === "PRIVATE" },
  };
}

function emptyResult(mode: "implicit" | "starttls"): MailboxConnectionTestResult {
  return {
    status: "FAIL",
    dns_resolution: { success: false, address_count: 0 },
    tcp_connection: { success: false, latency_ms: null },
    tls_verification: { success: false, mode, certificate: null },
    authentication: { success: false },
    examine: { success: false },
    folder_discovery: { success: false, folders: [] },
    body_peek: { success: false, flags_before: null, flags_after: null, unchanged: null, reason: "NOT_ATTEMPTED" },
    latency_ms: 0,
    error_category: null,
  };
}

async function tcpProbe(address: string, port: number): Promise<{ success: boolean; latency_ms: number | null }> {
  const started = performance.now();
  return new Promise((resolve) => {
    const socket = connectTcp({ host: address, port });
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

async function tlsProbe(hostname: string, address: string, port: number) {
  return new Promise<MailboxConnectionTestResult["tls_verification"]["certificate"]>((resolve, reject) => {
    const socket = connectTls({ host: address, port, servername: hostname, rejectUnauthorized: true, minVersion: "TLSv1.2" });
    socket.setTimeout(7_000, () => socket.destroy(new Error("TLS_TIMEOUT")));
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerX509Certificate();
      const value = {
        subject: certificate?.subject ?? null,
        issuer: certificate?.issuer ?? null,
        san: certificate?.subjectAltName?.split(/,\s*/).slice(0, 64) ?? [],
        valid_to: certificate?.validTo ? new Date(certificate.validTo).toISOString() : null,
        protocol: socket.getProtocol(),
      };
      socket.end();
      resolve(value);
    });
    socket.once("error", reject);
  });
}

function finalize(result: MailboxConnectionTestResult, started: number): MailboxConnectionTestResult {
  result.latency_ms = Math.round(performance.now() - started);
  if (result.status !== "PASS") result.status = "FAIL";
  return result;
}
