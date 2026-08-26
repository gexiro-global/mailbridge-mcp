# Changelog

All notable changes to the public MailBridge MCP distribution are documented
here. The project follows [Semantic Versioning](https://semver.org/).

## [1.1.1] - 2026-08-26

### Fixed

- Release checksum manifests now use artifact basenames, so a standard
  `sha256sum -c SHA256SUMS` works directly in the download directory.
- Release creation verifies the generated checksum manifest before publishing.

## [1.1.0] - 2026-08-22

### Added

- Explicit output schemas for every structured read-only tool.
- MCP Apps initialization handshake in the dashboard widget.
- Threat model, privacy statement, support policy, and contribution templates.
- Container smoke testing, CycloneDX SBOM generation, release checksums, and
  GitHub artifact attestations.
- Dedicated MailBridge visual identity asset.

### Changed

- Centralized the runtime version and refreshed current OpenAI plugin guidance.

## [1.0.0] - 2026-08-22

- Initial synthetic-only public reference release with eleven read-only tools,
  MCP Apps UI, Docker packaging, tests, CodeQL, and repository hardening.

[1.1.1]: https://github.com/gexiro-global/mailbridge-mcp/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/gexiro-global/mailbridge-mcp/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/gexiro-global/mailbridge-mcp/releases/tag/v1.0.0
