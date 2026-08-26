# Architecture

```text
ChatGPT App widget + MCP tools
              |
       Streamable HTTP / OAuth
              |
      user-scoped service factory
        |                    |
read-only IMAP         optional Safe Send
EXAMINE/BODY.PEEK      encrypted drafts + SMTP
        |                    |
        +-- SQLite state + encrypted envelopes --+
```

`src/transport/http.ts` provides Streamable HTTP MCP, health, protected-resource
metadata and Settings API routes. `src/mcp/server.ts` owns tool contracts,
annotations and Apps SDK resources. `src/services` implements bounded mail and
send behavior. `src/imap` and `src/send` are provider adapters. `src/app` owns
identity scoping, AES-GCM envelopes, SQLite, settings sessions and widgets.

SQLite itself is not presented as full-database encryption. Sensitive mailbox
credentials, drafts and receipt payloads use AES-GCM envelopes whose key remains
outside SQLite; operational metadata needed for indexing and policy remains in
the database. Protect the database, application keys and backups as one
security-sensitive set.

Every request derives a non-reversible user key from validated OAuth issuer and
subject. The service factory decrypts only that user's credentials in memory,
creates scoped adapters, and clears temporary values during disposal. Stable
message IDs are per-user HMAC identifiers and do not reveal hosts or UIDs.

Read and write surfaces are separate. The read service has no mutation methods.
The writer is not constructed unless the global send gate is enabled. Even then,
server-side mailbox policy, rate limits, version binding, idempotency and explicit
confirmation remain authoritative.

The bundled synthetic runtimes substitute in-memory IMAP/SMTP adapters and are
marked so they cannot be confused with production evidence.
