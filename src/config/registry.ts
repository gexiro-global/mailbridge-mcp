import type { MailboxConfig } from "./schema.js";
import { MailBridgeError } from "../domain/errors.js";

export class MailboxRegistry {
  readonly #mailboxes: Map<string, MailboxConfig>;

  constructor(mailboxes: MailboxConfig[]) {
    this.#mailboxes = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));
  }

  list(): MailboxConfig[] {
    return [...this.#mailboxes.values()];
  }

  get(mailboxId: string, requireEnabled = true): MailboxConfig {
    const mailbox = this.#mailboxes.get(mailboxId);
    if (!mailbox) throw new MailBridgeError("Unknown mailbox", "MAILBOX_NOT_FOUND");
    if (requireEnabled && !mailbox.enabled) {
      throw new MailBridgeError("Mailbox is disabled", "MAILBOX_DISABLED");
    }
    return mailbox;
  }

  assertFolderAllowed(mailbox: MailboxConfig, folder: string): void {
    if (mailbox.folder_access === "all_selectable") return;
    if (!mailbox.allowed_folders.includes(folder)) {
      throw new MailBridgeError("Folder is outside the mailbox allowlist", "FOLDER_NOT_ALLOWED");
    }
  }
}
