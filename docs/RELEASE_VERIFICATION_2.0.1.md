# Release candidate verification — 2.0.1

Date: 2026-08-26

Status: **PASS WITH EXTERNAL GATES**

This record covers the local `polish/v2.0.1-launch-readiness` working tree
immediately before its release commit. It is not a GitHub release attestation:
the immutable tag, receiver artifacts and hosted provenance are established
only by the protected release workflow, so those external gates remain pending
until that workflow succeeds.

| Gate | Result |
|---|---|
| TypeScript typecheck | PASS |
| Production build | PASS |
| Vitest | PASS — 22 files / 117 tests |
| Secret scan | PASS — 0 findings |
| Production dependency audit | PASS — 0 vulnerabilities / 160 production dependencies |
| Linux full dependency install | PASS |
| Linux production-only dependency install | PASS — 159 packages installed, 0 vulnerabilities |
| Lockfile package-version integrity | PASS — no empty package versions |
| Read-only synthetic smoke | PASS — 11 mail-read tools plus separately scoped settings opener; SMTP off |
| Safe Send synthetic smoke | PASS — 24 tools; one synthetic submission; direct send blocked by default |
| Settings write scope | PASS — dedicated `mail.settings.write` authorization |
| Mailbox deletion confirmation | PASS — exact mailbox ID required by UI and API |
| Markdown local links | PASS — 24 files checked |
| Production Compose render | PASS |
| npm package dry run | PASS — version 2.0.1; required runtime/docs/templates present |
| Container build | PASS — Linux/amd64 image built from current source |
| Container identity | PASS — UID/GID 10001:10001 with runtime healthcheck |
| Container vulnerability scan | PASS — 353 packages; 0 Critical / 0 High |
| Private identifier scan | PASS — 0 private endpoints, mailbox addresses or tunnel IDs |
| Real mailboxes or SMTP used | 0 |
| Website, campaign, package publication or deployment performed | NO |

## Required external gates

Before calling 2.0.1 released:

1. commit and review the candidate, then fast-forward or merge it to public
   `main`;
2. configure required reviewers on the GitHub `github-release` environment and
   confirm branch/tag protection plus private vulnerability reporting;
3. create `v2.0.1` from the immutable `main` commit and let the release workflow
   build and verify the exact runtime archive, source archive, SBOM, checksums
   and provenance;
4. perform one final ChatGPT UI regression against the released, operator-hosted
   endpoint before publishing website or LinkedIn claims.

Synthetic and local acceptance proves the packaged contracts and safety gates.
It does not prove every mailbox provider, OAuth deployment, reverse proxy or
recipient policy, and it does not turn the project into a hosted service or an
official OpenAI application.
