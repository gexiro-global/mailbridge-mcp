import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { NextFunction, Request, Response } from "express";
import type { Server } from "node:http";
import { DemoMailService } from "./service.js";
import { createMailBridgeServer } from "./server.js";
import { mailbridgeWidgetHtml } from "./widget.js";
import { MAILBRIDGE_VERSION } from "./version.js";

export interface HttpOptions {
  host: string;
  port: number;
  publicBaseUrl: string;
  widgetDomain?: string;
}

export async function startHttpServer(options: HttpOptions): Promise<{ server: Server; close(): Promise<void> }> {
  assertSafeBinding(options.host);
  const allowedHosts = [...new Set([options.host, "127.0.0.1", "localhost"])]
    .filter((host) => host !== "0.0.0.0" && host !== "::");
  const app = createMcpExpressApp({ host: options.host, allowedHosts });
  const active = new Set<() => Promise<void>>();
  const service = new DemoMailService(options.publicBaseUrl);

  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.get("/health", (_request, response) => {
    response.json({ status: "ok", service: "mailbridge-mcp-community", version: MAILBRIDGE_VERSION, mode: "SYNTHETIC_DEMO" });
  });
  app.get("/widget", (_request, response) => {
    response.type("html").send(mailbridgeWidgetHtml());
  });
  app.get("/documents/:id", (request, response) => {
    try {
      response.json(service.fetchKnowledge(request.params.id));
    } catch {
      response.status(404).json({ error: "document_not_found" });
    }
  });
  app.all("/mcp", async (request, response) => {
    const mcp = createMailBridgeServer({
      publicBaseUrl: options.publicBaseUrl,
      ...(options.widgetDomain ? { widgetDomain: options.widgetDomain } : {}),
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    let closing: Promise<void> | undefined;
    const cleanup = (): Promise<void> => {
      active.delete(cleanup);
      closing ??= mcp.close();
      return closing;
    };
    active.add(cleanup);
    try {
      await mcp.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } finally {
      await cleanup();
    }
  });
  app.use((_error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    response.status(400).json({ error: "invalid_request" });
  });

  const server = app.listen(options.port, options.host);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return {
    server,
    close: async () => {
      await Promise.allSettled([...active].map((cleanup) => cleanup()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function assertSafeBinding(host: string): void {
  const loopback = new Set(["127.0.0.1", "localhost", "::1"]);
  if (!loopback.has(host) && process.env.MAILBRIDGE_ALLOW_PUBLIC_DEMO !== "I_UNDERSTAND_SYNTHETIC_ONLY") {
    throw new Error(
      "Refusing a non-loopback demo bind. Set MAILBRIDGE_ALLOW_PUBLIC_DEMO=I_UNDERSTAND_SYNTHETIC_ONLY only behind reviewed HTTPS and authentication.",
    );
  }
}

function securityHeaders(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; frame-ancestors 'self' https://chatgpt.com",
  );
  next();
}
