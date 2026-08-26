import type { MailBridgeConfig, MailboxConfig } from "../config/schema.js";
import { FileSecretProvider } from "../config/secrets.js";
import { ImapFlowReadOnlyAdapter } from "./imapFlowAdapter.js";
import type { ReadOnlyImapAdapter } from "./types.js";

export interface SecretReader {
  read(reference: string): Promise<string>;
}

export interface ImapAdapterFactory {
  create(mailbox: MailboxConfig): Promise<ReadOnlyImapAdapter>;
}

export class DefaultImapAdapterFactory implements ImapAdapterFactory {
  constructor(
    readonly config: MailBridgeConfig,
    readonly secrets: SecretReader = new FileSecretProvider(),
  ) {}

  async create(mailbox: MailboxConfig): Promise<ReadOnlyImapAdapter> {
    const [username, password] = await Promise.all([
      this.secrets.read(mailbox.username_secret),
      this.secrets.read(mailbox.password_secret),
    ]);
    return new ImapFlowReadOnlyAdapter(mailbox, username, password, {
      sourceMaxBytes: this.config.privacy.source_max_bytes,
      snippetMaxChars: this.config.privacy.snippet_max_chars,
      attachmentMaxBytes: this.config.privacy.attachment_max_bytes,
    });
  }
}
