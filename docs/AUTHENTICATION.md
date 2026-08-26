# Authentication

MailBridge is an MCP resource server, not an OAuth authorization server. A
remote deployment must use an external OAuth 2.1 provider with Authorization
Code + PKCE and tokens issued for the exact MCP resource.

The connector publishes protected-resource metadata and verifies:

- signature and allowed JWT algorithm;
- exact `iss` and `aud`;
- `sub`, `exp`, `iat` and token scopes;
- optional exact subject allowlist.

Supported resource scopes are:

- `mail.read` for mailbox content and metadata;
- `mail.health.read` for deployment policy/documentation compatibility;
- `mail.send` for Safe Send tools when the global feature gate is active.

IMAP and SMTP credentials never use token passthrough. They remain encrypted in
the connector store.

`disabled_dev` is accepted only on loopback outside `NODE_ENV=production`.
Never place it behind a public reverse proxy. Configure ChatGPT as an OAuth
client using a provider-supported pre-registration, CIMD or DCR flow and the
current ChatGPT redirect URI shown by the connection interface.

Cloudflare Access JWT validation is supported as a private access-control mode,
but it is not automatically equivalent to a public ChatGPT directory OAuth
integration. Validate the chosen topology against current OpenAI requirements.
