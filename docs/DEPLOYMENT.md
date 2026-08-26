# Deployment

## Supported topologies

1. **Local evaluation:** loopback listener, `disabled_dev`, synthetic data or
   user-owned test mailboxes. Never expose this mode to a network.
2. **Private connector:** loopback-only MailBridge plus an outbound Secure MCP
   Tunnel. Suitable when the Settings API is also available to the widget through
   an approved private HTTPS path.
3. **Remote self-hosted:** stable HTTPS reverse proxy, OAuth 2.1, persistent
   encrypted storage and one or more OAuth subjects.

## Production requirements

- Node.js 24 or the supplied non-root container;
- `npm ci --ignore-scripts`, a clean build and all checks passing;
- TLS 1.2+ at a stable HTTPS origin;
- OAuth Authorization Code + PKCE with exact issuer, audience, JWKS and resource;
- protected-resource metadata at `/.well-known/oauth-protected-resource`;
- an explicit `auth.allowed_subjects` allowlist;
- application secrets mounted read-only outside Git and the image;
- a persistent private volume for SQLite and tested backup/restore;
- outbound network policy allowing only required IMAP/SMTP destinations and
  blocking private, link-local and metadata endpoints;
- access logs disabled or redacted for `/mcp` and `/api`.

The connector validates access tokens but does not implement an authorization
server. Configure an OAuth 2.1 provider that issues tokens for the exact MCP
resource. ChatGPT must be registered as an allowed OAuth client according to the
provider's supported client-registration model.

## Container start

```bash
npm run setup
docker compose build --pull
docker compose up -d
curl --fail http://127.0.0.1:3091/health
```

The supplied compose file binds only to loopback, drops Linux capabilities,
uses a read-only root filesystem and keeps SQLite in a named volume. Edit
`config/mailboxes.yaml` before remote deployment; the example hostnames are
deliberately invalid.

## Rollback

Keep the prior image, SQLite online-backup snapshot and every active credential
master-key version. On failure, stop only MailBridge, restore the compatible
image/database/key set, start MailBridge and run read-only health checks. Never
restore deleted credentials without a separate operator decision.
