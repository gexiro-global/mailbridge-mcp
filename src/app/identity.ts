import { createHmac } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { MailBridgeConfig } from "../config/schema.js";

export interface OAuthIdentity {
  issuer: string;
  subject: string;
  scopes: string[];
  expires_at: number | null;
}

export interface UserKeyResolver {
  derive(identity: Pick<OAuthIdentity, "issuer" | "subject">): string;
}

export function oauthIdentity(auth: AuthInfo | undefined, config: MailBridgeConfig): OAuthIdentity {
  const subject = auth?.extra?.subject;
  const issuer = auth?.extra?.issuer ?? config.auth.issuer;
  if (typeof subject !== "string" || !subject || typeof issuer !== "string" || !issuer) {
    throw new Error("Verified OAuth issuer and subject are required");
  }
  return {
    issuer,
    subject,
    scopes: auth?.scopes ?? [],
    expires_at: auth?.expiresAt ?? null,
  };
}

export class UserKeyDeriver implements UserKeyResolver {
  readonly #key: Buffer;

  constructor(key: Buffer | string) {
    this.#key = Buffer.isBuffer(key) ? Buffer.from(key) : Buffer.from(key, "utf8");
    if (this.#key.byteLength < 32) throw new Error("User-key HMAC secret must contain at least 32 bytes");
  }

  derive(identity: Pick<OAuthIdentity, "issuer" | "subject">): string {
    const canonical = JSON.stringify([identity.issuer, identity.subject]);
    return createHmac("sha256", this.#key).update(canonical, "utf8").digest("base64url");
  }
}

/**
 * Maps one strictly allowlisted OAuth operator to an existing private storage
 * owner. The value is stored as a secret so an OAuth cutover does not require
 * rewriting credential envelopes whose AEAD AAD already contains user_key.
 */
export class FixedPrivateOwnerUserKeyResolver implements UserKeyResolver {
  readonly #userKey: string;

  constructor(userKey: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(userKey)) {
      throw new Error("Fixed private owner user key must be a SHA-256 base64url value");
    }
    this.#userKey = userKey;
  }

  derive(_identity: Pick<OAuthIdentity, "issuer" | "subject">): string {
    return this.#userKey;
  }
}
