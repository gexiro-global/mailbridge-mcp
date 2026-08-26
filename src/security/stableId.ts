import { createHmac, timingSafeEqual } from "node:crypto";
import { MailBridgeError } from "../domain/errors.js";

interface MessageLocator {
  m: string;
  f: string;
  v: string;
  u: number;
}

export interface DecodedMessageLocator {
  mailbox_id: string;
  folder_id: string;
  uid_validity: bigint;
  uid: number;
}

export class StableIdCodec {
  readonly #key: Buffer;

  constructor(key: Buffer | string) {
    this.#key = Buffer.isBuffer(key) ? Buffer.from(key) : Buffer.from(key, "utf8");
    if (this.#key.byteLength < 32) {
      throw new Error("Stable ID HMAC key must contain at least 32 bytes");
    }
  }

  encode(locator: DecodedMessageLocator): string {
    const payload: MessageLocator = {
      m: locator.mailbox_id,
      f: locator.folder_id,
      v: locator.uid_validity.toString(10),
      u: locator.uid,
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = this.#sign(encoded);
    return `mb1.${encoded}.${signature}`;
  }

  decode(value: string): DecodedMessageLocator {
    const match = /^mb1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(value);
    if (!match?.[1] || !match[2]) {
      throw new MailBridgeError("Invalid message identifier", "INVALID_MESSAGE_ID");
    }
    const expected = Buffer.from(this.#sign(match[1]), "base64url");
    const provided = Buffer.from(match[2], "base64url");
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      throw new MailBridgeError("Invalid message identifier", "INVALID_MESSAGE_ID");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
    } catch {
      throw new MailBridgeError("Invalid message identifier", "INVALID_MESSAGE_ID");
    }
    if (!isLocator(parsed)) {
      throw new MailBridgeError("Invalid message identifier", "INVALID_MESSAGE_ID");
    }
    return {
      mailbox_id: parsed.m,
      folder_id: parsed.f,
      uid_validity: BigInt(parsed.v),
      uid: parsed.u,
    };
  }

  opaqueAttachmentId(stableMessageId: string, part: string): string {
    return `mba1.${this.#sign(`${stableMessageId}\0${part}`)}`;
  }

  #sign(value: string): string {
    return createHmac("sha256", this.#key).update(value, "utf8").digest("base64url");
  }
}

function isLocator(value: unknown): value is MessageLocator {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.m === "string" &&
    candidate.m.length > 0 &&
    candidate.m.length <= 64 &&
    typeof candidate.f === "string" &&
    candidate.f.length > 0 &&
    candidate.f.length <= 512 &&
    typeof candidate.v === "string" &&
    /^\d+$/.test(candidate.v) &&
    typeof candidate.u === "number" &&
    Number.isSafeInteger(candidate.u) &&
    candidate.u > 0
  );
}
