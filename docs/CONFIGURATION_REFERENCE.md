# Configuration reference

MailBridge separates development and production configuration:

- `config/mailboxes.example.yaml` → `config/mailboxes.yaml` through
  `npm run setup`; loopback development only;
- `config/mailboxes.production.example.yaml` →
  `config/mailboxes.production.yaml` through `npm run setup:production`;
  intentionally fail-closed until every production placeholder is replaced.

Apps SDK mailboxes are created in the widget and stored per OAuth user; they are
not written to YAML. Static YAML mailbox entries are intended only for legacy or
controlled operator configurations.

## Server and privacy

`server.public_base_url`, `allowed_hosts` and `allowed_origins` must name the
actual reviewed deployment. Production rejects HTTP, placeholder hosts, an
unsafe listener/auth combination and an empty OAuth subject allowlist. Configure
request, snippet, body, source and attachment bounds for the deployment's risk
profile. A 10 MiB outgoing attachment expands under base64; the supplied
templates therefore allow 16 MiB per JSON request. Keep reverse-proxy limits in
sync, and reduce this value when Safe Send attachments are not required.

`privacy.audit_retention_days` bounds the emergency admin audit view; it is not
a physical-deletion guarantee for the database, log file or backups. Mailbox-
provider, reverse-proxy, backup and model-provider retention are separate.

## Application state

| Field | Purpose |
|---|---|
| `app.enabled` | enables user-scoped Apps SDK HTTP mode |
| `app.database_path` | SQLite state path on a persistent private volume |
| `app.widget_origin` | Apps SDK widget sandbox origin |
| `credential_master_key_secret` | 32-byte base64url AES envelope-key reference |
| `credential_key_version` | key version stored with each envelope |
| `user_key_mode` | `oauth_subject` for normal deployments; fixed owner is migration-only |
| `user_key_hmac_secret` | HMAC key for pseudonymous OAuth identity |
| `message_id_hmac_secret` | master key for per-user stable message IDs |
| `settings_session_ttl_ms` | 30–600 second one-time settings session |
| `max_mailboxes_per_user` | per-user limit from 1 to 100 |

Application keys must be independent base64url values stored outside YAML,
environment variables, logs, database and container image. See
`secrets/README.md`. The production doctor checks referenced file names and
presence without reading values.

For source-checkout use, setup keeps the host secret directory at `0700` and
files at `0600`. For Compose, the network-disabled `mailbridge-secret-init`
service copies those files into the private `mailbridge_secrets` named volume
as UID/GID 10001 with file mode `0400`; its `0710` directory permits the runtime
group to traverse but not enumerate it. The main service mounts that volume
read-only. This preserves host least privilege without assuming that the host
user and container have the same UID. See [Deployment](DEPLOYMENT.md) for
startup and rotation commands.

## OAuth and network

Set exact `issuer`, `audience`, `jwks_uri`, scopes, allowed hosts/origins and a
production subject allowlist. `user_key_mode: oauth_subject` isolates records by
validated issuer/subject. Changing identity claims can make existing records
appear under a different user; plan migrations before changing the IdP.

Mailbox hostnames are untrusted operator/user input. Runtime resolution must
reject loopback, private, link-local and metadata destinations, including unsafe
DNS results. Infrastructure egress rules should independently enforce the same
boundary.

## Safe Send

SMTP credentials share the encrypted mailbox credential envelope. Sending is
disabled unless the process environment contains the exact value
`MAILBRIDGE_ALLOW_SEND=true`. Each mailbox still requires `send_enabled=true`
and a server-side policy. The recommended policy is `draft_only` with required
confirmation. See [Safe Send](SAFE_SEND.md).

Outgoing draft attachments are encrypted and bounded by fixed application
limits. Optional Sent-copy persistence is separately controlled by
`MAILBRIDGE_SAVE_SENT_COPY=true` and the comma-separated exact mailbox IDs in
`MAILBRIDGE_SENT_COPY_MAILBOX_IDS`. An empty allowlist enables no mailbox.
Sent-copy uses only a server-discovered selectable special-use `\\Sent` folder
and reports its result independently from SMTP acceptance.

## Emergency panel

`panel.enabled=false` is the default. The panel is not required for normal Apps
SDK configuration, must never be exposed publicly and may bind only to loopback.
Enabling it adds password and session-key secret references that the production
doctor must find.
