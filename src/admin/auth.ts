import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

interface Session {
  actor: string;
  csrf: string;
  expiresAt: number;
}

export class AdminSessions {
  readonly #sessions = new Map<string, Session>();

  constructor(
    readonly operatorUsername: string,
    readonly operatorPassword: string,
    readonly sessionKey: string,
    readonly timeoutMs: number,
  ) {}

  verifyCredentials(username: string, password: string): boolean {
    return safeEqual(username, this.operatorUsername, this.sessionKey) && safeEqual(password, this.operatorPassword, this.sessionKey);
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
