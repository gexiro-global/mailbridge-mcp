import { loadConfig } from "./config/load.js";
import { FileSecretProvider } from "./config/secrets.js";
import { DefaultImapAdapterFactory } from "./imap/factory.js";
import { StableIdCodec } from "./security/stableId.js";
import { MailService } from "./services/mailService.js";

export async function bootstrap(configPath?: string): Promise<MailService> {
  const config = await loadConfig(configPath);
  const secrets = new FileSecretProvider();
  const keyReference = process.env.MAILBRIDGE_ID_KEY_FILE ?? "mailbridge_id_hmac_key";
  const key = await secrets.read(keyReference);
  const ids = new StableIdCodec(key);
  const adapters = new DefaultImapAdapterFactory(config, secrets);
  return new MailService(config, adapters, ids);
}
