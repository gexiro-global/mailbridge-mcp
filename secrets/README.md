# Secrets

This directory is intentionally empty in source control.

For local development, create one file per configured secret reference. The
filename must match the reference exactly and may contain only letters, digits,
`.` `_` or `-`. Store the value as the only line in the file.

Required for ChatGPT Apps SDK mode:

- `mailbridge_credential_master_key` (exactly 32 random bytes, base64url encoded)
- `mailbridge_user_key_hmac` (at least 32 random bytes, base64url encoded)
- `mailbridge_fixed_owner_user_key` (optional opaque owner key for a
  one-operator OAuth cutover without rewriting existing credential envelopes)
- `mailbridge_id_hmac_key` (at least 32 random bytes, base64url encoded)
- `panel_operator_password` (long unique operator password)
- `panel_session_hmac_key` (at least 32 random bytes, different from the MCP key)

Prefixing an application key with `base64url:` is accepted. Never reuse the
three application keys. The credential master key remains outside the database.

Never commit these files. In production, mount secrets read-only so that only
the non-root service UID/GID can read them. Do not make them world-readable and
do not place credentials in `.env`, prompts, logs, Wiki, or URLs.

Exception: the separately started admin panel may receive write access to this
dedicated directory for explicit Replace/Rotate operations. The MCP process
must keep its mount read-only. The panel writes mode `0600`, rejects symlink
targets and never returns a stored value.
