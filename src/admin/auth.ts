import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

interface Session {
  actor: string;
  csrf: string;
  expiresAt: number;
}

interface StoredPasswordHash {
  salt: Buffer;
  digest: Buffer;
}

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 32;
const PASSWORD_HASH_PREFIX = "scrypt";

export class AdminSessions {
  readonly #sessions = new Map<string, Session>();
  readonly #passwordHash: StoredPasswordHash;

  constructor(
    readonly operatorUsername: string,
    operatorPasswordHash: string,
    readonly sessionKey: string,
    readonly timeoutMs: number,
  ) {
    this.#passwordHash = parsePasswordHash(operatorPasswordHash);
  }

  async verifyCredentials(username: string, password: string): Promise<boolean> {
    const candidatePassword = await derivePassword(password, this.#passwordHash.salt);
    return safeEqual(username, this.operatorUsername, this.sessionKey)
      && timingSafeEqual(candidatePassword, this.#passwordHash.digest);
  }

  create(): { id: string; session: Session } {
    const id = randomBytes(32).toString("base64url");
    const session = { actor: this.operatorUsername, csrf: randomBytes(32).toString("base64url"), expiresAt: Date.now() + this.timeoutMs };
    this.#sessions.set(this.#digest(id), session);
    return { id, session };
  }

  get(id: string | undefined): Session | null {
    if (!id) return null;
    const key = this.#digest(id);
    const session = this.#sessions.get(key);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.#sessions.delete(key);
      return null;
    }
    session.expiresAt = Date.now() + this.timeoutMs;
    return session;
  }

  destroy(id: string | undefined): void {
    if (id) this.#sessions.delete(this.#digest(id));
  }

  #digest(id: string): string {
    return createHmac("sha256", this.sessionKey).update(id).digest("hex");
  }
}

export async function hashAdminPassword(password: string): Promise<string> {
  if (password.length < 16 || password.length > 16 * 1024) {
    throw new Error("Admin password must contain between 16 and 16384 characters");
  }
  const salt = randomBytes(16);
  const digest = await derivePassword(password, salt);
  return [PASSWORD_HASH_PREFIX, SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64url"), digest.toString("base64url")].join("$");
}

export function parseCookies(value: string | undefined): Record<string, string> {
  if (!value) return {};
  return Object.fromEntries(value.split(";").flatMap((part) => {
    const index = part.indexOf("=");
    if (index < 1) return [];
    try {
      return [[part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())]];
    } catch {
      return [];
    }
  }));
}

function safeEqual(candidate: string, expected: string, key: string): boolean {
  const left = createHmac("sha256", key).update(candidate).digest();
  const right = createHmac("sha256", key).update(expected).digest();
  return timingSafeEqual(left, right);
}

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 }, (error, derivedKey) => {
      if (error) rejectPromise(error);
      else resolvePromise(derivedKey);
    });
  });
}

function parsePasswordHash(value: string): StoredPasswordHash {
  const [prefix, n, r, p, encodedSalt, encodedDigest, ...rest] = value.split("$");
  if (
    prefix !== PASSWORD_HASH_PREFIX ||
    n !== String(SCRYPT_N) ||
    r !== String(SCRYPT_R) ||
    p !== String(SCRYPT_P) ||
    rest.length !== 0 ||
    !encodedSalt ||
    !encodedDigest
  ) {
    throw new Error("Admin password secret must contain a supported scrypt hash");
  }
  const salt = Buffer.from(encodedSalt, "base64url");
  const digest = Buffer.from(encodedDigest, "base64url");
  if (salt.length !== 16 || digest.length !== SCRYPT_KEY_LENGTH) {
    throw new Error("Admin password secret must contain a supported scrypt hash");
  }
  return { salt, digest };
}
