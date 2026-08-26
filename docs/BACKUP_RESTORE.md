# Backup and restore

MailBridge stores account metadata, encrypted credential envelopes, drafts,
policies and redacted audit metadata in SQLite. Encryption keys remain outside
the database, so a usable backup requires both components.

1. Create a consistent SQLite snapshot with the SQLite Online Backup API or
   `sqlite3 .backup`; do not copy a live database or copy WAL/SHM separately.
2. Verify `PRAGMA integrity_check` on the snapshot.
3. Back up the referenced application key files to a separate encrypted vault.
4. Record the MailBridge version and `credential_key_version` without recording
   key values, mail credentials or mailbox hosts.
5. Test restore in an isolated environment and run read-only health checks.

Restore the database and matching key versions with permissions restricted to
the MailBridge service account. A missing key is intentionally unrecoverable.
Never put a database snapshot, key, app password or migration vault in Git.
