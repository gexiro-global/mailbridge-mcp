# Release process

MailBridge releases are built from the canonical public repository, not from an
operator runtime or secret-bearing deployment directory.

## Preconditions

1. Start from a clean commit on the public repository's `main` branch.
2. Set one semantic version consistently in `package.json`, the lockfile and
   runtime version constant.
3. Complete the technical gates in [Public launch readiness](PUBLIC_LAUNCH_READINESS.md).
4. Update [CHANGELOG.md](../CHANGELOG.md) and create a new, version-specific
   release-verification record.
5. Confirm the release contains no credentials, private endpoints, operator
   identifiers, databases, logs or real mailbox data.

## Workflow gate

The release workflow rejects:

- a tag that differs from the package version;
- a release commit that is not on `origin/main`;
- a package that fails its fresh receiver-side install/smoke test.

For version `X.Y.Z`, the expected release assets are:

- `mailbridge-mcp-vX.Y.Z-runtime-npm.tgz`
- `mailbridge-mcp-vX.Y.Z-source.tar.gz`
- `mailbridge-mcp-vX.Y.Z-sbom.cdx.json`
- `SHA256SUMS`

`SHA256SUMS` uses basename-only paths so verification works after downloading
the files into one clean directory. The workflow generates provenance
attestations for the release artifacts.

The publish job targets the GitHub environment `github-release`. A repository
administrator must configure that environment with required reviewers and any
desired branch/tag protection. Naming an environment in workflow YAML does not
by itself create an approval gate.

## Receiver verification

In a new empty directory, download only the release assets, verify every SHA-256
entry, inspect/verify the provenance and extract the source/runtime archives.
Run the documented install and synthetic smoke from the delivered artifact—not
from the maintainer's working tree. A hash-valid archive is not sufficient when
its dependency, build or runtime instructions fail for a receiver.

Never use a production database, credential file or real mailbox for release
verification. Synthetic PASS does not authorize a hosted deployment, Safe Send
activation, website publication or app-directory submission.
