import { rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(repositoryRoot, "dist");

if (dirname(target) !== repositoryRoot || target === repositoryRoot) {
  throw new Error("Refusing to clean outside the repository dist directory.");
}

await stat(join(repositoryRoot, "package.json"));
await rm(target, { recursive: true, force: true });
