# MailBridge Safe Send

Status: local staging candidate. This document does not authorize a production cutover or a real email send.

## Safety model

The default mailbox policy is `draft_only`. A send follows this state machine:

`draft → validate → short-lived confirmation → submitting → smtp_accepted | partial_rejected | rejected | unknown`

- Draft contents and SMTP receipts are encrypted with the existing envelope cipher.
- A confirmation is single-use, expires, and is bound to the exact draft version, payload hash, and policy version.
- Editing a draft or changing its policy invalidates outstanding confirmations.
- `send_draft` requires the confirmation ID and exact draft version.
- `send_email` and `reply_email` are rejected unless the mailbox policy is explicitly `direct_allowed`.
- The durable operation reservation prevents concurrent duplicate submission.
- An uncertain SMTP outcome becomes `unknown`; automatic retries remain blocked to avoid duplicate mail.
- Audit rows contain state, counts, and reason codes, but no recipient addresses, message bodies, or credentials.

## Per-mailbox policy

The Settings UI and API expose:

- `send_mode`: `disabled`, `draft_only`, or `direct_allowed`;
- mandatory final confirmation;
- allowed and denied recipient domains;
- maximum recipients per message;
- hourly and daily submission limits;
- external-recipient handling: `allow`, `warn`, or `block`;
- confirmation lifetime from 30 to 600 seconds.

Domain comparison uses canonical ASCII DNS names and exact domain matching.

## Apps SDK surface

The Safe Send widget is a separate MCP Apps resource:

`ui://mailbridge/safe-send-v0.4.html`

It uses MCP `tools/call` and `ui/notifications/tool-result` over the host bridge. `window.openai.toolOutput` is retained only as a compatibility fallback. The widget uses no browser persistence, external resources, native `confirm()` dialogs, or native `prompt()` dialogs.

New tool contracts:

- `open_mail_composer`
- `update_draft`
- `get_send_policy`
- `validate_draft`
- `prepare_draft_send`
- `get_send_status`
- `list_send_audit`

The existing `create_draft`, `reply_draft`, `send_draft`, `send_email`, and `reply_email` tools remain available. Existing read-only contracts and IMAP `EXAMINE` / `BODY.PEEK` semantics are unchanged.

## Staging verification

Use only the isolated staging checkout. The test transport is synthetic and must not contain production SMTP credentials.

```powershell
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run secret-scan
```

Before any later deployment, require a separate production GO, a database backup, an explicit policy decision for every send-enabled mailbox, and a rollback verification against the v0.3 tag.
