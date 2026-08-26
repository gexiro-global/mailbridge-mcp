# Configuration reference

Infrastructure configuration is loaded from `config/mailboxes.yaml`. Apps SDK
mailboxes are created in the widget and stored per OAuth user; they are not
written to YAML.

## Application state

| Field | Purpose |
|---|---|
| `app.enabled` | enables user-scoped Apps SDK HTTP mode |
| `app.database_path` | SQLite state path on a persistent private volume |
| `app.widget_origin` | Apps SDK widget sandbox origin |
| `credential_master_key_secret` | 32-byte base64url AES envelope key reference |
| `credential_key_version` | key version stored with each envelope |
| `user_key_mode` | `oauth_subject` for normal deployments; fixed owner is migration-only |
| `user_key_hmac_secret` | HMAC key for pseudonymous OAuth identity |
| `message_id_hmac_secret` | master key for per-user stable message IDs |
| `settings_session_ttl_ms` | 30–600 second one-time settings session |
| `max_mailboxes_per_user` | limit from 1 to 100 |

Application keys must be independent base64url values stored outside YAML,
environment variables, logs and the database. See `secrets/README.md`.

## OAuth and network

Set exact `issuer`, `audience`, `jwks_uri`, scopes, allowed hosts/origins and an
explicit production subject allowlist. Production rejects `disabled_dev`, HTTP,
loopback public URLs and empty subject allowlists.

## Safe Send

SMTP credentials share the encrypted mailbox credential envelope. Sending is
disabled unless the process environment contains the exact value
`MAILBRIDGE_ALLOW_SEND=true`. Each mailbox still requires `send_enabled=true`
and a server-side policy. The recommended policy is `draft_only` with required
confirmation.

## Emergency panel

`panel.enabled=false` is the default. The panel is not required for normal Apps
SDK configuration, must never be exposed publicly and may bind only to loopback.
