# Security policy

## Supported version

The latest release and current `main` branch are supported.

## Reporting

Use GitHub private vulnerability reporting. Never open a public issue containing
credentials, tokens, private keys, real email content, mailbox addresses,
production hostnames or unredacted logs.

## Security invariants

- IMAP reads use `EXAMINE` and `BODY.PEEK`; no read tool changes flags.
- Credentials are encrypted with AES-256-GCM using a key outside SQLite.
- OAuth identities are pseudonymized and data is scoped per `(issuer, subject)`.
- Returned email and attachment content is labeled untrusted and bounded.
- Remote production fails closed without HTTPS, validated OAuth and an explicit
  subject allowlist.
- Sending is absent unless `MAILBRIDGE_ALLOW_SEND=true`; every mailbox also has
  a separate disabled/draft-only/direct policy.
- Draft-only sending requires an exact draft version and a short-lived one-time
  confirmation. Unknown SMTP outcomes are never retried automatically.
- The emergency admin panel is disabled by default and may bind only to loopback.

Release archives include SHA-256 checksums, a CycloneDX SBOM and GitHub
provenance attestations. See [THREAT_MODEL.md](THREAT_MODEL.md).

## Operator responsibilities

Protect the database and all active application-key versions, use an egress
allowlist, redact reverse-proxy logs, patch dependencies, test restores and
rotate provider credentials after suspected exposure. MailBridge is not an
authorization server and does not make an unsafe IdP configuration safe.
