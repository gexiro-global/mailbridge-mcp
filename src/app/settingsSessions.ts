import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface IssuedSettingsSession {
  token: string;
  csrf: string;
  expires_at: string;
}

interface StoredSession {
  user_key: string;
  csrf_hash: Buffer;
  expires_at_ms: number;
}

export class OneTimeSettingsSessions {
  readonly #sessions = new Map<string, StoredSession>();

  constructor(readonly ttlMs: number) {
    if (ttlMs < 30_000 || ttlMs > 10 * 60_000) throw new Error("Settings-session TTL is outside the safe range");
  }

  issue(userKey: string, oauthExpiresAtSeconds: number | null = null): IssuedSettingsSession {
    this.#prune();
    const token = randomBytes(32).toString("base64url");
    const csrf = randomBytes(24).toString("base64url");
    const oauthExpiryMs = oauthExpiresAtSeconds ? oauthExpiresAtSeconds * 1000 : Number.POSITIVE_INFINITY;
    const expiresAtMs = Math.min(Date.now() + this.ttlMs, oauthExpiryMs);
    if (expiresAtMs <= Date.now()) throw new Error("OAuth session has expired");
    this.#sessions.set(hashText(token).toString("base64url"), {
      user_key: userKey,
      csrf_hash: hashText(csrf),
      expires_at_ms: expiresAtMs,
    });
    return { token, csrf, expires_at: new Date(expiresAtMs).toISOString() };
  }

  consume(token: string, csrf: string): { user_key: string; expires_at_ms: number } {
    if (!token || !csrf || token.length > 256 || csrf.length > 256) throw new Error("Invalid settings authorization");
    const key = hashText(token).toString("base64url");
    const stored = this.#sessions.get(key);
    this.#sessions.delete(key);
    if (!stored || stored.expires_at_ms <= Date.now()) throw new Error("Settings authorization expired or already used");
    const candidate = hashText(csrf);
    if (candidate.byteLength !== stored.csrf_hash.byteLength || !timingSafeEqual(candidate, stored.csrf_hash)) {
      throw new Error("Invalid CSRF token");
    }
    return { user_key: stored.user_key, expires_at_ms: stored.expires_at_ms };
  }

  revokeUser(userKey: string): void {
    for (const [key, value] of this.#sessions) {
      if (value.user_key === userKey) this.#sessions.delete(key);
    }
  }

  get size(): number {
    this.#prune();
    return this.#sessions.size;
  }

  #prune(): void {
    const now = Date.now();
    for (const [key, value] of this.#sessions) if (value.expires_at_ms <= now) this.#sessions.delete(key);
  }
}

function hashText(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
