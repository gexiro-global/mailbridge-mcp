# MailBridge MCP

[![CI](https://github.com/gexiro-global/mailbridge-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/gexiro-global/mailbridge-mcp/actions/workflows/ci.yml)
[![CodeQL](https://github.com/gexiro-global/mailbridge-mcp/actions/workflows/codeql.yml/badge.svg)](https://github.com/gexiro-global/mailbridge-mcp/actions/workflows/codeql.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white)](package.json)

MailBridge is a self-hosted ChatGPT App and MCP server for working with multiple
IMAP mailboxes from one conversation. It can search selectable folders, read
messages without setting `\Seen`, inspect threads and attachments, and expose
an optional, policy-gated Safe Send workflow.

This repository contains the software, not a hosted MailBridge service. It
contains no mailbox credentials, operator data, shared OAuth tenant or public
production endpoint. Each user or organization deploys and secures its own
connector.

MailBridge is an independent open-source project by Gexiro Global Enterprises
Ltd. It is not affiliated with, endorsed by or sponsored by OpenAI, Google,
Microsoft or any email provider.

## Capabilities

- multiple user-scoped IMAP accounts, with metadata in SQLite and credential
  envelopes encrypted by a key stored outside the database;
- TLS certificate and hostname verification, with no insecure fallback;
- 11 read-only tools for mailboxes, health, folders, recent mail, native IMAP
  search, cross-mailbox search, messages, threads and attachments;
- IMAP `EXAMINE` and `BODY.PEEK` for non-mutating reads;
- attachment retrieval bounded to 25 MiB and treated as untrusted content;
- an Apps SDK settings widget that never returns a stored password;
- OAuth resource-server validation for remote deployments;
- an optional 14-tool Safe Send layer with encrypted drafts, bounded outgoing
  attachments, idempotency, persistent rate limits, recipient-domain policy,
  explicit confirmation and independently gated Sent-copy receipts;
- synthetic read-only and Safe Send demos that open neither IMAP nor SMTP.

Read tools never call `STORE`, `APPEND`, `MOVE`, `COPY` or `EXPUNGE`. SMTP tools
are not registered unless both the process-wide feature gate and the selected
mailbox policy enable them. The optional Sent-copy component is not an MCP tool:
after SMTP acceptance it can append only the exact accepted MIME bytes to the
server-discovered special-use `\\Sent` folder, after a read-only Message-ID
duplicate check and only for an explicit mailbox allowlist.

“Read-only” describes operations on mailbox messages and flags. Adding,
replacing, disabling or deleting an account intentionally changes the user's
connector configuration and requires the separate `mail.settings.write` scope.

## Choose a deployment path

### 1. Synthetic evaluation from a source checkout

Use this first. It requires no mailbox account and makes no external mail
connection.

Requirements: Node.js 24 and npm 11.

```bash
npm ci --ignore-scripts
npm run check
npm run start:local
```

In a second terminal:

```bash
npm run smoke
```

The demo listens only on `127.0.0.1:3091` and is visibly marked synthetic.

### 2. Local connector from a source checkout

```bash
npm ci --ignore-scripts
npm run setup
npm run build
npm run doctor
npm start
```

`npm run setup` is idempotent. It creates a loopback-only development
configuration, independent application-key files and `runtime/data` without
printing key values or overwriting existing secrets. Review
`config/mailboxes.yaml` and require `npm run doctor` to report `ready: true`
before connecting an account.

This path is for local evaluation and private single-host use. Its
`disabled_dev` authentication mode must never be exposed to a network or run as
production. For ChatGPT Developer Mode, connect `/mcp` through a supported
private tunnel. See [Connect to ChatGPT](docs/CHATGPT_SETUP.md).

### 3. Production Docker deployment

Production is a separate, fail-closed path. It requires a stable HTTPS origin,
an external OAuth 2.1 authorization server, an exact audience and subject
allowlist, persistent private storage, mounted secrets and a reverse proxy.

Do not reuse the local `mailboxes.yaml` development configuration. Follow the
preflight and exact commands in [Deployment](docs/DEPLOYMENT.md). The production
template intentionally contains invalid placeholders and must not be considered
ready until the production doctor passes.

On the first production Compose start, the network-disabled one-shot
`mailbridge-secret-init` service copies the host's `0700/0600` secret files into
a private named volume as UID/GID `10001` with file mode `0400`. The long-running
MailBridge container stays non-root and mounts that volume read-only. Do not make
host secrets world-readable to work around container permissions.

## Add mailbox accounts

Open MailBridge in ChatGPT and use its settings widget to enter the mailbox
label, email address, IMAP hostname, port, TLS mode, login and an app-specific
password. The connector tests TLS and authentication before saving the encrypted
credential. Stored passwords cannot be displayed; they can only be replaced or
deleted with the mailbox account.

Provider account policy differs. Use only credentials authorized by the mailbox
provider and deployment operator. Never use a normal Google account password.
MailBridge does not claim support for every provider or every provider-specific
OAuth onboarding flow.

## Safe Send is opt-in

The default is read-only:

```text
MAILBRIDGE_ALLOW_SEND=false
```

To enable sending, an administrator must separately configure SMTP for a
mailbox, select a Safe Send policy and set `MAILBRIDGE_ALLOW_SEND=true`.
Draft-only mode requires preview, validation, a short-lived one-time confirmation
and the exact draft version. Direct send remains rejected unless that mailbox
explicitly uses `direct_allowed`. Outgoing attachments are encrypted with the
draft and limited to 10 files, 10 MiB each and 18 MiB total; executable file
extensions are rejected.

A copy in the mailbox's Sent folder is independently fail-closed. It requires
`MAILBRIDGE_SAVE_SENT_COPY=true` and the exact mailbox ID in
`MAILBRIDGE_SENT_COPY_MAILBOX_IDS`. The receipt distinguishes SMTP acceptance
from `provider_saved`, `imap_appended`, `failed` and disabled states; it never
claims recipient delivery or read status.

See [Safe Send](docs/SAFE_SEND.md). Enabling Safe Send creates an external side
effect: the operator remains responsible for recipients, content, authorization
and provider limits.

## Important boundaries

- Secure MCP Tunnel provides private MCP connectivity; it is not a general
  browser-route proxy. The Settings API still needs a browser-reachable,
  CSP-allowed HTTPS origin for cross-device configuration.
- The supported embedded state store is single-node SQLite. Horizontal replicas
  need a shared database and shared settings-session storage.
- MailBridge is not an OAuth authorization server, hosted SaaS, email provider,
  backup product, compliance certification or guarantee against model error.
- The Apache-2.0 source code is free to use under [LICENSE](LICENSE). Hosting,
  domains, OAuth services, ChatGPT plans and mailbox-provider charges are not
  included and may cost money.
- A self-hosted custom MCP connection is not the same as a reviewed listing in
  the ChatGPT app directory. This repository does not claim directory approval.

## Documentation

- [Architecture](ARCHITECTURE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Authentication](docs/AUTHENTICATION.md)
- [Connect to ChatGPT](docs/CHATGPT_SETUP.md)
- [Configuration reference](docs/CONFIGURATION_REFERENCE.md)
- [Tool catalog](docs/TOOL_CATALOG.md)
- [Safe Send](docs/SAFE_SEND.md)
- [Backup and restore](docs/BACKUP_RESTORE.md)
- [Release process](docs/RELEASE_PROCESS.md)
- [Security policy](SECURITY.md) and [threat model](THREAT_MODEL.md)
- [Security and trust signals](docs/SECURITY-TRUST.md)
- [Governance](GOVERNANCE.md) and [maintainers](MAINTAINERS.md)
- [Privacy](PRIVACY.md), [support](SUPPORT.md) and [terms](TERMS.md)
- [Public launch readiness](docs/PUBLIC_LAUNCH_READINESS.md)

## Contributing and support

Start with synthetic data, follow [CONTRIBUTING.md](CONTRIBUTING.md), and never
post credentials or real mailbox content. Use
[GitHub private vulnerability reporting](https://github.com/gexiro-global/mailbridge-mcp/security/advisories/new)
for security reports and [GitHub Issues](https://github.com/gexiro-global/mailbridge-mcp/issues)
for reproducible non-security defects.

## License

Apache-2.0. See [LICENSE](LICENSE), [NOTICE](NOTICE) and [TERMS.md](TERMS.md).
