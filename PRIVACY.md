# Privacy

MailBridge is self-hosted. The project maintainers do not receive mailbox data,
credentials, prompts or telemetry from a user's deployment.

The connector processes mailbox configuration, encrypted credentials, message
metadata and content requested by the user, encrypted drafts, Safe Send state
and redacted audit metadata. Data remains in the operator-controlled SQLite
database and is sent to the connected MCP client only when a tool call requires
it. MailBridge sets `Cache-Control: no-store` and provides no analytics exporter.

Passwords are accepted only by the Settings API, encrypted before storage and
never returned. Replacing credentials overwrites the stored envelope; deleting
an account deletes its associated connector records according to the local
deployment's retention policy.

Operators are responsible for legal basis, user notices, access control,
retention, backups, deletion requests and any third-party OAuth/hosting logs.
Do not put real mail or secrets in public issues.
