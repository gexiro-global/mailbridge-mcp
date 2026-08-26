#!/usr/bin/env node
import { randomBytes } from "node:crypto";

if ((process.env.NODE_ENV ?? "development") === "production") {
  throw new Error("Synthetic Safe Send staging cannot run with NODE_ENV=production");
}

process.env.NODE_ENV = "development";
process.env.MAILBRIDGE_SAFE_SEND_DEMO = "1";
process.env.MAILBRIDGE_LOCAL_RUNTIME ??= "/tmp/mailbridge-safe-send-staging";
process.env.MAILBRIDGE_LOCAL_PORT ??= "3091";
process.env.MAILBRIDGE_LOCAL_CREDENTIAL_KEY = randomBytes(32).toString("base64url");
process.env.MAILBRIDGE_LOCAL_USER_KEY = randomBytes(32).toString("base64url");
process.env.MAILBRIDGE_LOCAL_ID_KEY = randomBytes(32).toString("base64url");
process.argv.push("--transport", "safe-send-demo");

await import("../index.js");
