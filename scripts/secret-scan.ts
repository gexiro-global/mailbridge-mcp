import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(process.cwd());
const excluded = new Set([".git", ".playwright-cli", "node_modules", "dist", "coverage", "output", "runtime"]);
const textExtensions = new Set([".ts", ".js", ".json", ".yaml", ".yml", ".md", ".txt", ".example", ".toml"]);
const patterns: Array<[string, RegExp]> = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["openai-style-key", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/],
  ["credential-assignment", /\b(?:password|passwd|secret|api[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9+/_=-]{24,}["']?/i],
];

const findings: Array<{ file: string; line: number; rule: string }> = [];
for (const file of await walk(root)) {
  if (relative(root, file).replace(/\\/g, "/") === "scripts/secret-scan.ts") continue;
  const info = await stat(file);
  if (info.size > 1024 * 1024 || !isTextFile(file)) continue;
  const lines = (await readFile(file, "utf8")).split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const [rule, pattern] of patterns) {
      if (rule === "credential-assignment" && /^\s*(?:username_secret|password_secret):/i.test(line)) continue;
      if (pattern.test(line)) findings.push({ file: relative(root, file), line: index + 1, rule });
    }
  });
}

if (findings.length) {
  process.stderr.write(`${JSON.stringify({ status: "FAIL", findings }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({ status: "PASS", findings: 0 }, null, 2)}\n`);
}

async function walk(directory: string): Promise<string[]> {
  const results: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) results.push(...(await walk(full)));
    else if (entry.isFile()) results.push(full);
  }
  return results;
}

function isTextFile(file: string): boolean {
  const extension = extname(file).toLowerCase();
  return textExtensions.has(extension) || file.endsWith(".env.example") || file.endsWith(".gitignore") || file.endsWith(".npmrc");
}
