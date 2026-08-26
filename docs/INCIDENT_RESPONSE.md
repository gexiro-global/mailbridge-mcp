# Incident response

## Immediate containment

1. Restrict access to MailBridge without changing unrelated mail services.
2. Disconnect the ChatGPT App or its private tunnel.
3. Stop only the MailBridge service and tunnel client.
4. Preserve redacted logs, release version and artifact hashes.
5. Determine whether OAuth tokens, mailbox credentials, application keys,
   message content or SMTP state may be affected.

## Credential exposure

- Never display or copy the exposed value into a report.
- Revoke or rotate the provider credential at its source.
- Replace the encrypted mailbox credential through the Settings UI.
- Review access metadata and the affected user's mailbox scope.
- Rotate application keys only with a tested rewrap/restore procedure.

## Unexpected message mutation

- Disable the affected mailbox immediately.
- Record mailbox/folder opaque IDs and timestamps, not message content.
- Reproduce only with synthetic data and IMAP protocol tracing.
- Keep the connector off until `EXAMINE`/`BODY.PEEK` invariants pass again.

## Unauthorized or ambiguous send

- Turn off `MAILBRIDGE_ALLOW_SEND` and disable sending on affected mailboxes.
- Preserve redacted send operation/audit rows and provider receipt IDs.
- Never automatically retry an `unknown` SMTP outcome.
- Rotate SMTP credentials if compromise is possible and re-run negative gates.

## Prompt injection or unsafe model behavior

- Preserve a redacted tool result and fixture category.
- Confirm whether any external action occurred.
- Reduce returned content or strengthen tool descriptions/delimiters.
- Do not convert one incident into a global block rule without controlled tests.

Incident reports must not contain message bodies, tokens, credentials, cookies,
session values or full addresses unless strictly necessary and privately approved.
