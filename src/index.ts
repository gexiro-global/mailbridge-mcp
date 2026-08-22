#!/usr/bin/env node
import { startHttpServer } from "./http.js";

const host = process.env.MAILBRIDGE_HOST ?? "127.0.0.1";
const port = parsePort(process.env.MAILBRIDGE_PORT);
const publicBaseUrl = process.env.MAILBRIDGE_PUBLIC_BASE_URL ?? `http://${host}:${port}`;
const widgetDomain = process.env.MAILBRIDGE_WIDGET_DOMAIN;

const runtime = await startHttpServer({
  host,
  port,
  publicBaseUrl,
  ...(widgetDomain ? { widgetDomain } : {}),
});

const shutdown = (): void => {
  void runtime.close().finally(() => process.exit(0));
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.log(JSON.stringify({
  status: "ready",
  mode: "SYNTHETIC_DEMO",
  mcp: `${publicBaseUrl.replace(/\/$/, "")}/mcp`,
  widget: `${publicBaseUrl.replace(/\/$/, "")}/widget`,
  write_operations: 0,
}));

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? "3100");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error("MAILBRIDGE_PORT must be 1..65535");
  return parsed;
}
