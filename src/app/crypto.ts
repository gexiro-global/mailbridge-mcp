import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { MailboxCredentials, StoredCredentialEnvelope } from "./types.js";

interface CipherBlob {
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

type EnvelopeNamespace = "credential-v1" | "draft-v1" | "send-receipt-v1";

export class CredentialEnvelopeCipher {
  readonly #keys: Map<string, Buffer>;

  constructor(
    readonly currentKeyVersion: string,
    keys: ReadonlyMap<string, Buffer>,
  ) {
    this.#keys = new Map([...keys].map(([version, key]) => [version, Buffer.from(key)]));
    if (!this.#keys.has(currentKeyVersion)) throw new Error("Current credential master key is missing");
    for (const key of this.#keys.values()) {
      if (key.byteLength !== 32) throw new Error("AES-256-GCM master keys must be exactly 32 bytes");
    }
  }

  encrypt(userKey: string, mailboxId: string, credentials: MailboxCredentials): StoredCredentialEnvelope {
    return this.encryptJson(userKey, mailboxId, "credential-v1", credentials);
  }

  encryptJson(
    userKey: string,
    entityId: string,
    namespace: EnvelopeNamespace,
    value: object,
  ): StoredCredentialEnvelope {
    const dataKey = randomBytes(32);
    try {
      const payload = Buffer.from(JSON.stringify(value), "utf8");
      const encryptedPayload = encryptAesGcm(dataKey, payload, payloadAad(namespace, userKey, entityId));
      const masterKey = this.#keys.get(this.currentKeyVersion)!;
      const wrappedKey = encryptAesGcm(masterKey, dataKey, keyAad(namespace, userKey, entityId));
      return {
        version: 1,
        algorithm: "AES-256-GCM",
        key_version: this.currentKeyVersion,
        payload_iv: encryptedPayload.iv.toString("base64url"),
        payload_tag: encryptedPayload.tag.toString("base64url"),
        payload_ciphertext: encryptedPayload.ciphertext.toString("base64url"),
        wrapped_key_iv: wrappedKey.iv.toString("base64url"),
        wrapped_key_tag: wrappedKey.tag.toString("base64url"),
        wrapped_key_ciphertext: wrappedKey.ciphertext.toString("base64url"),
      };
    } finally {
      dataKey.fill(0);
    }
  }

  decrypt(userKey: string, mailboxId: string, envelope: StoredCredentialEnvelope): MailboxCredentials {
    const parsed = this.decryptJson(userKey, mailboxId, "credential-v1", envelope);
    if (!parsed || typeof parsed !== "object" || typeof (parsed as { username?: unknown }).username !== "string" || typeof (parsed as { password?: unknown }).password !== "string") {
      throw new Error("Credential payload is invalid");
    }
    return { username: (parsed as { username: string }).username, password: (parsed as { password: string }).password };
  }

  decryptJson(
    userKey: string,
    entityId: string,
    namespace: EnvelopeNamespace,
    envelope: StoredCredentialEnvelope,
  ): unknown {
    if (envelope.version !== 1 || envelope.algorithm !== "AES-256-GCM") throw new Error("Unsupported credential envelope");
    const masterKey = this.#keys.get(envelope.key_version);
    if (!masterKey) throw new Error("Credential key version is unavailable");
    const dataKey = decryptAesGcm(masterKey, fromWrapped(envelope), keyAad(namespace, userKey, entityId));
    try {
      const plaintext = decryptAesGcm(dataKey, fromPayload(envelope), payloadAad(namespace, userKey, entityId));
      try {
        return JSON.parse(plaintext.toString("utf8")) as unknown;
      } finally {
        plaintext.fill(0);
      }
    } finally {
      dataKey.fill(0);
    }
  }

  rewrap(userKey: string, mailboxId: string, envelope: StoredCredentialEnvelope): StoredCredentialEnvelope {
    const credentials = this.decrypt(userKey, mailboxId, envelope);
    try {
      return this.encrypt(userKey, mailboxId, credentials);
    } finally {
      credentials.username = "";
      credentials.password = "";
    }
  }
}

function encryptAesGcm(key: Buffer, plaintext: Buffer, aad: Buffer): CipherBlob {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

function decryptAesGcm(key: Buffer, blob: CipherBlob, aad: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, blob.iv, { authTagLength: 16 });
  decipher.setAAD(aad);
  decipher.setAuthTag(blob.tag);
  return Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]);
}

function payloadAad(namespace: EnvelopeNamespace, userKey: string, entityId: string): Buffer {
  return Buffer.from(JSON.stringify([`mailbridge-${namespace}`, userKey, entityId]), "utf8");
}

function keyAad(namespace: EnvelopeNamespace, userKey: string, entityId: string): Buffer {
  const label = namespace === "credential-v1"
    ? "mailbridge-wrapped-dek-v1"
    : namespace === "draft-v1"
      ? "mailbridge-draft-wrapped-dek-v1"
      : "mailbridge-send-receipt-wrapped-dek-v1";
  return Buffer.from(JSON.stringify([label, userKey, entityId]), "utf8");
}

function fromPayload(value: StoredCredentialEnvelope): CipherBlob {
  return {
    iv: Buffer.from(value.payload_iv, "base64url"),
    tag: Buffer.from(value.payload_tag, "base64url"),
    ciphertext: Buffer.from(value.payload_ciphertext, "base64url"),
  };
}

function fromWrapped(value: StoredCredentialEnvelope): CipherBlob {
  return {
    iv: Buffer.from(value.wrapped_key_iv, "base64url"),
    tag: Buffer.from(value.wrapped_key_tag, "base64url"),
    ciphertext: Buffer.from(value.wrapped_key_ciphertext, "base64url"),
  };
}
