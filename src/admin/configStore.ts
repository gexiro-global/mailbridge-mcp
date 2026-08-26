import { copyFile, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { parse, stringify } from "yaml";
import { MailboxConfigSchema, MailBridgeConfigSchema, type MailBridgeConfig, type MailboxConfig } from "../config/schema.js";
import { Semaphore } from "../util/concurrency.js";

export class AdminConfigStore {
  readonly #path: string;
  readonly #lock = new Semaphore(1);

  constructor(path: string) {
    this.#path = resolve(path);
  }

  async load(): Promise<MailBridgeConfig> {
    const raw = await readFile(this.#path, "utf8");
    return MailBridgeConfigSchema.parse(parse(raw));
  }

  async upsert(mailbox: MailboxConfig): Promise<void> {
    const validated = MailboxConfigSchema.parse(mailbox);
    await this.#mutate((config) => {
      const index = config.mailboxes.findIndex((value) => value.id === validated.id);
      if (index >= 0) config.mailboxes[index] = validated;
      else config.mailboxes.push(validated);
    });
  }

  async setEnabled(mailboxId: string, enabled: boolean): Promise<void> {
    await this.#mutate((config) => {
      const mailbox = requiredMailbox(config, mailboxId);
      mailbox.enabled = enabled;
    });
  }

  async setFolders(mailboxId: string, folders: string[]): Promise<void> {
    await this.#mutate((config) => {
      const mailbox = requiredMailbox(config, mailboxId);
      mailbox.allowed_folders = [...new Set(folders.map((value) => value.trim()).filter(Boolean))];
      MailboxConfigSchema.parse(mailbox);
    });
  }

  async #mutate(change: (config: MailBridgeConfig) => void): Promise<void> {
    await this.#lock.use(async () => {
      const current = await this.load();
      change(current);
      const validated = MailBridgeConfigSchema.parse(current);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backup = `${this.#path}.bak.${stamp}`;
      const temporary = `${this.#path}.tmp-${randomBytes(8).toString("hex")}`;
      await copyFile(this.#path, backup);
      try {
        await writeFile(temporary, stringify(validated, { lineWidth: 120 }), { encoding: "utf8", flag: "wx", mode: 0o600 });
        await rename(temporary, this.#path);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    });
  }
}

function requiredMailbox(config: MailBridgeConfig, mailboxId: string): MailboxConfig {
  const mailbox = config.mailboxes.find((value) => value.id === mailboxId);
  if (!mailbox) throw new Error("Unknown mailbox");
  return mailbox;
}
