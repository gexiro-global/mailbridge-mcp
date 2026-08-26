#!/usr/bin/env node
import { randomBytes } from "node:crypto";

if ((process.env.NODE_ENV ?? "development") === "production") {
  throw new Error("Synthetic local demo cannot run with NODE_ENV=production");
}

process.env.NODE_ENV = "development";
process.env.MAILBRIDGE_LOCAL_DEMO = "1";
process.env.MAILBRIDGE_LOCAL_RUNTIME ??= "./runtime/local-demo";
process.env.MAILBRIDGE_LOCAL_PORT ??= "3091";
process.env.MAILBRIDGE_LOCAL_CREDENTIAL_KEY = randomBytes(32).toString("base64url");
process.env.MAILBRIDGE_LOCAL_USER_KEY = randomBytes(32).toString("base64url");
process.env.MAILBRIDGE_LOCAL_ID_KEY = randomBytes(32).toString("base64url");
process.argv.push("--transport", "local-demo");

await import("../index.js");
