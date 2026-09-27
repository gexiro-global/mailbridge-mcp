import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createMailBridgeMcpServer } from "../src/mcp/server.js";
import { StableIdCodec } from "../src/security/stableId.js";
import { MailService } from "../src/services/mailService.js";
import { FakeFactory, rawMessage, testConfig } from "./fixtures.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map((close) => close())); });

function build() {
  const config = structuredClone(testConfig);
  config.mailboxes[0]!.folder_access = "all_selectable";
  const factory = new FakeFactory();
  factory.folders.set("brand_a", ["INBOX", "Sent", "Spam"]);
  factory.messages.set("brand_a", [
    ...Array.from({ length: 6 }, (_, index) => rawMessage({
      folder: "INBOX", uid: index + 1, subject: "Inbox " + (index + 1),
    })),
    rawMessage({ folder: "Sent", uid: 7, subject: "Sent copy" }),
    rawMessage({ folder: "Spam", uid: 8, subject: "Spam arrival" }),
  ]);
  return new MailService(config, factory, new StableIdCodec("0123456789abcdef0123456789abcdef"));
}

describe("complete read-only folder paging", () => {
  it("walks every UID across bounded pages without repeating or skipping", async () => {
    const service = build();
    const seen: number[] = [];
    let before: number | undefined;
    let validity: string | undefined;
    let pages = 0;
    do {
      const page = await service.listMessagesPage({
        mailbox_id: "brand_a", folder: "INBOX", limit: 2,
        ...(before === undefined ? {} : { before_uid: before, uid_validity: validity }),
      });
      seen.push(...page.messages.map((message) => Number(message.subject.replace("Inbox ", ""))));
      validity = page.uid_validity ?? undefined;
      before = page.next_before_uid ?? undefined;
      pages += 1;
      if (page.next_before_uid === null) break;
    } while (pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual([6, 5, 4, 3, 2, 1]);
    const spam = await service.listMessagesPage({ mailbox_id: "brand_a", folder: "Spam", limit: 2 });
    expect(spam.messages.map((message) => message.subject)).toEqual(["Spam arrival"]);
    expect(spam.next_before_uid).toBeNull();
  });

  it("rejects incomplete and stale continuation cursors", async () => {
    const service = build();
    await expect(service.listMessagesPage({ mailbox_id: "brand_a", folder: "INBOX", limit: 2, before_uid: 5 }))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(service.listMessagesPage({ mailbox_id: "brand_a", folder: "INBOX", limit: 2, before_uid: 5, uid_validity: "999" }))
      .rejects.toMatchObject({ code: "UIDVALIDITY_CHANGED" });
  });

  it("exposes paging over MCP as a read-only tool", async () => {
    const server = createMailBridgeMcpServer(build(), true);
    const client = new Client({ name: "paging-test", version: "1" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closers.push(() => client.close(), () => server.close());
    const tool = (await client.listTools()).tools.find((item) => item.name === "list_messages_page");
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    const result = await client.callTool({ name: "list_messages_page", arguments: { mailbox_id: "brand_a", folder: "INBOX", limit: 2 } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(expect.objectContaining({
      mailbox_id: "brand_a", next_before_uid: 5, uid_validity: "100",
    }));
  });
});
