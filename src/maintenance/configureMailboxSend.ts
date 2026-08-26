#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";

const options = parseArgs(process.argv.slice(2));
const db = new DatabaseSync(options.database);
try {
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  ensureColumn(db, "send_enabled", "INTEGER NOT NULL DEFAULT 0 CHECK (send_enabled IN (0, 1))");
  ensureColumn(db, "send_transport", "TEXT NOT NULL DEFAULT 'smtp' CHECK (send_transport = 'smtp')");
  ensureColumn(db, "smtp_host", "TEXT");
  ensureColumn(db, "smtp_port", "INTEGER NOT NULL DEFAULT 465");
  ensureColumn(db, "smtp_tls_mode", "TEXT NOT NULL DEFAULT 'implicit' CHECK (smtp_tls_mode IN ('implicit', 'starttls'))");
  const rows = db.prepare("SELECT user_key FROM mailboxes WHERE mailbox_id = ?").all(options.mailboxId) as Array<{ user_key: string }>;
  if (rows.length !== 1) throw new Error("Expected exactly one matching mailbox");
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE mailboxes SET send_enabled = 1, send_transport = 'smtp', smtp_host = ?, smtp_port = ?, smtp_tls_mode = ?, updated_at = ?
      WHERE mailbox_id = ?
    `).run(options.smtpHost, options.smtpPort, options.smtpTlsMode, now, options.mailboxId);
    db.prepare("INSERT INTO audit_events (user_key, mailbox_id, action, result, at) VALUES (?, ?, 'MAIL_SEND_ENABLED', 'PASS', ?)")
      .run(rows[0]!.user_key, options.mailboxId, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  process.stdout.write(JSON.stringify({ configured: true, mailbox_id: options.mailboxId, send_enabled: true }) + "\n");
} finally {
  db.close();
}

function ensureColumn(db: DatabaseSync, column: string, definition: string): void {
  const columns = db.prepare("PRAGMA table_info(mailboxes)").all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) db.exec(`ALTER TABLE mailboxes ADD COLUMN ${column} ${definition}`);
}

function parseArgs(values: string[]): { database: string; mailboxId: string; smtpHost: string; smtpPort: number; smtpTlsMode: "implicit" | "starttls" } {
  const value = (name: string): string => {
    const index = values.indexOf(name);
    const result = index >= 0 ? values[index + 1] : undefined;
    if (!result) throw new Error(`${name} is required`);
    return result;
  };
  const database = value("--database");
  const mailboxId = value("--mailbox-id");
  const smtpHost = value("--smtp-host").toLowerCase();
  const smtpPort = Number(value("--smtp-port"));
  const smtpTlsMode = value("--smtp-tls-mode");
  if (!/^mbx_[a-z0-9_-]{3,64}$/.test(mailboxId)) throw new Error("Invalid mailbox id");
  if (!/^(?!.*\.\.)(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(smtpHost)) throw new Error("Invalid SMTP hostname");
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) throw new Error("Invalid SMTP port");
  if (smtpTlsMode !== "implicit" && smtpTlsMode !== "starttls") throw new Error("Invalid SMTP TLS mode");
  return { database, mailboxId, smtpHost, smtpPort, smtpTlsMode };
}
