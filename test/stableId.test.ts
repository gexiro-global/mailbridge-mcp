import { describe, expect, it } from "vitest";
import { StableIdCodec } from "../src/security/stableId.js";

const codec = new StableIdCodec("0123456789abcdef0123456789abcdef");
const locator = { mailbox_id: "brand_a", folder_id: "INBOX", uid_validity: 12345n, uid: 6789 };

describe("stable message ids", () => {
  it("round trips all locator fields", () => {
    expect(codec.decode(codec.encode(locator))).toEqual(locator);
  });

  it("is deterministic", () => {
    expect(codec.encode(locator)).toBe(codec.encode(locator));
  });

  it("does not expose a mail URI or system path", () => {
    const id = codec.encode(locator);
    expect(id).not.toContain("mail://");
    expect(id).not.toContain("INBOX");
    expect(id).not.toContain("\\");
  });

  it("rejects a changed signature", () => {
    const id = codec.encode(locator);
    const tampered = `${id.slice(0, -1)}${id.endsWith("A") ? "B" : "A"}`;
    expect(() => codec.decode(tampered)).toThrow(/Invalid message identifier/);
  });

  it("rejects short HMAC keys", () => {
    expect(() => new StableIdCodec("short")).toThrow(/32 bytes/);
  });

  it("creates opaque attachment identifiers", () => {
    expect(codec.opaqueAttachmentId(codec.encode(locator), "2")).toMatch(/^mba1\.[A-Za-z0-9_-]+$/);
  });
});
