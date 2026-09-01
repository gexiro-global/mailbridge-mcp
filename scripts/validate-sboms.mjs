#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const options = parseArguments(process.argv.slice(2));
const cyclonedxPath = resolve(requireOption(options, "cyclonedx"));
const spdxPath = resolve(requireOption(options, "spdx"));
const expectedVersion = requireOption(options, "version");

const cyclonedxText = await readFile(cyclonedxPath, "utf8");
const spdxText = await readFile(spdxPath, "utf8");
const cyclonedx = parseJson(cyclonedxText, "CycloneDX SBOM");
const spdx = parseJson(spdxText, "SPDX SBOM");
const cyclonedxRoot = cyclonedx.metadata?.component;
const expectedCycloneDxBomRef = `@gexiro/mailbridge-mcp@${expectedVersion}`;
const expectedCycloneDxPurl = `pkg:npm/%40gexiro/mailbridge-mcp@${expectedVersion}`;

if (
  cyclonedx.bomFormat !== "CycloneDX" ||
  cyclonedx.specVersion !== "1.5" ||
  !["@gexiro/mailbridge-mcp", "mailbridge-mcp"].includes(cyclonedxRoot?.name) ||
  cyclonedxRoot?.version !== expectedVersion ||
  cyclonedxRoot?.["bom-ref"] !== expectedCycloneDxBomRef ||
  cyclonedxRoot?.purl !== expectedCycloneDxPurl ||
  !Array.isArray(cyclonedx.components) ||
  cyclonedx.components.length === 0 ||
  !Array.isArray(cyclonedx.dependencies)
) {
  fail("CycloneDX SBOM does not describe the released MailBridge package.");
}

const rootPackage = Array.isArray(spdx.packages)
  ? spdx.packages.find(
      (entry) => entry.name === "@gexiro/mailbridge-mcp" && entry.versionInfo === expectedVersion,
    )
  : undefined;
if (
  spdx.spdxVersion !== "SPDX-2.3" ||
  spdx.dataLicense !== "CC0-1.0" ||
  spdx.SPDXID !== "SPDXRef-DOCUMENT" ||
  !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(spdx.creationInfo?.created ?? "") ||
  !rootPackage ||
  !Array.isArray(spdx.relationships) ||
  spdx.relationships.length === 0
) {
  fail("SPDX SBOM does not describe the released MailBridge package.");
}

for (const [label, text] of [
  ["CycloneDX", cyclonedxText],
  ["SPDX", spdxText],
]) {
  if (/(?:[A-Za-z]:\\Users\\|\/home\/runner\/work\/|\/Users\/)/.test(text)) {
    fail(`${label} SBOM contains an absolute local workspace path.`);
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      status: "PASS",
      version: expectedVersion,
      cyclonedx: cyclonedx.specVersion,
      cyclonedx_components: cyclonedx.components.length,
      spdx: spdx.spdxVersion,
      spdx_packages: spdx.packages.length,
    },
    null,
    2,
  )}\n`,
);

function parseArguments(args) {
  const result = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined) fail(`Invalid argument near ${name ?? "<end>"}.`);
    result.set(name.slice(2), value);
  }
  return result;
}

function requireOption(options, name) {
  const value = options.get(name);
  if (!value) fail(`Missing --${name}.`);
  return value;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    fail(`${label} is not valid JSON.`);
  }
}

function fail(message) {
  throw new Error(message);
}
