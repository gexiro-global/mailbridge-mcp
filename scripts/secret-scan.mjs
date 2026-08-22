import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const tracked = discoverFiles().filter((file) => !file.endsWith("package-lock.json"));

const patterns = [
  { name: "OpenAI key", expression: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { name: "GitHub token", expression: /gh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}/g },
  { name: "private key", expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: "credential assignment", expression: /(?:password|secret|token|api[_-]?key)\s*[:=]\s*["'][^"']{12,}["']/gi },
];

const findings = [];
for (const file of tracked) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const pattern of patterns) {
    pattern.expression.lastIndex = 0;
    if (pattern.expression.test(content)) findings.push({ file, rule: pattern.name });
  }
}

if (findings.length) {
  console.error(JSON.stringify({ status: "FAIL", findings }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ status: "PASS", findings: 0 }));
}

function discoverFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\0")
      .filter(Boolean);
  } catch {
    const ignored = new Set([".git", ".npm-cache-mailbridge-public", "coverage", "dist", "node_modules", "runtime"]);
    const files = [];
    const visit = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && ignored.has(entry.name)) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (entry.isFile()) files.push(relative(process.cwd(), path));
      }
    };
    visit(process.cwd());
    return files;
  }
}
