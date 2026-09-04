# Security and trust signals

Last reviewed: 2026-09-04.

This page is an evidence index, not a certification. A badge, score, workflow,
SBOM, or attestation does not prove that software is vulnerability-free.

## Repository controls

- Canonical source: <https://github.com/gexiro-global/mailbridge-mcp>
- License: [Apache-2.0](../LICENSE)
- Vulnerability reporting: [private GitHub reporting](../SECURITY.md)
- Governance and current maintainers: [GOVERNANCE.md](../GOVERNANCE.md) and
  [MAINTAINERS.md](../MAINTAINERS.md)
- Machine-readable project posture: [security-insights.yml](../security-insights.yml)
- Protected `main`: pull requests, current-base required status checks,
  resolved conversations, linear history, no administrator bypass, no force
  pushes, and no deletion.
- GitHub organization access requires secure two-factor authentication.

## Dependencies and analysis

The lockfile is committed and CI installs it with `npm ci --ignore-scripts`.
Dependabot covers npm and GitHub Actions. Pull requests run dependency review;
pushes, pull requests, and a weekly schedule run CodeQL. Workflow actions are
pinned to full commit SHAs and workflow permissions are declared explicitly.
GitHub secret scanning, generic-pattern scanning, validity checks, push
protection, Dependabot alerts, and Dependabot security updates are enabled.

The OpenSSF Scorecard workflow publishes signed results to the public Scorecard
API after a successful run on the default branch. The official public result
for commit `5fe4b268c39422413140ac5164e885d5ba8bc105`, generated on 2026-09-04,
is [6.4 out of 10](https://securityscorecards.dev/viewer/?uri=github.com/gexiro-global/mailbridge-mcp).
The badge reflects an automated, point-in-time repository posture assessment;
it is not a certification or proof that the software is vulnerability-free.

## Release integrity

Each release is built from a SemVer tag whose commit must be on `main`. The
release workflow runs the full check suite, installs the packaged runtime in a
clean receiver, rebuilds the source archive, builds the container, and verifies
all `SHA256SUMS` entries.

Releases produced by the current workflow include:

- the npm runtime archive;
- the versioned source archive;
- CycloneDX 1.5 JSON and SPDX 2.3 JSON SBOMs;
- basename-only SHA-256 checksums.

Existing v2.1.0 assets already have GitHub keyless provenance attestations. The
current workflow also creates a separate SBOM attestation that binds the SPDX
document to the runtime archive; that additional signal begins with the next
release produced after this workflow change. Verification instructions are in
[RELEASE_VERIFICATION.md](RELEASE_VERIFICATION.md).

No standalone cosign key is maintained. Public GitHub attestations use
short-lived Sigstore-backed identities through GitHub Actions. The project does
not claim an OpenSSF Best Practices badge, an OSPS Baseline level, or a SLSA
level until the corresponding assessment is complete and publicly verifiable.
