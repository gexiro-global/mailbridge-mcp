import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { MailBridgeConfig } from "../config/schema.js";

type AuthenticatedRequest = Request & { auth?: AuthInfo };

export function createAuthMiddleware(config: MailBridgeConfig) {
  const jwks = createRemoteJWKSet(new URL(config.auth.jwks_uri), {
    timeoutDuration: 5000,
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
  });

  return async (request: AuthenticatedRequest, response: Response, next: NextFunction): Promise<void> => {
    if (config.auth.mode === "disabled_dev") {
      request.auth = {
        token: "[local-dev-token-not-forwarded]",
        clientId: "local-dev",
        scopes: config.auth.scopes,
        resource: new URL(config.auth.audience),
        extra: { subject: "local-dev", issuer: config.auth.issuer },
      };
      next();
      return;
    }

    const cloudflareAccess = config.auth.mode === "cloudflare_access";
    const token = cloudflareAccess
      ? request.header("cf-access-jwt-assertion") ?? null
      : bearerToken(request.header("authorization"));
    if (!token) {
      unauthorized(response, config, "invalid_token");
      return;
    }
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: config.auth.issuer,
        audience: cloudflareAccess ? requiredAccessAudience(config) : config.auth.audience,
        algorithms: cloudflareAccess ? ["RS256"] : ["RS256", "PS256", "ES256", "EdDSA"],
        clockTolerance: 5,
        requiredClaims: ["sub", "exp", "iat", "aud", "iss"],
      });
      const scopes = cloudflareAccess ? [...config.auth.scopes] : tokenScopes(payload);
      if (!cloudflareAccess && !scopes.some((scope) => config.auth.scopes.includes(scope))) {
        unauthorized(response, config, "insufficient_scope");
        return;
      }
      if (config.auth.allowed_subjects.length > 0 && !config.auth.allowed_subjects.includes(payload.sub ?? "")) {
        unauthorized(response, config, "invalid_token");
        return;
      }
      request.auth = {
        token: cloudflareAccess ? "[validated-cloudflare-access-jwt]" : token,
        clientId: cloudflareAccess
          ? "cloudflare-access-user"
          : stringClaim(payload, "client_id") ?? stringClaim(payload, "azp") ?? payload.sub ?? "unknown",
        scopes,
        ...(payload.exp ? { expiresAt: payload.exp } : {}),
        resource: new URL(config.auth.audience),
        extra: { subject: payload.sub, issuer: payload.iss },
      };
      next();
    } catch {
      unauthorized(response, config, "invalid_token");
    }
  };
}

function requiredAccessAudience(config: MailBridgeConfig): string {
  if (!config.auth.access_audience) throw new Error("Cloudflare Access application AUD is not configured");
  return config.auth.access_audience;
}

export function protectedResourceMetadata(config: MailBridgeConfig) {
  return {
    resource: config.auth.audience,
    authorization_servers: [config.auth.issuer],
    scopes_supported: config.auth.scopes,
    bearer_methods_supported: ["header"],
    resource_documentation: `${config.server.public_base_url.replace(/\/$/, "")}/docs`,
  };
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  return match?.[1] ?? null;
}

function tokenScopes(payload: JWTPayload): string[] {
  const raw = payload.scope ?? payload.scp;
  if (typeof raw === "string") return raw.split(/\s+/).filter(Boolean);
  if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === "string");
  return [];
}

function stringClaim(payload: JWTPayload, name: string): string | null {
  const value = payload[name];
  return typeof value === "string" ? value : null;
}

function unauthorized(response: Response, config: MailBridgeConfig, error: string): void {
  const metadata = `${config.server.public_base_url.replace(/\/$/, "")}/.well-known/oauth-protected-resource`;
  response.setHeader(
    "WWW-Authenticate",
    `Bearer resource_metadata="${metadata}", scope="${config.auth.scopes.join(" ")}", error="${error}"`,
  );
  response.status(error === "insufficient_scope" ? 403 : 401).json({ error });
}
