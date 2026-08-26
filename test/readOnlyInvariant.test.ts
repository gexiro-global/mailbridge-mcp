import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("IMAP read-only invariant", () => {
  it("opens mailbox locks with readOnly true", async () => {
    const source = await readFile(resolve("src/imap/imapFlowAdapter.ts"), "utf8");
    expect(source).toMatch(/getMailboxLock\([\s\S]*?readOnly:\s*true/);
    expect(source).toContain("READ_ONLY_INVARIANT_FAILED");
  });

  it("does not reference mutating ImapFlow methods", async () => {
    const source = await readFile(resolve("src/imap/imapFlowAdapter.ts"), "utf8");
    const forbidden = [
      ".messageFlagsSet(", ".messageFlagsAdd(", ".messageFlagsRemove(", ".messageDelete(",
      ".messageMove(", ".messageCopy(", ".append(", ".expunge(", ".mailboxCreate(", ".mailboxDelete(",
    ];
    for (const method of forbidden) expect(source).not.toContain(method);
  });

  it("limits fetched message source bytes", async () => {
    const source = await readFile(resolve("src/imap/imapFlowAdapter.ts"), "utf8");
    expect(source).toContain("source: { maxLength: boundedBytes }");
    expect(source).toContain("maxLiteralSize");
  });

  it("compares complete flag sets before and after a BODY.PEEK source fetch", async () => {
    const source = await readFile(resolve("src/imap/imapFlowAdapter.ts"), "utf8");
    expect(source).toContain("verifyPeekInvariant");
    expect(source).toContain("flags_before");
    expect(source).toContain("flags_after");
    expect(source).toContain("BODY_PEEK_FLAGS_UNCHANGED");
    expect(source).toContain("assertReadOnlyMailbox(client)");
  });
});
