import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const execute = promisify(execFile);

describe("public setup", () => {
  it("creates idempotent non-disclosing application state", async () => {
    const home = await mkdtemp(join(tmpdir(), "mailbridge-setup-"));
    const script = resolve("scripts/setup.mjs");
    const first = await execute(process.execPath, [script], {
      env: { ...process.env, MAILBRIDGE_SETUP_ROOT: home },
    });
    const files = (await readdir(join(home, "secrets"))).sort();
    expect(files).toEqual([
      "mailbridge_credential_master_key",
      "mailbridge_id_hmac_key",
      "mailbridge_user_key_hmac",
    ]);
    const before = await Promise.all(files.map((name) => readFile(join(home, "secrets", name), "utf8")));
    for (const value of before) {
      expect(value.trim()).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(first.stdout).not.toContain(value.trim());
    }
    expect((await stat(join(home, "config", "mailboxes.yaml"))).isFile()).toBe(true);
    await execute(process.execPath, [script], { env: { ...process.env, MAILBRIDGE_SETUP_ROOT: home } });
    const after = await Promise.all(files.map((name) => readFile(join(home, "secrets", name), "utf8")));
    expect(after).toEqual(before);
  });
});
