#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const inputIndex = process.argv.indexOf("--input");
const input = process.argv[inputIndex + 1];
if (inputIndex < 0 || !input) {
  throw new Error("Usage: normalize-spdx.mjs --input <SPDX JSON file>");
}

const path = resolve(input);
const document = JSON.parse(await readFile(path, "utf8"));
const created = document.creationInfo?.created;
if (typeof created !== "string") {
  throw new Error("SPDX document has no creationInfo.created timestamp.");
}

const normalized = created.replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.\d+Z$/, "$1Z");
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(normalized)) {
  throw new Error(`Unsupported SPDX creation timestamp: ${created}`);
}

document.creationInfo.created = normalized;
await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ status: "PASS", created: normalized })}\n`);
