# Threat model

## Assets

- IMAP/SMTP credentials and OAuth access tokens;
- private message content, attachments and correspondent metadata;
- credential master keys, user/message HMAC keys and encrypted drafts;
- mailbox policy, rate-limit and send-audit state.

## Principal threats and controls

| Severity | Threat | Primary controls | Residual risk |
|---|---|---|---|
| Critical | credential theft | AES-GCM envelopes, keys outside DB/image/Git, non-root process, redaction | host compromise |
| Critical | unauthorized mailbox access | exact issuer/audience/signature/expiry/scope/subject validation | unsafe IdP configuration |
| Critical | unauthorized email send | global gate, per-mailbox enablement, policy, confirmation, idempotency | operator enables unsafe direct policy |
| High | prompt injection from email | untrusted-data labels, no instruction following, bounded output, server-side send gates | model may misinterpret content |
| High | IMAP mutation | separate read service, `EXAMINE`, `BODY.PEEK`, invariant tests | provider/library defect |
| High | duplicate or ambiguous send | exact draft versions, one-time confirmation, idempotency, no retry after unknown outcome | final delivery remains outside connector control |
| High | malicious MIME or oversized content | source/body/attachment limits, parser isolation, timeouts | parser attack surface |
| High | SSRF/DNS rebinding | hostname checks plus required egress/DNS policy | missing host firewall |
| Medium | cross-tenant access | issuer/subject-derived user key and scoped SQL | application/SQLite defect |
| Medium | resource exhaustion | mailbox/folder/result limits, concurrency bounds, timeouts, rate limiting | expensive provider search |
| Medium | sensitive logging | structured redacted logs, no body/token/credential fields | operator changes logging |

All MCP arguments, OAuth tokens, Host/Origin headers, provider responses, MIME,
HTML, filenames and YAML configuration are untrusted input. Email content is data,
never server instruction.
