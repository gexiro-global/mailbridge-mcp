# Release verification — 2.0.0

Date: 2026-08-26

| Gate | Result |
|---|---|
| TypeScript typecheck | PASS |
| Production build | PASS |
| Vitest | PASS — 20 files / 85 tests |
| Secret scan | PASS — 0 findings |
| Production dependency audit | PASS — 0 vulnerabilities |
| Read-only synthetic smoke | PASS — 11 tools, SMTP off |
| Safe Send synthetic smoke | PASS — 23 tools, 1 synthetic submission |
| Direct-send default policy | BLOCKED as designed |
| Fresh packed install and smoke | PASS |
| Docker acceptance | PASS — digest-pinned Chainguard runtime, UID 10001, read-only rootfs, no network, all capabilities dropped |
| Container vulnerability scan | PASS — 0 High / 0 Critical |
| Private identifier scan | PASS — 0 findings |
| Real mailboxes or SMTP used | 0 |

The SQLite experimental warning emitted by Node.js 24 is a known platform
warning, not a test failure. Horizontal replicas remain unsupported until the
database and settings-session stores are externalized.
