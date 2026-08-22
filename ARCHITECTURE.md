# Architecture

MailBridge MCP Community is a submission-oriented, synthetic-only reference
app. Its architecture keeps transport, tool contracts, mailbox behavior, and
UI separate so each layer can be audited independently.

## Boundaries

1. `src/http.ts` exposes health, document, widget, and streamable HTTP MCP routes.
2. `src/server.ts` defines tools, annotations, schemas, and the MCP Apps resource.
3. `src/service.ts` applies bounds, filters, thread reconstruction, and result shaping.
4. `src/demo-data.ts` is the only mailbox provider and uses reserved `.invalid` domains.
5. `src/widget.ts` renders only structured tool output and has no external dependencies.

## Read-only invariant

There is no SMTP implementation and no mailbox mutation interface. Every MCP
tool is annotated read-only and idempotent. Fetching a message or attachment
does not change unread state. The tests assert the entire exposed tool set and
repeat the unread search before and after a fetch.

## Trust model

Email bodies and attachment bytes are always untrusted data. Results carry an
explicit warning. The widget inserts values with `textContent`, never with
`innerHTML`, and the resource CSP has no external connect or asset domains.

## Production separation

This repository intentionally excludes real IMAP adapters, OAuth configuration,
credential stores, encrypted databases, infrastructure addresses, tunnel
profiles, production runbooks, and deployment secrets. A deployment that adds
any of those concerns requires a separate threat model and security review.
