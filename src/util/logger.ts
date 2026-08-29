import pino from "pino";

export const logger = pino(
  {
    level: process.env.MAILBRIDGE_LOG_LEVEL ?? "info",
    redact: {
      paths: [
        "password",
        "username",
        "token",
        "authorization",
        "req.headers.authorization",
        "body",
        "snippet",
        "subject",
        "attachment_content",
        "content_base64",
        "attachments[*].content_base64",
        "draft.attachments[*].content_base64",
      ],
      censor: "[REDACTED]",
    },
    base: { service: "mailbridge-mcp" },
  },
  // MCP stdio reserves stdout for JSON-RPC messages.
  pino.destination(2),
);
