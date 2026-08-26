#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { chmod, chown, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const SAFE_SECRET_NAME = /^[A-Za-z0-9._-]+$/;
const sourceDirectory = resolve(process.argv[2] ?? "/source-secrets");
const targetDirectory = resolve(process.argv[3] ?? "/runtime-secrets");
const runtimeUid = numericId(process.argv[4] ?? "10001", "runtime UID");
const runtimeGid = numericId(process.argv[5] ?? "10001", "runtime GID");
const provisionerUid = typeof process.getuid === "function" ? process.getuid() : runtimeUid;

await mkdir(targetDirectory, { recursive: true, mode: 0o710 });
await chown(targetDirectory, provisionerUid, runtimeGid);
await chmod(targetDirectory, 0o710);

let provisioned = 0;
for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
  if (entry.name === "README.md") continue;
  if (!SAFE_SECRET_NAME.test(entry.name)) throw new Error("Secret directory contains an unsafe filename");

  const source = resolve(sourceDirectory, entry.name);
  const sourceStat = await lstat(source);
  if (!entry.isFile() || !sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error(`Secret source is not a regular file: ${entry.name}`);
  }

  const value = await readFile(source);
  if (value.byteLength === 0 || value.byteLength > 16 * 1024) {
    value.fill(0);
    throw new Error(`Secret file has an invalid size: ${entry.name}`);
  }

  const target = resolve(targetDirectory, entry.name);
  const temporary = resolve(targetDirectory, `.provision-${randomBytes(8).toString("hex")}`);
  try {
    await writeFile(temporary, value, { flag: "wx", mode: 0o400 });
    await chmod(temporary, 0o400);
    await chown(temporary, runtimeUid, runtimeGid);
    await replaceFile(temporary, target);
    provisioned += 1;
  } finally {
    value.fill(0);
    await unlink(temporary).catch(() => undefined);
  }
}

if (provisioned === 0) throw new Error("No secret files were provisioned");
process.stdout.write(`${JSON.stringify({
  status: "READY",
  provisioned_secret_files: provisioned,
  secret_values_printed: 0,
})}\n`);

function numericId(value, label) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be numeric`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2147483647) {
    throw new Error(`${label} is outside the supported range`);
  }
  return parsed;
}

async function replaceFile(temporary, target) {
  try {
    await rename(temporary, target);
    return;
  } catch (error) {
    if (process.platform !== "win32" || !["EEXIST", "EPERM"].includes(error?.code)) throw error;
  }

  // Windows cannot atomically replace an existing destination with rename().
  // The production container is Linux; this compatibility branch preserves a
  // rollback copy solely for local verification on Windows.
  const backup = `${target}.previous-${randomBytes(8).toString("hex")}`;
  let moved = false;
  try {
    await rename(target, backup);
    moved = true;
    await rename(temporary, target);
    await unlink(backup);
  } catch (error) {
    if (moved) await rename(backup, target).catch(() => undefined);
    throw error;
  }
}
