# Changelog

## 2.0.2 — 2026-08-26

- hardened error logging so credential-bearing provider and transport failures
  are reduced to allowlisted metadata rather than serialized into application
  logs;
- added regression coverage that keeps runtime failure boundaries on fixed,
  allowlisted error categories;
- closed the post-2.0.1 CodeQL sensitive-data logging alert without expanding
  the product surface or changing the self-hosted deployment contract. See the
  [2.0.2 candidate verification](docs/RELEASE_VERIFICATION_2.0.2.md).

## 2.0.1 — 2026-08-26

- separated loopback development setup from an explicit, fail-closed production
  configuration and Docker Compose profile;
- added local and production doctor commands that enumerate required secret-file
  references without reading secret values;
- strengthened mailbox-network target validation and settings-session handling;
- separated mailbox-settings writes into the dedicated `mail.settings.write`
  scope and made single-mailbox deletion require the exact mailbox ID;
- made Linux production installs deterministic across full and production-only
  dependency trees, with fail-closed container secret provisioning;
- updated Apps SDK resource metadata, versioned widget URIs and compatibility
  with current ChatGPT tool-result metadata envelopes;
- made the public widgets and synthetic demo consistently English by default;
- replaced historic Safe Send staging wording with version-neutral operational
  guidance;
- expanded deployment, authentication, privacy, support and public-launch
  documentation with self-hosted/cost/affiliation and Settings API boundaries;
- hardened release automation with exact-version receiver tests, checksums,
  SBOM and provenance gates. See the
  [2.0.1 candidate verification](docs/RELEASE_VERIFICATION_2.0.1.md).

## 2.0.0 — 2026-08-26

- replaced the synthetic-only reference runtime with real multi-mailbox IMAP;
- added user-scoped encrypted SQLite credential storage and Apps SDK settings UI;
- added all-folder native IMAP search, stable message IDs, `BODY.PEEK` fetch,
  standards-based thread reconstruction and bounded attachment retrieval;
- added OAuth protected-resource metadata and token validation for remote use;
- added opt-in Safe Send with drafts, policy validation, explicit confirmation,
  audit metadata, idempotency and fail-closed unknown-delivery handling;
- hardened operator authentication with scrypt-based comparison and applied
  standards-based rate limiting to authenticated browser and settings routes;
- moved the runtime image to a digest-pinned minimal Chainguard base, verified
  with zero High or Critical findings in the release container scan;
- retained synthetic demos, CI, CodeQL, SBOM, checksums and release attestations;
- added idempotent local setup, hardened Docker Compose and deployment runbooks.

This is a major release because the product changes from a reference demo to a
self-hosted connector for real user-owned mailboxes.

## 1.1.1 — 2026-08-25

- corrected release checksum paths.

## 1.1.0 — 2026-08-25

- hardened the public synthetic reference app and release pipeline.
