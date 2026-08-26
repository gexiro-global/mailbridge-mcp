# Support

MailBridge is community-supported, self-hosted software. Downloading or
deploying it does not include a managed connector, uptime commitment, provider
account, OAuth tenant or infrastructure support contract.

For a reproducible non-security defect, use
[GitHub Issues](https://github.com/gexiro-global/mailbridge-mcp/issues) and include:

- MailBridge version or commit;
- Node.js version, operating system and deployment path;
- the exact redacted command and error category;
- a minimal reproduction using only synthetic or `.invalid` fixture data;
- which checks from `npm run check` passed or failed.

Use GitHub Discussions for community deployment questions if the repository UI
exposes that feature. Provider-specific account policy, OAuth client approval,
DNS, reverse proxy, certificates, access-proxy configuration and infrastructure
operations remain the deployer's responsibility. Support does not guarantee
compatibility with every IMAP/SMTP provider or identity platform.

Never include credentials, tokens, cookies, real email, mailbox addresses,
private hostnames, database files, screenshots of secrets or unredacted logs.
Report suspected vulnerabilities only through the private process in
[SECURITY.md](SECURITY.md).
