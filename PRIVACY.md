# Privacy

Last updated: 2026-08-26

## Scope and roles

MailBridge is self-hosted software. The project maintainers do not operate a
shared MailBridge service and do not receive mailbox data, credentials, prompts
or telemetry from a user's deployment.

The person or organization operating a deployment controls its processing and
is responsible for its own privacy notice, legal basis, access control,
retention, backups, deletion requests and third-party services. This document
describes the software's default behavior; it is not a substitute for an
operator-specific privacy notice.

## Data processed

A deployment can process:

- mailbox configuration and user-scoped account identifiers;
- encrypted IMAP/SMTP credentials;
- message metadata and content requested through MCP tools;
- attachment metadata and bounded attachment payloads requested by the user;
- encrypted drafts, Safe Send state and provider delivery outcomes when sending
  is deliberately enabled;
- OAuth issuer/subject-derived pseudonymous user keys, settings sessions, rate-
  limit state and redacted operational audit metadata.

Email and attachment content is untrusted input. A connected MCP client receives
only data needed for the requested tool result, subject to configured bounds.

## Purpose and recipients

MailBridge uses the data to connect to user-authorized mailboxes, perform the
requested read operation, manage account settings and, if enabled, enforce and
execute Safe Send policy. Depending on the selected operation and deployment,
data may be disclosed to:

- the connected MCP client and its model provider;
- the operator's IMAP/SMTP or other configured mailbox provider;
- the operator's OAuth, reverse-proxy, hosting, logging and backup providers.

The project maintainers receive none of this data unless an operator
deliberately sends it in a support or security report. Do not do so unless it is
strictly necessary and appropriately redacted.

## Storage and retention

Account metadata, encrypted credential envelopes, encrypted drafts, settings
state, rate-limit state and redacted audit metadata remain in the operator-
controlled SQLite database and mounted secret storage. MailBridge sets
`Cache-Control: no-store` on sensitive responses and includes no analytics or
telemetry exporter.

The configured `privacy.audit_retention_days` value bounds the emergency admin
audit view; it is not by itself a guarantee of physical deletion from every
database, log or backup. Mail-provider copies, proxy/host logs, backups and data
already sent to a connected MCP client follow those systems' separate retention
policies. Deleting one mailbox removes its mailbox row, encrypted credential and
dependent Safe Send records, while redacted audit metadata may remain. “Delete
all application data” also removes that user's application audit and identity
records. Backups and downstream systems may require separate operator action.

## Credentials and security

Mailbox passwords are accepted only by the Settings API, encrypted before
storage and never returned for display. Replace credentials creates a new
encrypted envelope; the prior value cannot be retrieved through MailBridge.
Application keys must remain outside the database, repository and container
image. See [SECURITY.md](SECURITY.md) and [Backup and restore](docs/BACKUP_RESTORE.md).

## User and operator controls

Subject to the operator's identity and access policy, a user can list configured
mailboxes, inspect connection health, disable or delete a mailbox and replace
credentials without displaying the stored value. The operator can disconnect
the MCP app, revoke OAuth access, disable Safe Send, restrict network egress and
delete or restore local state under its own retention policy.

Privacy or data-rights requests for a deployed instance must go to that
deployment's operator. Repository questions can be opened without private data
through [GitHub Issues](https://github.com/gexiro-global/mailbridge-mcp/issues).
