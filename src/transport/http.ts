import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type NextFunction, type Request, type Response } from "express";
import type { Server } from "node:http";
import type { MailBridgeConfig } from "../config/schema.js";
import { createAuthMiddleware, protectedResourceMetadata } from "../auth/oauth.js";
import { createMailBridgeMcpServer, type MailBridgeWidgetOptions } from "../mcp/server.js";
import { createRateLimiter } from "../security/rateLimit.js";
import type { MailService } from "../services/mailService.js";
import { logger } from "../util/logger.js";
import type { PrivateAppRuntime } from "../app/runtime.js";
import { createSettingsRouter } from "../app/settingsApi.js";
import { oauthIdentity } from "../app/identity.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { LocalDemoRuntime } from "../demo/runtime.js";
import { mailbridgeWidgetHtml } from "../app/widget.js";

export interface HttpRuntime {
  server: Server;
  close(): Promise<void>;
}

export async function startHttpTransport(
  config: MailBridgeConfig,
  service: MailService | null,
  privateApp?: PrivateAppRuntime,
  localDemo?: LocalDemoRuntime,
): Promise<HttpRuntime> {
  if (privateApp && localDemo) throw new Error("Private App and local demo runtimes are mutually exclusive");
  const localDemoFlagEnabled = localDemo?.safeSend
    ? process.env.MAILBRIDGE_SAFE_SEND_DEMO === "1"
    : process.env.MAILBRIDGE_LOCAL_DEMO === "1";
  if (localDemo && (!localDemoFlagEnabled || config.server.bind_host !== "127.0.0.1")) {
    throw new Error("Synthetic demo requires its explicit mode flag and a 127.0.0.1 bind");
  }
  const app = createMcpExpressApp({ host: config.server.bind_host, allowedHosts: config.server.allowed_hosts });
  const activeConnections = new Set<() => Promise<void>>();

  app.disable("x-powered-by");
  app.use((request, response, next) => securityHeaders(request, response, next, Boolean(localDemo)));
  if (privateApp) {
    app.use("/api", createSettingsRouter({ config, store: privateApp.store, sessions: privateApp.sessions, tester: privateApp.tester }));
  }
  if (localDemo) {
    const renderDemo = (_request: Request, response: Response): void => {
      const session = localDemo.sessions.issue(localDemo.userKey);
      response.type("html").send(mailbridgeWidgetHtml({
        localDemo: true,
        safeSendDemo: localDemo.safeSend,
        bootstrap: {
          settingsApiUrl: `${config.server.public_base_url.replace(/\/$/, "")}/api`,
          token: session.token,
          csrf: session.csrf,
        },
      }));
    };
    app.get(["/", "/widget"], renderDemo);
    app.get("/local-demo/status", (_request, response) => response.json({
      mode: localDemo.safeSend ? "LOCAL SAFE SEND STAGING" : "LOCAL SYNTHETIC DEMO",
      real_mailboxes_connected: 0,
      smtp: false,
      write_tools: localDemo.safeSend,
      synthetic_send: localDemo.safeSend,
      synthetic_send_count: localDemo.syntheticSendCount(),
    }));
    app.use("/api", createSettingsRouter({
      config,
      store: localDemo.store,
      sessions: localDemo.sessions,
      tester: localDemo.tester,
      localDemo: true,
    }));
  }
  app.use(createRateLimiter(config.server.rate_limit.window_ms, config.server.rate_limit.max_requests));
  app.use(originGuard(config.server.allowed_origins));
  app.use(express.json({ limit: config.server.request_max_bytes, type: ["application/json", "application/*+json"] }));

  app.get("/health", (_request, response) => {
    response.json({ status: "ok", service: "mailbridge-mcp", version: config.server.version });
  });
  if (config.auth.mode !== "disabled_dev") {
    app.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"], (_request, response) => {
      response.json(protectedResourceMetadata(config));
    });
  }
  app.get("/docs", (_request, response) => {
    response.json({
      service: "mailbridge-mcp",
      version: config.server.version,
      access: "private",
      scopes: config.auth.scopes,
      write_tools: localDemo?.safeSend === true || process.env.MAILBRIDGE_ALLOW_SEND === "true",
      attachment_content: "read_only_bounded",
    });
  });
  app.all("/mcp", createAuthMiddleware(config), async (request, response) => {
    // The SDK requires a fresh transport for every request in stateless mode.
    // A fresh MCP server keeps protocol state isolated between callers as well.
    const auth = (request as Request & { auth?: AuthInfo }).auth;
    const identity = privateApp ? oauthIdentity(auth, config) : undefined;
    const userKey = privateApp && identity ? privateApp.userKeys.derive(identity) : undefined;
    const scoped = privateApp && userKey
      ? privateApp.services.create(userKey)
      : localDemo
        ? localDemo.services.create()
        : undefined;
    const mcpService = scoped?.service ?? service;
    if (!mcpService) {
      response.status(500).json({ error: "mail_service_unavailable" });
      scoped?.dispose();
      return;
    }
    const widget: MailBridgeWidgetOptions | undefined = privateApp && userKey ? {
      settingsApiUrl: `${config.server.public_base_url.replace(/\/$/, "")}/api`,
      widgetOrigin: config.app.widget_origin,
      issueSettingsSession: (extra) => {
        const toolIdentity = oauthIdentity(extra.authInfo, config);
        const toolUserKey = privateApp.userKeys.derive(toolIdentity);
        if (toolUserKey !== userKey) throw new Error("MCP identity changed during request");
        return privateApp.sessions.issue(userKey, toolIdentity.expires_at);
      },
    } : localDemo ? {
      settingsApiUrl: `${config.server.public_base_url.replace(/\/$/, "")}/api`,
      widgetOrigin: config.app.widget_origin,
      localDemo: true,
      widgetHtml: () => mailbridgeWidgetHtml({ localDemo: true, safeSendDemo: localDemo.safeSend }),
      issueSettingsSession: () => localDemo.sessions.issue(localDemo.userKey),
    } : undefined;
    const mcp = createMailBridgeMcpServer(
      mcpService,
      false,
      widget,
      scoped?.writer,
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    let cleanupPromise: Promise<void> | undefined;
    const cleanup = (): Promise<void> => {
      activeConnections.delete(cleanup);
      cleanupPromise ??= mcp.close().finally(() => scoped?.dispose());
      return cleanupPromise;
    };
    activeConnections.add(cleanup);
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

  const httpServer = app.listen(config.server.port, config.server.bind_host);
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      httpServer.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      httpServer.off("error", onError);
      resolve();
    };
    httpServer.once("error", onError);
    httpServer.once("listening", onListening);
  });
  const address = httpServer.address();
  logger.info(
    { bind_host: config.server.bind_host, port: typeof address === "object" && address ? address.port : config.server.port },
    "http_transport_started",
  );
  const close = async (): Promise<void> => {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    await Promise.allSettled([...activeConnections].map((cleanup) => cleanup()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    privateApp?.close();
    localDemo?.close();
  };
  const shutdown = (): void => {
    void close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return { server: httpServer, close };
}

function securityHeaders(_request: Request, response: Response, next: NextFunction, localDemo = false): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    localDemo
      ? "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'"
      : "default-src 'none'; frame-ancestors 'none'",
  );
  next();
}

function originGuard(allowedOrigins: string[]) {
  const allow = new Set(allowedOrigins);
  return (request: Request, response: Response, next: NextFunction): void => {
    const origin = request.header("origin");
    if (origin && !allow.has(origin)) {
      response.status(403).json({ error: "origin_not_allowed" });
      return;
    }
    next();
  };
}
