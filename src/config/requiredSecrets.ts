import type { MailBridgeConfig } from "./schema.js";

/**
 * Return the complete, de-duplicated set of file-secret references used by a
 * configured MailBridge runtime. Values are never opened or inspected here.
 */
export function requiredSecretReferences(
  config: MailBridgeConfig,
  idKeyReference = process.env.MAILBRIDGE_ID_KEY_FILE ?? "mailbridge_id_hmac_key",
): string[] {
  const references = new Set<string>([idKeyReference]);

  if (config.app.enabled) {
    references.add(config.app.credential_master_key_secret);
    references.add(config.app.user_key_hmac_secret);
    references.add(config.app.message_id_hmac_secret);
    if (config.app.user_key_mode === "fixed_private_owner") {
      references.add(config.app.fixed_owner_user_key_secret);
    }
  }

  if (config.panel.enabled) {
    references.add(config.panel.password_secret);
    references.add(config.panel.session_key_secret);
  }

  for (const mailbox of config.mailboxes) {
    if (!mailbox.enabled) continue;
    references.add(mailbox.username_secret);
    references.add(mailbox.password_secret);
  }

  return [...references].sort((left, right) => left.localeCompare(right));
}
