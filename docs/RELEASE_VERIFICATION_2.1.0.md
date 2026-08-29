# MailBridge v2.1.0 release verification

Date: 2026-08-29

Status: **PASS — local release candidate**

This record covers the sanitized public v2.1.0 candidate in the isolated
public staging checkout. It does not attest to the private Gitea superset, any
operator runtime, a hosted endpoint, or real mailbox compatibility.

| Gate | Result |
|---|---|
| Package version consistency | PASS — 2.1.0 in package, lockfile and runtime |
| TypeScript typecheck | PASS |
| Production build | PASS |
| Vitest | PASS — 25 files / 135 tests |
| Secret scan | PASS — 0 findings |
| npm audit | PASS — 0 vulnerabilities |
| Private endpoint/identifier scan | PASS — 0 findings |
| Polish/private UI marker scan | PASS — 0 findings |
| Conflict/backup/temporary file scan | PASS — 0 findings |
| Read-only local synthetic smoke | PASS — 11 mail-read tools, settings opener, SMTP off |
| Safe Send synthetic smoke | PASS — 26 tools, one synthetic submission, outgoing attachment, direct-send default blocked |
| Safe Send real mailbox connections | 0 |
| Safe Send real emails sent | 0 |
| Outgoing attachment limits | PASS — per-file 10 MiB, total 18 MiB; request envelope configured consistently |
| Sent-copy SSRF guard | PASS — hostname resolution is validated before credential access; original hostname retained for TLS/SNI |
| Docker Compose YAML parse | PASS — Safe Send and Sent-copy disabled by default |
| Node 24 clean-container check | PASS — locked install, 135 tests, secret scan 0, audit 0 |
| Node 24 test image | PASS — built as `mailbridge-public:2.1.0-node24-check` |
| Production Docker image | PASS — built as `mailbridge-public:2.1.0`; non-root UID/GID 10001:10001 and healthcheck configured |
| Real mailbox/SMTP use during verification | 0 |
| Private runtime, mailbox configuration or production service changed | NO |

## Public surface

The public build contains the complete sanitized read surface and optional Safe
Send contracts. Read operations remain IMAP `EXAMINE`/`BODY.PEEK`. Safe Send
is disabled by default and requires explicit server-side policy and confirmation.
Outgoing attachments are bounded, MIME-validated and kept out of tool output.
When enabled, Sent-copy is best-effort and reports its state explicitly; SMTP
acceptance is not presented as proof that an IMAP Sent copy was stored.

## External release gates

Before publishing a public tag/release, the candidate must be committed,
pushed through the protected public `main` workflow, and re-verified from the
workflow-produced runtime, source, SBOM and SHA256SUMS artifacts. GitHub
environment approvals, CI, CodeQL, dependency review, provenance attestation
and release-asset verification remain external gates. No production cutover,
private Gitea synchronization, website publication or LinkedIn campaign is
performed by this record.
