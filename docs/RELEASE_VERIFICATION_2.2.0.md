# MailBridge v2.2.0 release verification

Date: 2026-09-27

Status: **PASS — local public release candidate**. This record covers the neutral
open-source line only. The candidate used synthetic mailboxes and a synthetic
send transport; it did not connect to operator mailboxes or send real email.

| Gate | Result |
|---|---|
| Package, lockfile and runtime version | PASS — 2.2.0 |
| Node 24 locked install, typecheck and build | PASS |
| Vitest | PASS — 29 files / 191 tests |
| Secret scan | PASS — 0 findings |
| Production dependency audit | PASS — 0 vulnerabilities |
| Packed-package dry run | PASS — 220 files |
| Read-only synthetic smoke | PASS — 15 mail-read tools, separate settings opener, SMTP off |
| Safe Send synthetic smoke | PASS — 30 tools, one synthetic submission, 0 real SMTP connections |
| Docker production image build | PASS — patched digest-pinned Chainguard runtime |
| Container vulnerability scan | PASS — 0 High / 0 Critical with Trivy |
| Runtime image identity | PASS — UID/GID 10001:10001, Node runtime reports 2.2.0 |
| Private mailbox identifiers or credentials in the change | 0 observed |
| Real mailbox or SMTP use | 0 |

The source adds scoped knowledge search, explicit incomplete-result signals,
per-folder UID/UIDVALIDITY paging, batch reads, raw MIME/authentication
inspection, and offset-based attachment continuation. Standard searches remain
bounded; callers must inspect `truncated` and `partial_failures`. Complete
history requires paging each selectable folder until `next_before_uid` is
null. Attachment continuation currently re-downloads and skips the decoded
prefix, so large offsets increase IMAP traffic.

This local record does not prove GitHub CI, CodeQL, dependency review,
provenance attestations, release assets, public deployment or provider
compatibility. Those gates require their own workflow results after publication.
