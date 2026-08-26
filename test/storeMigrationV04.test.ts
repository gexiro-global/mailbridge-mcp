import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { CredentialEnvelopeCipher } from "../src/app/crypto.js";
import { MailboxStore } from "../src/app/store.js";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("v0.4 SQLite migration", () => {
  it("upgrades a v0.3 draft table and reads legacy plaintext receipts without rewriting them", () => {
    const directory = mkdtempSync(join(tmpdir(), "mailbridge-v04-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "legacy.sqlite");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE mail_drafts (
        draft_id TEXT NOT NULL,
        user_key TEXT NOT NULL,
        mailbox_id TEXT NOT NULL,
        encrypted_payload TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sent_at TEXT,
        message_id TEXT,
        PRIMARY KEY (user_key, draft_id)
      );
    `);
    legacy.close();

    const cipher = new CredentialEnvelopeCipher("v1", new Map([["v1", Buffer.alloc(32, 4)]]));
    new MailboxStore(databasePath, cipher).close();

    const migrated = new DatabaseSync(databasePath);
    const draftColumns = migrated.prepare("PRAGMA table_info(mail_drafts)").all() as Array<{ name: string }>;
    const tableNames = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    expect(draftColumns.map((column) => column.name)).toContain("version");
    expect(tableNames.map((table) => table.name)).toEqual(expect.arrayContaining([
      "send_policies", "send_confirmations", "send_operations", "send_rate_events", "send_audit_events",
    ]));
    migrated.prepare("INSERT INTO users (user_key, created_at, updated_at) VALUES (?, ?, ?)")
      .run("legacy-user", "2026-08-25T12:00:00.000Z", "2026-08-25T12:00:00.000Z");
    migrated.prepare(`
      INSERT INTO send_receipts (user_key, idempotency_key, payload_hash, receipt_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      "legacy-user",
      "direct:legacy-receipt",
      "legacy-payload-hash",
      JSON.stringify({
        mailbox_id: "mbx_legacy",
        message_id: "<legacy@example.invalid>",
        accepted: ["recipient@example.invalid"],
        rejected: [],
        sent_at: "2026-08-25T12:00:00.000Z",
      }),
      "2026-08-25T12:00:00.000Z",
    );
    migrated.close();

    const reopened = new MailboxStore(databasePath, cipher);
    expect(reopened.getSendReceipt("legacy-user", "direct:legacy-receipt")).toMatchObject({
      payload_hash: "legacy-payload-hash",
      receipt: { message_id: "<legacy@example.invalid>" },
    });
    reopened.close();
  });
});
