# Tool catalog

## Read-only surface — 11 tools

`list_mailboxes`, `mailbox_health`, `list_folders`, `list_recent_messages`,
`search_messages`, `fetch_message`, `fetch_thread`, `list_attachments`,
`fetch_attachment`, `search`, `fetch`.

All read tools use accurate read-only/non-destructive annotations. Message and
attachment reads use `BODY.PEEK` from `EXAMINE` folders and preserve IMAP flags.

## Optional Safe Send surface — 12 tools

`open_mail_composer`, `create_draft`, `reply_draft`, `update_draft`,
`get_send_policy`, `validate_draft`, `prepare_draft_send`, `send_draft`,
`send_email`, `reply_email`, `get_send_status`, `list_send_audit`.

The Safe Send tools are not registered unless the process-wide send gate is on.
Draft and policy tools are non-destructive writes; SMTP submission tools are
destructive/open-world and require `mail.send`. Server policy remains
authoritative even when a client asks to bypass it.
