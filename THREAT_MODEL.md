# Threat model

## Scope

This model covers the public, synthetic-only MailBridge MCP reference app. It
does not cover a private IMAP adapter, credential store, OAuth deployment, or
production mailbox data. Those capabilities are intentionally absent.

## Assets and trust boundaries

- The MCP host and model are outside the server trust boundary.
- Tool inputs, email text, message headers, and attachment bytes are untrusted.
- The widget runs in a sandboxed host iframe and receives only structured tool
  output.
- The public HTTP listener is loopback-only unless an operator provides an
  explicit synthetic-demo acknowledgement.
- The source tree and release pipeline must remain free of credentials and real
  mailbox data.

## Primary threats and controls

| Threat | Control | Verification |
| --- | --- | --- |
| Prompt injection in email content | Every message and attachment is labeled untrusted; server instructions prohibit following embedded instructions. | MCP and service tests. |
| Mailbox state mutation | No SMTP or mutation interface exists; every tool is read-only and idempotent. | Tool inventory and unread-state regression test. |
| Credential disclosure | No credential fields or real provider exist; secret scan runs in CI. | Schema assertion and repository scan. |
| Oversized content | Search, thread, message, and attachment outputs have explicit upper bounds. | Input schemas and boundary tests. |
| Widget script injection | Dynamic values are assigned with `textContent`; no external script or asset origins are allowed. | Resource inspection and CSP metadata. |
| Accidental network exposure | Non-loopback binding fails closed without an explicit acknowledgement. | HTTP tests and container smoke test. |
| Dependency compromise | Lockfile installs, dependency review, CodeQL, npm audit, SBOM, immutable action pins, and artifact attestation. | GitHub workflows and release evidence. |
| Private implementation leakage | Public history is independent and contains synthetic data only. | Identifier scan and anonymous-clone verification. |

## Explicit non-goals

- Authenticating users or connecting real mailboxes.
- Persisting messages, credentials, tokens, or sessions.
- Sending, moving, deleting, copying, appending, or flagging email.
- Treating the synthetic reference app as a hosted production connector.

## Security review triggers

A new threat-model review is mandatory before adding real IMAP, OAuth,
credentials, persistence, public hosting, external widget origins, or any tool
that can change state.
