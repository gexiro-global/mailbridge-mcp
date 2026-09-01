# Security policy

## Supported versions

Security fixes target the latest published release and the current `main`
branch. Older release lines may not receive backports. Confirm the affected
version privately before sharing reproduction details.

## Reporting

Use [GitHub private vulnerability reporting](https://github.com/gexiro-global/mailbridge-mcp/security/advisories/new).
Never open a public issue containing
credentials, tokens, private keys, real email content, mailbox addresses,
production hostnames or unredacted logs.

Maintainers aim to acknowledge a complete private report within seven calendar
days, but this is a community-supported project and the target is not an uptime
or remediation guarantee. Reports are triaged by reproducibility, affected
versions, exploitability, impact, and safe deployment assumptions. Remediation
and release timing depend on severity and complexity; the reporter receives
status updates when practical.

Keep technical details private until a maintainer confirms that a fix or safe
disclosure plan is ready. The project supports coordinated disclosure and will
credit reporters who want public credit, but it does not promise a bounty,
embargo deadline, or acceptance of unsafe testing against third-party systems.

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

These controls reduce known risks but are not a guarantee that a deployment is
secure. Email and attachments remain untrusted input, and each operator must
validate its own OAuth, proxy, network, provider and backup configuration.

## Operator responsibilities

Protect the database and all active application-key versions, use an egress
allowlist, redact reverse-proxy logs, patch dependencies, test restores and
rotate provider credentials after suspected exposure. MailBridge is not an
authorization server and does not make an unsafe IdP configuration safe.
