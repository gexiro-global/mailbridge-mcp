import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const RUNTIME_LOGGING_SOURCES = [
  "src/index.ts",
  "src/tunnel-stdio.ts",
  "src/admin/server.ts",
  "src/maintenance/stageFixedOwnerKey.ts",
  "src/cli.ts",
] as const;

describe("sensitive logging invariants", () => {
  it.each(RUNTIME_LOGGING_SOURCES)(
    "%s does not emit properties from caught errors",
    async (path) => {
      const source = await readFile(path, "utf8");
      const sinkLines = source
        .split("\n")
        .filter((line) =>
          /logger\.(?:fatal|error|warn|info)|process\.(?:stdout|stderr)\.write/.test(line),
        );

      for (const line of sinkLines) {
        expect(line).not.toMatch(/\berror\.(?:name|message|stack|cause)\b/);
      }
    },
  );

  it("uses a fixed category at the startup boundary", async () => {
    const source = await readFile("src/index.ts", "utf8");
    expect(source).toContain('error_category: "STARTUP_FAILED"');
    expect(source).not.toContain("main().catch((error");
  });
});
