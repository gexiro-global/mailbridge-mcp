# MailBridge MCP

MailBridge is a self-hosted ChatGPT App and MCP server for working with multiple
IMAP mailboxes from one conversation. Version 2 is a functional implementation,
not a mock: users can add their own accounts in the app widget, search every
selectable folder, read messages with IMAP `EXAMINE` + `BODY.PEEK`, inspect
threads and attachments, and optionally use a policy-gated Safe Send flow.

This repository contains no hosted MailBridge service, mailbox credentials, or
operator data. Each user or organization deploys and secures its own connector.

## What is included

- multiple user-scoped IMAP accounts in encrypted SQLite storage;
- verified TLS and hostname validation with no insecure fallback;
- 11 read-only tools covering mailboxes, health, folders, recent mail, native
  IMAP search, cross-mailbox knowledge search, messages, threads and attachments;
- attachment downloads bounded to 25 MiB and returned as untrusted data;
- an Apps SDK settings widget that never returns stored passwords;
- OAuth resource-server validation for remote deployments;
- an optional 12-tool Safe Send layer with encrypted drafts, idempotency,
  persistent rate limits, domain policy and one-time explicit confirmation;
- local synthetic read-only and Safe Send demos that never open IMAP or SMTP.

Read operations never call `STORE`, `APPEND`, `MOVE`, `COPY` or `EXPUNGE` and do
not mark messages as read. SMTP is absent unless the global feature gate and the
selected mailbox are both explicitly enabled.

## Quick verification — no real mailbox

Requirements: Node.js 24 and npm 11.

```bash
npm ci --ignore-scripts
npm run check
npm run build
npm run start:local
```

In a second terminal:

```bash
npm run smoke
```

The demo listens only on `127.0.0.1:3091` and is visibly marked synthetic.

## Configure real mailboxes

```bash
npm run setup
```

The idempotent setup command creates `config/mailboxes.yaml`, three independent
application keys and `runtime/data`. It prints no key values and never overwrites
existing secrets. Review the generated config, then run:

```bash
npm run build
npm start
```

For local Developer Mode, connect ChatGPT to the `/mcp` endpoint through a
supported private tunnel. For an always-on or multi-user deployment, put the
connector behind a stable HTTPS origin and OAuth 2.1 authorization server. See
[deployment](docs/DEPLOYMENT.md), [authentication](docs/AUTHENTICATION.md) and
[ChatGPT setup](docs/CHATGPT_SETUP.md).

Open MailBridge in ChatGPT and use the mailbox settings widget to enter the IMAP
hostname, port, TLS mode, login and an app-specific password. The connector tests
TLS and authentication before saving the encrypted credential. Passwords cannot
be displayed after save; they can only be replaced.

## Safe Send is opt-in

The default is read-only:

```text
MAILBRIDGE_ALLOW_SEND=false
```

To enable sending, an administrator must separately configure SMTP for a mailbox,
select a Safe Send policy, and set `MAILBRIDGE_ALLOW_SEND=true`. Draft-only mode
requires preview, validation, a short-lived one-time confirmation and the exact
draft version. Direct send remains rejected unless that mailbox explicitly uses
`direct_allowed`.

See [Safe Send](docs/SAFE_SEND.md). Do not use a normal Google password; use an
app password or a provider OAuth implementation supported by your deployment.

## Deployment boundaries

- Local `disabled_dev` authentication is accepted only on loopback outside
  production.
- Remote or production mode fails closed without HTTPS, OAuth, an exact audience
  and an explicit subject allowlist.
- Secure MCP Tunnel provides private MCP connectivity; it is not a general proxy
  for arbitrary browser routes. The widget's Settings API still needs a browser-
  reachable, CSP-allowed HTTPS origin for cross-device configuration.
- Single-node SQLite is supported. Horizontal replicas require a shared database
  and shared settings-session storage before they are safe.

## Security and privacy

Read [SECURITY.md](SECURITY.md), [PRIVACY.md](PRIVACY.md), the
[threat model](THREAT_MODEL.md) and [backup/restore guide](docs/BACKUP_RESTORE.md)
before connecting production mailboxes. Report vulnerabilities privately as
described in the security policy.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
