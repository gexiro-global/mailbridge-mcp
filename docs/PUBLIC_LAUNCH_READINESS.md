# Public launch readiness

This is the release, website and campaign truth source for the public MailBridge
repository. It prevents a tested self-hosted connector from being advertised as
a hosted service or universally compatible product.

## Product being offered

MailBridge is Apache-2.0 self-hosted source code for a custom ChatGPT App and MCP
connector. A user can deploy it on infrastructure they control and connect
mailboxes they are authorized to access. The repository includes synthetic
demos, deployment templates and operator documentation.

It does **not** include:

- a Gexiro-hosted MailBridge endpoint or uptime commitment;
- an OAuth tenant, mailbox account, domain, reverse proxy or ChatGPT plan;
- one-click provider onboarding or verified support for every provider;
- ChatGPT app-directory approval;
- managed installation, compliance certification or professional support;
- any Gexiro mailbox, credential, production configuration or private data.

## Claims approved for website and LinkedIn

Use only claims supported by the current repository and release evidence:

- “Self-hosted multi-mailbox email tools for ChatGPT and MCP clients.”
- “Search selectable IMAP folders and inspect messages, threads and bounded
  attachments from one conversation.”
- “Read operations use IMAP `EXAMINE` and `BODY.PEEK` and are designed not to
  mark messages as read.”
- “Credentials are encrypted at rest in operator-controlled storage and are not
  returned by the settings UI.”
- “Safe Send is optional, disabled by default and protected by server-side
  mailbox policy, rate limits and explicit-confirmation gates.”
- “Includes synthetic demos that require no real mailbox or SMTP connection.”
- “Apache-2.0 source code; deploy and operate it on infrastructure you control.”

Qualify security statements with “designed to”, “by default”, “when configured
as documented” or a link to the exact verification artifact. Mention that email
content is sent to the connected MCP/model provider when a requested tool result
requires it. Explain that “read-only” applies to mailbox messages and flags;
user-initiated account settings still write encrypted connector configuration.

## Claims that must not be used

Do not publish any of these without new, specific evidence and authorization:

- “official ChatGPT app”, “OpenAI approved”, “available in the ChatGPT app
  directory” or any partnership/endorsement claim;
- “hosted”, “works out of the box everywhere”, “one click”, “zero setup” or
  “access from any device” without describing the operator's HTTPS/OAuth
  deployment;
- “supports Gmail/Outlook/every email provider” as a universal guarantee;
- “end-to-end encrypted”, “zero knowledge”, “unhackable”, “100% secure”, “GDPR
  compliant”, “enterprise certified” or “no data leaves your server”;
- “free service” or “no cost”: the source is free under Apache-2.0, while
  hosting, domains, identity services, ChatGPT and mailbox plans may cost money;
- performance, uptime, user-count, adoption or provider-compatibility numbers
  that were not measured and published with a reproducible method;
- a live-production or real-email PASS based only on a synthetic smoke test.

## Technical release gate

Record the release tag and immutable commit before publishing. Every box must be
supported by current CI or a redacted local artifact:

Latest local evidence: [2.0.2 release candidate verification](RELEASE_VERIFICATION_2.0.2.md).
Its external gates still apply until the immutable release workflow succeeds.

- [ ] clean checkout at the intended release commit;
- [ ] `npm ci --ignore-scripts` succeeds with the documented Node/npm versions;
- [ ] `npm run check` passes;
- [ ] `npm audit --omit=dev` reports no unresolved production vulnerability;
- [ ] read-only synthetic smoke exposes exactly 11 mail-read tools plus the
      separately scoped mailbox-settings opener, and no SMTP tools;
- [ ] Safe Send synthetic smoke exposes the expected optional tools and blocks
      unsafe/default-direct sends;
- [ ] setup is idempotent and prints no secret value;
- [ ] production doctor rejects placeholders, missing OAuth and missing secrets;
- [ ] fresh container build, health check and non-root/read-only checks pass;
- [ ] `npm pack` contents match the documented source distribution;
- [ ] fresh extraction of the delivered archive passes its documented smoke;
- [ ] secret/private-identifier scan returns zero findings;
- [ ] SBOM, checksums and provenance correspond to the exact release artifacts;
- [ ] GitHub environment `github-release` has required reviewers configured by
      a repository administrator;
- [ ] privacy, security, support, terms and versioned changelog links resolve.

Synthetic PASS proves the packaged contracts and safety gates. It does not prove
every provider, reverse proxy, OAuth server or recipient policy.

## Website checklist

- [ ] Link to the canonical GitHub repository, immutable release and LICENSE.
- [ ] Label the product “self-hosted open-source software”.
- [ ] Separate “Try the synthetic demo” from “Deploy with real mailboxes”.
- [ ] Show Node 24+, HTTPS/OAuth and operator-infrastructure requirements.
- [ ] State that Safe Send is optional and disabled by default.
- [ ] Link Privacy, Security, Support, Terms and deployment documentation.
- [ ] Include the independence/no-affiliation notice.
- [ ] Do not collect mailbox credentials in a website form.
- [ ] Do not offer a hosted endpoint until its privacy, security, OAuth, support,
      deletion and incident processes have separate production acceptance.
- [ ] Use only project-owned artwork from [Brand assets](BRAND_ASSETS.md); avoid
      third-party logos that could imply endorsement.

## LinkedIn campaign checklist

- [ ] Point the CTA to the exact public release or repository, not a private or
      staging URL.
- [ ] Say “free and open-source code”, not “free hosted service”.
- [ ] Include “self-hosted” in the first visible paragraph.
- [ ] Describe one reproducible workflow rather than a universal promise.
- [ ] Link to synthetic setup and security documentation.
- [ ] Avoid screenshots containing addresses, messages, hostnames, tokens,
      internal dashboards or real mailbox counts.
- [ ] Do not use OpenAI, ChatGPT, Gmail, Outlook or provider logos as project
      marks; text references must not imply affiliation.
- [ ] Keep campaign analytics separate from MailBridge; the connector includes
      no product telemetry.

Safe example:

> MailBridge is our Apache-2.0, self-hosted MCP connector for searching multiple
> authorized IMAP mailboxes from ChatGPT. Start with the synthetic demo—no real
> mailbox required. Optional Safe Send remains disabled by default. Source,
> security model and deployment requirements: [canonical repository link].

## Known limitations to disclose

- The embedded store supports one MailBridge node; horizontal replicas require
  shared database and settings-session infrastructure.
- A Secure MCP Tunnel carries MCP traffic but does not by itself expose the
  browser-facing Settings API across devices.
- Production remote use needs separately configured HTTPS and OAuth 2.1.
- Generic IMAP/SMTP interoperability does not override provider authentication,
  app-password, OAuth approval, throttling or account-policy requirements.
- Email and attachments are untrusted model input and can contain prompt
  injection. Tool output and external actions still need contextual review.
- Search/fetch tool contracts must not be marketed as a complete company-
  knowledge integration unless user-openable citation URLs and the intended
  client workflow have been verified end to end.

## Publication decision

The documentation and code may be prepared locally before launch, but website
editing, a LinkedIn post, GitHub release, package publication, hosted deployment
and app-directory submission are separate external actions. Each requires an
explicit operator decision after the technical release gate is complete.
