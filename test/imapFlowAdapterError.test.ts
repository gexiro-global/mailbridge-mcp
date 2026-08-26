import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

vi.mock("imapflow", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeImapFlow extends EventEmitter {
    static instances: EventEmitter[] = [];
    secureConnection = true;
    authenticated = true;
    usable = false;

    constructor() {
      super();
      FakeImapFlow.instances.push(this);
    }

    async connect(): Promise<void> {}
    async list(): Promise<never[]> { return []; }
    close(): void {}
  }

  return { ImapFlow: FakeImapFlow };
});

import { ImapFlowReadOnlyAdapter } from "../src/imap/imapFlowAdapter.js";
import { testConfig } from "./fixtures.js";
import { ImapFlow } from "imapflow";

describe("ImapFlowReadOnlyAdapter asynchronous errors", () => {
  it("does not terminate the MCP process when ImapFlow emits NoConnection", async () => {
    const instances = (ImapFlow as unknown as { instances: EventEmitter[] }).instances;
    instances.length = 0;
    const mailbox = testConfig.mailboxes[0]!;
    const adapter = new ImapFlowReadOnlyAdapter(mailbox, "user", "app-password", {
      sourceMaxBytes: 1024,
      snippetMaxChars: 128,
      attachmentMaxBytes: 1024,
    });

    await expect(adapter.health()).resolves.toMatchObject({ connected: true });
    const client = instances[0]!;
    const error = Object.assign(new Error("Connection not available"), { code: "NoConnection" });

    expect(client.listenerCount("error")).toBeGreaterThan(0);
    expect(() => client.emit("error", error)).not.toThrow();
  });
});
