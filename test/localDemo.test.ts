import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mailbridgeWidgetHtml } from "../src/app/widget.js";
import { createLocalDemoRuntime, type LocalDemoRuntime } from "../src/demo/runtime.js";
import { startHttpTransport } from "../src/transport/http.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("local synthetic demo", () => {
  it("uses loopback, local SQLite and synthetic adapters only", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mailbridge-local-demo-"));
    const runtime = await createRuntime(directory);
    cleanups.push(async () => {
      runtime.close();
      await rm(directory, { recursive: true, force: true });
    });

    expect(runtime.config.server.bind_host).toBe("127.0.0.1");
    expect(runtime.config.auth.mode).toBe("disabled_dev");
    expect(runtime.config.auth.scopes).toEqual(["mail.read", "mail.health.read"]);
    expect(runtime.config.app.database_path).toContain("mailbridge-local-demo.sqlite");
    const scoped = runtime.services.create();
    const mailboxes = scoped.service.listMailboxes();
    expect(mailboxes).toHaveLength(2);
    const searched = await scoped.service.searchMessages({
      mailbox_ids: mailboxes.map((mailbox) => mailbox.mailbox_id),
      free_text: "ATLAS",
      limit: 20,
    });
    expect(searched.messages.length).toBeGreaterThan(0);
    expect(searched.messages.every((message) => message.subject.includes("ATLAS"))).toBe(true);
    scoped.dispose();
  });

  it("does not persist the synthetic placeholder credential as plaintext", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mailbridge-local-demo-encryption-"));
    const runtime = await createRuntime(directory);
    runtime.close();
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const files = await readdir(directory);
    const databaseBytes = await Promise.all(files
      .filter((name) => name.startsWith("mailbridge-local-demo.sqlite"))
      .map((name) => readFile(join(directory, name))));
    expect(Buffer.concat(databaseBytes).toString("utf8")).not.toContain("synthetic-local-only");
  });

  it("renders an unmistakable demo warning and hides credential inputs", () => {
    const html = mailbridgeWidgetHtml({ localDemo: true });
    expect(html).toContain("LOCAL SYNTHETIC DEMO — NO REAL MAILBOX CONNECTED");
    expect(html).toContain('data-local-demo="true"');
    expect(html).toContain(".local-demo .credential");
    expect(html).toContain('value.username="synthetic-local-only"');
  });

  it("provides a separate Safe Send staging mode with a synthetic transport only", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mailbridge-safe-send-demo-"));
    const runtime = await createRuntime(directory, true);
    cleanups.push(async () => {
      runtime.close();
      await rm(directory, { recursive: true, force: true });
    });

    expect(runtime.safeSend).toBe(true);
    expect(runtime.config.auth.scopes).toEqual(["mail.read", "mail.health.read", "mail.send"]);
    const scoped = runtime.services.create();
    expect(scoped.writer).toBeDefined();
    const mailbox = scoped.service.listMailboxes()[0]!;
    const draft = scoped.writer!.createDraft({
      mailbox_id: mailbox.mailbox_id,
      to: ["recipient@external.synthetic.invalid"],
      subject: "Synthetic Safe Send staging",
      text_body: "No real email is sent.",
    });
    const confirmation = scoped.writer!.prepareDraftSend(draft.draft_id);
    const sent = await scoped.writer!.sendDraft(draft.draft_id, confirmation.confirmation_id, confirmation.draft_version);
    expect(sent.operation.state).toBe("smtp_accepted");
    expect(runtime.syntheticSendCount()).toBe(1);
    scoped.dispose();

    const html = mailbridgeWidgetHtml({ localDemo: true, safeSendDemo: true });
    expect(html).toContain("LOCAL SAFE SEND STAGING — SYNTHETIC TRANSPORT — NO REAL EMAIL");
    expect(html).toContain('data-safe-send-demo="true"');
  });

  it("starts the Safe Send HTTP staging mode only behind its explicit flag", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mailbridge-safe-send-http-"));
    const runtime = await createRuntime(directory, true);
    runtime.config.server.port = 0;
    vi.stubEnv("MAILBRIDGE_SAFE_SEND_DEMO", "1");
    const http = await startHttpTransport(runtime.config, null, undefined, runtime);
    cleanups.push(async () => {
      await http.close();
      runtime.close();
      await rm(directory, { recursive: true, force: true });
    });

    const address = http.server.address() as AddressInfo;
    const docs = await fetch(`http://127.0.0.1:${address.port}/docs`).then((response) => response.json()) as { write_tools: boolean };
    expect(docs.write_tools).toBe(true);
  });
});

async function createRuntime(directory: string, safeSend = false): Promise<LocalDemoRuntime> {
  return createLocalDemoRuntime({
    runtimePath: directory,
    credentialKey: randomBytes(32),
    userKey: randomBytes(32),
    idKey: randomBytes(32),
    port: 3091,
    safeSend,
  });
}
