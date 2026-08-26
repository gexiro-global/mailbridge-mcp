import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AdminAuditEvent } from "./types.js";

export class AdminAuditStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = resolve(path);
  }

  async append(event: Omit<AdminAuditEvent, "at">): Promise<void> {
    const safe: AdminAuditEvent = {
      at: new Date().toISOString(),
      actor: bounded(event.actor, 64),
      mailbox_id: event.mailbox_id ? bounded(event.mailbox_id, 64) : null,
      action: bounded(event.action, 80),
      result: event.result,
    };
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    await appendFile(this.#path, `${JSON.stringify(safe)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  async recent(limit = 200, retentionDays = 30): Promise<AdminAuditEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.#path, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    return raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        const value = JSON.parse(line) as AdminAuditEvent;
        return Date.parse(value.at) >= cutoff ? [value] : [];
      } catch {
        return [];
      }
    }).slice(-limit).reverse();
  }
}

function bounded(value: string, max: number): string {
  return value.replace(/[\r\n\t]/g, " ").slice(0, max);
}
