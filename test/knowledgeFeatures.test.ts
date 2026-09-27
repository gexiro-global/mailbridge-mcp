import { describe, expect, it } from "vitest";
import { StableIdCodec } from "../src/security/stableId.js";
import { MailService } from "../src/services/mailService.js";
import { dedupeSummaries, folderRank } from "../src/services/knowledgeScope.js";
import { FakeFactory, rawMessage, testConfig } from "./fixtures.js";

const KEY = "0123456789abcdef0123456789abcdef";
const codec = new StableIdCodec(KEY);
const foldersOf = (results: Array<{ id: string }>) => [...new Set(results.map((result) => codec.decode(result.id).folder_id))].sort();
const ATTACHMENT = Buffer.from("0123456789", "utf8");

class RecordingAdapter {
  constructor(readonly mailbox: { id: string }, readonly messages: ReturnType<typeof rawMessage>[], readonly folders: string[], readonly stats: { discoveries: number; searches: unknown[] }) {}
  async health() { return { mailbox_id: this.mailbox.id, connected: true, tls_verified: true, authentication_successful: true, folder_discovery_successful: true, latency_ms: 1, error_category: null, checked_at: "2026-07-17T08:00:00.000Z" }; }
  async discoverFolders() {
    this.stats.discoveries += 1;
    return this.folders.map((folder) => ({ folder_id: folder, display_name: folder, special_use: null, selectable: true, message_count: 1, unread_count: 1 }));
  }
  async listFolders() { return this.discoverFolders(); }
  async search(input: { folder: string; limit: number }) {
    this.stats.searches.push(input);
    return this.messages.filter((message) => message.folder === input.folder).slice(0, input.limit);
  }
  async fetch(folder: string, _uidValidity: bigint, uid: number) {
    const message = this.messages.find((entry) => entry.folder === folder && entry.uid === uid);
    if (!message) throw new Error("not found");
    return message;
  }
  async listAttachmentParts() {
    return [{ part: "2", filename: "report.pdf", mime_type: "application/pdf", size: ATTACHMENT.byteLength, disposition: "attachment", inline: false }];
  }
  async fetchAttachment(_folder: string, _uidValidity: bigint, _uid: number, _part: string, offset: number, maxBytes: number) {
    const bytes = ATTACHMENT.subarray(offset, offset + maxBytes);
    return { filename: "report.pdf", mime_type: "application/pdf", declared_size: ATTACHMENT.byteLength, bytes, truncated: offset + bytes.byteLength < ATTACHMENT.byteLength };
  }
  async verifyPeekInvariant() { return { success: true, flags_before: [], flags_after: [], unchanged: true, reason: "BODY_PEEK_FLAGS_UNCHANGED" }; }
}

function build(messages: ReturnType<typeof rawMessage>[], folders: string[], options: { attachmentCap?: number; resultLimit?: number } = {}) {
  const stats = { discoveries: 0, searches: [] as unknown[] };
  const config = structuredClone(testConfig);
  if (options.attachmentCap !== undefined) config.privacy.attachment_max_bytes = options.attachmentCap;
  config.mailboxes = [{ ...config.mailboxes[0]!, folder_access: "all_selectable", allowed_folders: folders, result_limit: options.resultLimit ?? 50 }];
  const factory = { create: async (mailbox: { id: string }) => new RecordingAdapter(mailbox, messages, folders, stats) };
  return { service: new MailService(config as never, factory as never, new StableIdCodec(KEY)), stats };
}

describe("folder ranking and deduplication", () => {
  it("ranks inbox and sent above archive, spam and trash", () => {
    expect(folderRank("INBOX")).toBeLessThan(folderRank("Projekte"));
    expect(folderRank("[Gmail]/Gesendet")).toBeLessThan(folderRank("[Gmail]/Alle Nachrichten"));
    expect(folderRank("[Gmail]/Alle Nachrichten")).toBeLessThan(folderRank("Spam"));
    expect(folderRank("Spam")).toBeLessThan(folderRank("Papierkorb"));
  });

  it("collapses the same message seen in several folders and keeps the best copy", () => {
    const base = { mailbox_id: "m1", subject: "Rechnung", received_at: "2026-09-01T10:00:00.000Z", from: [{ address: "a@b.invalid" }], attachment_count: 1 };
    const deduped = dedupeSummaries([
      { ...base, source_folder: "[Gmail]/Alle Nachrichten" },
      { ...base, source_folder: "INBOX" },
      { ...base, source_folder: "Spam" },
      { ...base, subject: "Andere", source_folder: "INBOX" },
    ]);
    expect(deduped).toHaveLength(2);
    expect(deduped[0]!.source_folder).toBe("INBOX");
  });

  it("keeps messages from different mailboxes apart", () => {
    const base = { subject: "Rechnung", received_at: "2026-09-01T10:00:00.000Z", from: [{ address: "a@b.invalid" }], attachment_count: 0, source_folder: "INBOX" };
    expect(dedupeSummaries([{ ...base, mailbox_id: "m1" }, { ...base, mailbox_id: "m2" }])).toHaveLength(2);
  });
});

describe("search covers and narrows the whole mailbox", () => {
  const spread = [
    rawMessage({ folder: "INBOX", uid: 1 }),
    rawMessage({ folder: "Sent", uid: 2 }),
    rawMessage({ folder: "Spam", uid: 3 }),
    rawMessage({ folder: "[Gmail]/Alle Nachrichten", uid: 4 }),
  ];
  const allFolders = ["INBOX", "Sent", "Spam", "[Gmail]/Alle Nachrichten"];

  it("searches every selectable folder including Sent and Spam by default", async () => {
    const { service, stats } = build(spread.map((message, index) => rawMessage({ ...message, subject: `Example ${index}` })), allFolders);
    const searched = await service.searchKnowledge("Example");
    expect(foldersOf(searched.results)).toEqual([...allFolders].sort());
    expect((stats.searches as Array<{ folder: string }>).map((input) => input.folder).sort()).toEqual([...allFolders].sort());
  });

  it("collapses the archive duplicate of an inbox message", async () => {
    const { service } = build([rawMessage({ folder: "INBOX", uid: 1 }), rawMessage({ folder: "[Gmail]/Alle Nachrichten", uid: 4 })], ["INBOX", "[Gmail]/Alle Nachrichten"]);
    const searched = await service.searchKnowledge("Example");
    expect(searched.results).toHaveLength(1);
    expect(foldersOf(searched.results)).toEqual(["INBOX"]);
  });

  it("narrows to named folders when the caller asks for them", async () => {
    const { service, stats } = build(spread.map((message, index) => rawMessage({ ...message, subject: `Example ${index}` })), allFolders);
    const searched = await service.searchKnowledge("Example", { folders: ["Spam"] });
    expect(foldersOf(searched.results)).toEqual(["Spam"]);
    expect((stats.searches as Array<{ folder: string }>).every((input) => input.folder === "Spam")).toBe(true);
  });

  it("passes limit and message filters down to the IMAP search", async () => {
    const { service, stats } = build(spread.map((message, index) => rawMessage({ ...message, subject: `Example ${index}` })), allFolders);
    await service.searchKnowledge("Example", { limit: 7, unread_only: true, has_attachment: true, after: "2026-01-01T00:00:00.000Z", before: "2026-12-31T00:00:00.000Z" });
    const first = (stats.searches as Array<Record<string, unknown>>)[0]!;
    expect(first).toEqual(expect.objectContaining({ limit: 7, unread_only: true, has_attachment: true }));
    expect(first.after).toBeInstanceOf(Date);
    expect(first.before).toBeInstanceOf(Date);
  });

  it("returns up to 200 unique results and exposes bounded search status", async () => {
    const messages = Array.from({ length: 150 }, (_, index) => rawMessage({
      uid: index + 1,
      folder: index % 2 === 0 ? "INBOX" : "Sent",
      subject: `Example ${index}`,
    }));
    const { service } = build(messages, ["INBOX", "Sent"], { resultLimit: 100 });
    const searched = await service.searchKnowledge("Example", { limit: 200 });
    expect(searched.results).toHaveLength(150);
    expect(searched.partial_failures).toEqual([]);
    expect(searched.truncated).toBe(false);
  });

  it("reports partial mailbox failures on the standard search contract", async () => {
    const factory = new FakeFactory();
    factory.failures.add("brand_b");
    const service = new MailService(testConfig, factory, new StableIdCodec(KEY));
    const searched = await service.searchKnowledge("Example");
    expect(searched.results.length).toBeGreaterThan(0);
    expect(searched.partial_failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ mailbox_id: "brand_b" }),
    ]));
  });

  it("caches folder discovery between searches", async () => {
    const { service, stats } = build(spread, allFolders);
    await service.searchKnowledge("Example");
    await service.searchKnowledge("Example");
    expect(stats.discoveries).toBe(1);
  });

  it("lists recent messages across every folder when no folder is given", async () => {
    const { service } = build(spread.map((message, index) => rawMessage({ ...message, subject: `Example ${index}` })), allFolders);
    const recent = await service.listRecentMessages({ mailbox_ids: ["brand_a"], limit: 20 });
    expect([...new Set(recent.messages.map((message) => message.source_folder))].sort()).toEqual([...allFolders].sort());
  });
});

describe("attachment streaming", () => {
  it("walks a large attachment in chunks and stops when next_offset is null", async () => {
    const { service } = build([rawMessage({ folder: "INBOX", uid: 1 })], ["INBOX"]);
    const searched = await service.searchKnowledge("Example");
    const id = searched.results[0]!.id;
    const listed = await service.listAttachments(id);
    const attachmentId = listed[0]!.attachment_id;

    const chunks: Buffer[] = [];
    let offset: number | null = 0;
    let guard = 0;
    while (offset !== null && guard < 10) {
      const part: Awaited<ReturnType<typeof service.fetchAttachment>> = await service.fetchAttachment(id, attachmentId, 4, offset);
      expect(part.offset).toBe(offset);
      chunks.push(Buffer.from(part.content_base64, "base64"));
      offset = part.next_offset;
      guard += 1;
    }
    expect(guard).toBe(3);
    expect(Buffer.concat(chunks).toString("utf8")).toBe(ATTACHMENT.toString("utf8"));
  });

  it("stops at the configured attachment ceiling with a terminal cursor", async () => {
    const { service } = build([rawMessage({ folder: "INBOX", uid: 1 })], ["INBOX"], { attachmentCap: 8 });
    const id = (await service.searchKnowledge("Example")).results[0]!.id;
    const attachmentId = (await service.listAttachments(id))[0]!.attachment_id;
    const first = await service.fetchAttachment(id, attachmentId, 4, 0);
    expect(first.next_offset).toBe(4);
    const last = await service.fetchAttachment(id, attachmentId, 4, first.next_offset!);
    expect(last.returned_bytes).toBe(4);
    expect(last.next_offset).toBe(8);
    expect(last.truncated).toBe(true);
    const final = await service.fetchAttachment(id, attachmentId, 4, last.next_offset!);
    expect(final.returned_bytes).toBe(2);
    expect(final.next_offset).toBeNull();
    expect(final.truncated).toBe(false);
  });

  it("returns the whole attachment in one call when the window is large enough", async () => {
    const { service } = build([rawMessage({ folder: "INBOX", uid: 1 })], ["INBOX"]);
    const searched = await service.searchKnowledge("Example");
    const id = searched.results[0]!.id;
    const attachmentId = (await service.listAttachments(id))[0]!.attachment_id;
    const whole = await service.fetchAttachment(id, attachmentId, 1024, 0);
    expect(whole.offset).toBe(0);
    expect(whole.next_offset).toBeNull();
    expect(whole.truncated).toBe(false);
    expect(Buffer.from(whole.content_base64, "base64").toString("utf8")).toBe(ATTACHMENT.toString("utf8"));
  });
});
