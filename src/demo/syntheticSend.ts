import type { DraftPayload, SendReceipt } from "../app/types.js";
import type { MailboxConfig } from "../config/schema.js";
import type { MailTransport } from "../send/smtpAdapter.js";

export class SyntheticMailTransport implements MailTransport {
  #sendCount = 0;

  get sendCount(): number {
    return this.#sendCount;
  }

  async send(mailbox: MailboxConfig, payload: DraftPayload, messageId: string): Promise<SendReceipt> {
    if (!mailbox.tags.includes("LOCAL_SYNTHETIC_SAFE_SEND")) {
      throw new Error("Synthetic transport rejected a non-staging mailbox");
    }
    this.#sendCount += 1;
    return {
      mailbox_id: mailbox.id,
      message_id: messageId,
      accepted: [...payload.to, ...payload.cc, ...payload.bcc],
      rejected: [],
      sent_at: new Date().toISOString(),
    };
  }
}
