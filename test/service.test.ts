import { describe, expect, it } from "vitest";
import { DemoMailService } from "../src/service.js";

const service = new DemoMailService("https://mailbridge.example.test");

describe("synthetic read-only service", () => {
  it("contains only reserved synthetic domains", () => {
    const payload = service.listMailboxes();
    expect(payload.mailboxes.length).toBeGreaterThan(0);
    expect(payload.mailboxes.every((mailbox) => mailbox.mailbox_email.endsWith(".synthetic.invalid"))).toBe(true);
  });

  it("searches every folder when folders are omitted", () => {
    const result = service.searchMessages({ free_text: "compliance", limit: 20 });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.folder).toBe("Archive");
    expect(result.partial_failures).toEqual([]);
  });

  it("reconstructs threads from message identifiers", () => {
    const thread = service.fetchThread("msg_atlas_001", 20);
    expect(thread.messages.map((message) => message.stable_message_id)).toEqual([
      "msg_atlas_002",
      "msg_atlas_001",
    ]);
    expect(thread.confidence).toBe("HIGH");
  });

  it("returns bounded attachment bytes and a checksum", () => {
    const result = service.fetchAttachment("msg_atlas_001", "att_atlas_brief", 12);
    expect(result.returned_bytes).toBe(12);
    expect(result.truncated).toBe(true);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Buffer.from(result.content_base64, "base64")).toHaveLength(12);
  });

  it("implements canonical search and fetch documents", () => {
    const searched = service.searchKnowledge("ATLAS");
    expect(searched.results.length).toBeGreaterThan(0);
    const document = service.fetchKnowledge(searched.results[0]!.id);
    expect(document.url).toMatch(/^https:\/\/mailbridge\.example\.test\/documents\//);
    expect(document.text).toContain("Synthetic");
  });
});
