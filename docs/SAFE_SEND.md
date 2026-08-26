# MailBridge Safe Send

Safe Send is an optional MailBridge capability. It is disabled by default and
does not change the read-only guarantees of the 11 mail-reading tools.

Enabling Safe Send is an operator decision that permits an external side effect.
Do not enable it until SMTP credentials, recipient policy, limits, recovery and
audit expectations have been reviewed for every mailbox.

## Safety model

The recommended mailbox policy is `draft_only`. A send follows this state
machine:

`draft → validate → short-lived confirmation → submitting → smtp_accepted | partial_rejected | rejected | unknown`

- Draft contents and SMTP receipts are encrypted with the existing envelope
  cipher.
- A confirmation is single-use, expires, and is bound to the exact draft
  version, payload hash and policy version.
- Editing a draft or changing its policy invalidates outstanding confirmations.
- `send_draft` requires the confirmation ID and exact draft version.
- `send_email` and `reply_email` are rejected unless the mailbox policy is
  explicitly `direct_allowed`.
- A durable operation reservation prevents concurrent duplicate submission.
- An uncertain SMTP outcome becomes `unknown`; automatic retries remain blocked
  to avoid duplicate mail.
- Audit rows contain state, counts and reason codes, but no recipient addresses,
  message bodies or credentials.

These controls reduce accidental sends; they do not guarantee that a recipient,
message or model decision is correct. The user and operator remain responsible
for final review.

## Activation gates

All of these must be true before an SMTP submission tool can operate:

1. the process has the exact environment value `MAILBRIDGE_ALLOW_SEND=true`;
2. the selected mailbox has valid SMTP configuration and `send_enabled=true`;
3. the mailbox policy permits the requested flow;
4. OAuth includes `mail.send` for remote deployments;
5. recipient, domain, rate-limit and confirmation checks pass.

Keep the global gate false during read-only deployments, backups, migrations and
incident containment.

## Per-mailbox policy

The Settings UI and API expose:

- `send_mode`: `disabled`, `draft_only` or `direct_allowed`;
- mandatory final confirmation;
- allowed and denied recipient domains;
- maximum recipients per message;
- hourly and daily submission limits;
- external-recipient handling: `allow`, `warn` or `block`;
- confirmation lifetime from 30 to 600 seconds.

Domain comparison uses canonical ASCII DNS names and exact domain matching.

## Apps SDK surface

The Safe Send preview is a separate MCP Apps resource. Version 2.0.1 registers
`ui://mailbridge/safe-send-v2.0.1.html`. Clients should use the
`ui.resourceUri` supplied by tool metadata rather than hard-code that URI across
future releases.

The widget uses MCP `tools/call` and `ui/notifications/tool-result` over the host
bridge. `window.openai.toolOutput` remains a compatibility fallback. It uses no
browser persistence, external resources, native `confirm()` dialogs or native
`prompt()` dialogs.

Optional tool contracts:

- `open_mail_composer`
- `create_draft`
- `reply_draft`
- `update_draft`
- `get_send_policy`
- `validate_draft`
- `prepare_draft_send`
- `send_draft`
- `send_email`
- `reply_email`
- `get_send_status`
- `list_send_audit`

The read-only contracts and IMAP `EXAMINE` / `BODY.PEEK` behavior are unchanged
when Safe Send is enabled.

## Verification before activation

Use synthetic data and the synthetic SMTP adapter first:

```bash
npm ci --ignore-scripts
npm run check
npm run start:safe-send-staging
```

In a second terminal:

```bash
npm run smoke:safe-send
```

The synthetic smoke test is evidence for the local contracts and gates only. It
is not proof of provider-specific SMTP compatibility or authorization. A later
real-mailbox canary must use an operator-owned account, a deliberately selected
recipient, a separate approval and verified rollback/containment steps.
