# Release candidate verification — 2.0.2

Date: 2026-08-26

Status: **PASS WITH EXTERNAL GATES**

This record covers the isolated `release/v2.0.2-security-hardening` candidate
built from public `main` commit `09e619a50f08bba14ea6f0470809c6b0cee334eb`.
It verifies the minimal version/documentation delta that packages the
post-2.0.1 logging hardening already reviewed in PR #11. It is not a hosted
release attestation: the protected PR, immutable tag, receiver artifacts and
hosted provenance remain external gates until their workflows succeed.

| Gate | Result |
|---|---|
| Runtime | PASS — Node 24.19.0 / npm 11.17.0 |
| Locked install | PASS — 221 packages, 0 audit findings |
| TypeScript typecheck | PASS |
| Production build | PASS |
| Vitest | PASS — 23 files / 123 tests |
| PR #11 logging regression | PASS — 6/6 |
| Controlled sensitive-marker regression | PASS — process failed closed; marker occurrences in stdout/stderr: 0 |
| Secret scan | PASS — 0 findings |
| Production dependency audit | PASS — 0 vulnerabilities |
| Read-only synthetic smoke | PASS — 11 mail-read tools plus separately scoped settings opener; SMTP off |
| Safe Send synthetic smoke | PASS — 24 tools; one synthetic submission; direct send blocked by default |
| Real mailboxes connected during smoke | 0 |
| Real emails sent during smoke | 0 |
| npm package dry run | PASS — version 2.0.2; 207 files |
| Container build | PASS — exact candidate source |
| Container identity | PASS — UID/GID 10001:10001 with runtime healthcheck |
| Container smoke | PASS — read-only MCP surface |
| Container vulnerability scan | PASS — 0 Critical / 0 High / 0 Medium / 0 Low |
| Private runtime, mailbox configuration or production service changed | NO |

## Required external gates

Before calling 2.0.2 released:

1. push the candidate branch and merge it through protected `main` only after
   every required CI, CodeQL, container and dependency-review check succeeds;
2. create `v2.0.2` from the exact protected-main commit without changing or
   retagging `v2.0.1`;
3. let the release workflow build and attest the runtime archive, source
   archive, CycloneDX SBOM and basename-only `SHA256SUMS`;
4. download the public assets and repeat checksum, SBOM and receiver
   verification from outside the repository checkout.

The candidate introduces no new tools, feature expansion or private-runtime
deployment. Synthetic acceptance proves the packaged contracts and safety
gates; it does not claim universal provider compatibility or hosted-service
operation.
