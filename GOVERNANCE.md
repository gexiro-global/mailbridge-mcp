# Governance

MailBridge is stewarded by Gexiro Global Enterprises Ltd. The canonical public
repository is <https://github.com/gexiro-global/mailbridge-mcp>.

## Roles and responsibility

- The maintainer listed in [MAINTAINERS.md](MAINTAINERS.md) triages issues and
  vulnerability reports, reviews contributions, maintains repository security
  settings, and authorizes releases.
- Contributors propose changes through issues, discussions, or pull requests.
  A contribution does not grant merge or release authority.
- GitHub Actions performs the required build, test, dependency-review,
  container, and CodeQL checks. Passing automation is evidence, not a substitute
  for maintainer judgment.

The project currently has one maintainer. It therefore does not claim a
two-person review process or a bus factor greater than one. Self-authored changes
still require a pull request, the protected-branch checks, current-base testing,
resolved review conversations, and linear history; administrators cannot bypass
those controls.

## Decisions and changes

Small, reversible changes are decided in their pull request. Changes to MCP tool
contracts, authentication, tenant isolation, credential handling, network
policy, Safe Send, storage, release integrity, or privacy require corresponding
tests and updates to the threat model or operator documentation.

Security-sensitive design discussion may begin privately when public detail
would create avoidable risk. The resulting fix and appropriate release notes
are published after coordinated disclosure. Non-sensitive proposals and usage
obstacles belong in public GitHub Issues or Discussions.

## Releases

Only a maintainer may approve a release. The process, required evidence,
artifact checksums, SBOMs, and provenance controls are defined in
[docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md). A version tag is not a valid
release unless the protected release workflow succeeds and the GitHub release
contains the expected verified artifacts.

## Amendments

Governance changes use the same protected pull-request process as code changes.
The repository history is the public record of amendments.
