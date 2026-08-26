# Deployment

MailBridge has separate local and production paths. Do not run the loopback
development configuration in a production container and do not expose
`disabled_dev` through a reverse proxy or tunnel.

Current OpenAI references: [Deploy your app](https://developers.openai.com/apps-sdk/deploy/)
and [Connect from ChatGPT](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt/).

## Supported topologies

1. **Synthetic evaluation:** loopback listener and synthetic data. No real IMAP
   or SMTP connection.
2. **Local connector:** source checkout, loopback listener and
   `disabled_dev`; for a controlled single-host evaluation only.
3. **Private connector:** loopback-only MailBridge plus an outbound Secure MCP
   Tunnel. The browser-facing Settings API still needs an approved private HTTPS
   path if users configure accounts across devices.
4. **Remote self-hosted:** stable HTTPS reverse proxy, OAuth 2.1, persistent
   encrypted storage and one or more explicitly allowed OAuth subjects.

The bundled SQLite state store supports one active MailBridge node. Do not start
horizontal replicas against copied or independent SQLite databases. Replicas
require a designed shared database, settings-session store, rate-limit store and
tested migration strategy.

## Local source-checkout path

```bash
npm ci --ignore-scripts
npm run setup
npm run build
npm run doctor
npm start
```

This generates `config/mailboxes.yaml`, binds to loopback and uses development-
only authentication. It is not the input for the production Compose service.

## Production requirements

- Node.js 24 for build/setup or the supplied non-root runtime image;
- a clean checkout, `npm ci --ignore-scripts` and all checks passing;
- TLS 1.2+ at one stable HTTPS origin;
- OAuth Authorization Code + PKCE with exact issuer, audience, JWKS and resource;
- protected-resource metadata at `/.well-known/oauth-protected-resource`;
- an explicit `auth.allowed_subjects` allowlist;
- a reverse proxy that preserves the required MCP streaming behavior and
  forwards only intended MailBridge paths;
- browser access to the Settings API through a CSP-allowed HTTPS origin;
- host application secrets kept outside Git/image at directory mode `0700` and
  file mode `0600`; Compose provisions them into its private runtime volume;
- a persistent private volume for SQLite and tested online-backup/restore;
- outbound network policy allowing only required IMAP/SMTP destinations and
  blocking loopback, private, link-local and cloud-metadata targets supplied as
  mailbox hosts;
- disabled or redacted access logs for `/mcp` and `/api` routes;
- `MAILBRIDGE_ALLOW_SEND=false` unless Safe Send passed a separate review.

MailBridge validates access tokens but does not implement an authorization
server. Configure an OAuth 2.1 provider that issues tokens for the exact MCP
resource. ChatGPT must be registered according to the provider's supported
client-registration model.

## Production preflight

From a clean source checkout:

```bash
npm ci --ignore-scripts
npm run check
npm run setup:production
npm run build
npm run doctor:production
```

`npm run setup:production` is idempotent. It creates
`config/mailboxes.production.yaml`, independent application-key files and the
data directory without printing secret values or overwriting an existing file.
The template is intentionally invalid for real production: replace every
`.example.invalid` OAuth/hostname value and populate an exact subject allowlist.

The doctor validates the production safety profile and checks that every
referenced secret file exists without reading or printing its value. Do not
continue unless it returns `ready: true`. A passing doctor is preflight evidence,
not proof that the IdP, reverse proxy or mailbox provider works end to end.

## Production container start

The Compose service is behind an explicit `production` profile and consumes
only `config/mailboxes.production.yaml`:

```bash
docker compose --profile production build --pull
docker compose --profile production up -d
curl --fail http://127.0.0.1:3091/health
docker compose --profile production ps
```

The compose file publishes the container only on host loopback, drops Linux
capabilities, uses a read-only root filesystem and persists SQLite in a separate
named volume. Terminate public TLS and enforce OAuth/routing policy at the
reviewed reverse proxy; do not change the container port publication to
`0.0.0.0` as a shortcut.

On first start, Compose automatically runs `mailbridge-secret-init` and starts
MailBridge only after that dependency succeeds. Compose does not bind-mount the
host secret directory into the long-running UID 10001 process. That would fail
safely on Linux when setup was run by a different host UID and the files have
the required `0600` mode. Instead, the initializer runs once with networking
disabled, a read-only root filesystem and only `CHOWN` and `DAC_READ_SEARCH`.
It copies regular, safe-named, non-empty secret files into the private
`mailbridge_secrets` named volume, sets directory mode `0710` with group 10001,
file mode `0400` with ownership `10001:10001`, and never prints values. The main
service can traverse but not list that directory, mounts it read-only, runs as
UID/GID 10001 and retains no Linux capability.

After rotating a host secret, rerun the one-shot provisioning step and then
restart only MailBridge:

```bash
docker compose --profile production run --rm mailbridge-secret-init
docker compose --profile production restart mailbridge
```

Do not work around permission failures with `chmod 0644`, a world-readable
directory, a root runtime process or plaintext environment variables. Docker
administrators can access named volumes and remain inside the deployment's
trusted-computing base.

Do not rotate a credential master key by replacing its file alone. Existing
encrypted envelopes require the matching versioned key or an explicitly tested
rewrap/migration; preserve the prior key until restore and rollback checks pass.

After startup, verify protected-resource metadata, an unauthorized request, a
valid OAuth connection, settings access, mailbox isolation and a controlled
`BODY.PEEK` unread-preservation test. Verify from the correct client/device;
localhost success alone does not prove cross-device settings access.

## Safe Send production gate

Keep `MAILBRIDGE_ALLOW_SEND=false` for initial acceptance. If sending is later
approved, follow [Safe Send](SAFE_SEND.md), configure one operator-controlled
mailbox at a time, test the policy-negative paths first and use a deliberately
selected real canary recipient. Never infer SMTP authorization from IMAP health.

## Rollback

Before a change, retain the prior image digest, a verified SQLite online-backup
snapshot and every active credential master-key version. On failure:

1. prevent new MailBridge traffic;
2. stop only the MailBridge service;
3. restore the compatible image, database and key set;
4. start MailBridge with sending disabled;
5. run OAuth, tenant-isolation and read-only health checks;
6. re-enable traffic only after the prior state is verified.

Never restore deleted credentials or re-enable sending without a separate
operator decision. Never copy a live SQLite database or WAL/SHM files with a
normal file copy; use the SQLite Online Backup API or `sqlite3 .backup`.
