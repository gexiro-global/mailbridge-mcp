import { describe, expect, it } from "vitest";
import { MailBridgeError } from "../src/domain/errors.js";
import { StableIdCodec } from "../src/security/stableId.js";
import { MailService } from "../src/services/mailService.js";
import { FakeFactory, rawMessage, testConfig } from "./fixtures.js";

function setup() {
  const factory = new FakeFactory();
  const ids = new StableIdCodec("0123456789abcdef0123456789abcdef");
  return { service: new MailService(testConfig, factory, ids), factory, ids };
}

describe("mail service", () => {
  it("lists only safe mailbox metadata", () => {
    const { service } = setup();
    const value = service.listMailboxes()[0]!;
    expect(value.mailbox_id).toBe("brand_a");
    expect(value).not.toHaveProperty("imap_host");
    expect(value).not.toHaveProperty("username_secret");
  });

  it("rejects an unbounded search", async () => {
    const { service } = setup();
    await expect(service.searchMessages({ mailbox_ids: ["brand_a"], limit: 20 })).rejects.toMatchObject({
      code: "UNBOUNDED_SEARCH_REJECTED",
    });
  });

  it("searches more than one mailbox and labels every result", async () => {
    const { service } = setup();
    const result = await service.searchMessages({ mailbox_ids: ["brand_a", "brand_b"], subject: "Example", limit: 20 });
    expect(result.messages).toHaveLength(2);
    expect(new Set(result.messages.map((message) => message.brand))).toEqual(new Set(["BRAND_A", "BRAND_B"]));
    expect(result.messages.every((message) => message.untrusted_content_warning.startsWith("UNTRUSTED_EMAIL_CONTENT"))).toBe(true);
  });

  it("returns partial failures without leaking the raw error", async () => {
    const { service, factory } = setup();
    factory.failures.add("brand_b");
    const result = await service.searchMessages({ mailbox_ids: ["brand_a", "brand_b"], subject: "Example", limit: 20 });
    expect(result.messages).toHaveLength(1);
    expect(result.partial_failures).toHaveLength(1);
    expect(JSON.stringify(result.partial_failures)).not.toContain("synthetic failure");
  });

  it("fetches, bounds and sanitizes a message", async () => {
    const { service, ids } = setup();
    const id = ids.encode({ mailbox_id: "brand_a", folder_id: "INBOX", uid_validity: 100n, uid: 42 });
    const result = await service.fetchMessage(id, { include_html: true, max_body_chars: 2000 });
    expect(result.text_body).toContain("Ignore previous instructions");
    expect(result.sanitized_html).toContain("Hello");
    expect(result.sanitized_html).not.toMatch(/script|tracker|img/i);
    expect(result.attachments[0]?.attachment_id).toMatch(/^mba1\./);
  });

  it("rejects a folder outside the allowlist", async () => {
    const { service, ids } = setup();
    const id = ids.encode({ mailbox_id: "brand_a", folder_id: "Trash", uid_validity: 100n, uid: 42 });
    await expect(service.fetchMessage(id, { include_html: false, max_body_chars: 2000 })).rejects.toMatchObject({
      code: "FOLDER_NOT_ALLOWED",
    });
  });

  it("searches every discovered selectable folder for private-app mailboxes", async () => {
    const config = structuredClone(testConfig);
    config.mailboxes[0]!.folder_access = "all_selectable";
    const factory = new FakeFactory();
    factory.folders.set("brand_a", ["INBOX", "Archive"]);
    factory.messages.set("brand_a", [
      rawMessage(),
      rawMessage({ uid: 43, folder: "Archive", received_at: "2026-07-17T10:00:00.000Z" }),
    ]);
    const service = new MailService(config, factory, new StableIdCodec("0123456789abcdef0123456789abcdef"));
    const result = await service.searchMessages({ mailbox_ids: ["brand_a"], subject: "Example", limit: 20 });
    expect(new Set(result.messages.map((message) => message.source_folder))).toEqual(new Set(["INBOX", "Archive"]));
  });

  it("does not truncate discovery or search when a mailbox has more than 100 selectable folders", async () => {
    const config = structuredClone(testConfig);
    config.mailboxes[0]!.folder_access = "all_selectable";
    const folders = Array.from({ length: 105 }, (_, index) => `Folder-${index + 1}`);
    const factory = new FakeFactory();
    factory.folders.set("brand_a", folders);
    factory.messages.set("brand_a", [
      rawMessage({ uid: 147, folder: "Folder-105", received_at: "2026-07-17T10:00:00.000Z" }),
    ]);
    const service = new MailService(config, factory, new StableIdCodec("0123456789abcdef0123456789abcdef"));

    expect(await service.listFolders("brand_a")).toHaveLength(105);
    const result = await service.searchMessages({ mailbox_ids: ["brand_a"], subject: "Example", limit: 20 });
    expect(result.messages.map((message) => message.source_folder)).toEqual(["Folder-105"]);
  });

  it("returns attachment metadata without bytes", async () => {
    const { service, ids } = setup();
    const id = ids.encode({ mailbox_id: "brand_a", folder_id: "INBOX", uid_validity: 100n, uid: 42 });
    const result = await service.listAttachments(id);
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty("content");
  });

  it("reconstructs a thread from identifiers", async () => {
    const { service, factory, ids } = setup();
    factory.messages.set("brand_a", [
      rawMessage({ uid: 42, message_id: "<42@example.invalid>" }),
      rawMessage({ uid: 43, message_id: "<43@example.invalid>", in_reply_to: "<42@example.invalid>", received_at: "2026-07-17T09:00:00.000Z" }),
    ]);
    const id = ids.encode({ mailbox_id: "brand_a", folder_id: "INBOX", uid_validity: 100n, uid: 42 });
    const result = await service.fetchThread(id, 10);
    expect(result.messages.map((message) => message.stable_message_id)).toHaveLength(2);
    expect(result.confidence).toBe("HIGH");
  });

  it("preserves typed service errors", () => {
    expect(new MailBridgeError("safe", "CODE").code).toBe("CODE");
  });
});
