# Changelog

## 2.0.0 — 2026-08-26

- replaced the synthetic-only reference runtime with real multi-mailbox IMAP;
- added user-scoped encrypted SQLite credential storage and Apps SDK settings UI;
- added all-folder native IMAP search, stable message IDs, `BODY.PEEK` fetch,
  standards-based thread reconstruction and bounded attachment retrieval;
- added OAuth protected-resource metadata and token validation for remote use;
- added opt-in Safe Send with drafts, policy validation, explicit confirmation,
  audit metadata, idempotency and fail-closed unknown-delivery handling;
- retained synthetic demos, CI, CodeQL, SBOM, checksums and release attestations;
- added idempotent local setup, hardened Docker Compose and deployment runbooks.

This is a major release because the product changes from a reference demo to a
self-hosted connector for real user-owned mailboxes.

## 1.1.1 — 2026-08-25

- corrected release checksum paths.

## 1.1.0 — 2026-08-25

- hardened the public synthetic reference app and release pipeline.
