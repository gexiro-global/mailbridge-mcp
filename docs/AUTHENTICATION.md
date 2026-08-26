# Authentication

MailBridge is an OAuth-protected MCP resource server, not an OAuth authorization
server. A remote deployment must use an external OAuth 2.1 provider that supports
Authorization Code + PKCE and issues tokens for the exact MCP resource.

Current OpenAI reference: [Authenticate your ChatGPT App](https://developers.openai.com/apps-sdk/build/auth/).

## Validated token properties

The connector verifies:

- signature and allowed JWT algorithm;
- exact `iss` and `aud`;
- `sub`, `exp`, `iat` and token scopes;
- an optional exact subject allowlist (required by production safety checks).

Supported resource scopes are:

- `mail.read` for mailbox content and metadata;
- `mail.health.read` for deployment policy and health information;
- `mail.settings.write` for user-initiated mailbox add, replace, disable and
  delete operations in the Settings API;
- `mail.send` for Safe Send tools when the global feature gate is active.

IMAP and SMTP credentials never use ChatGPT token passthrough. They remain
encrypted in the connector store and are scoped to the derived MailBridge user.
`mail.settings.write` permits writes to connector configuration; it does not
permit changing or sending a mailbox message.

## Identity and tenant isolation

Normal multi-user deployments use `user_key_mode: oauth_subject`. MailBridge
derives a pseudonymous key from the validated issuer and subject; a change to
either value creates a different MailBridge identity. Select one stable subject
claim per person and test account separation before onboarding real mailboxes.

`fixed_private_owner` exists only for a controlled single-operator migration and
requires exactly one allowed subject. It is not a shortcut for multi-user
authorization.

## Local development

`disabled_dev` is accepted only on loopback outside `NODE_ENV=production`.
Never place it behind a reverse proxy, tunnel or network listener accessible by
another user. Use the separate production configuration for Docker production.

## Provider boundary

Configure ChatGPT as an OAuth client using a provider-supported pre-registration,
CIMD or DCR flow and the current redirect URI shown by the ChatGPT connection
interface. Do not infer compatibility from generic OAuth support alone.

Cloudflare Access JWT validation can be used as a private access-control mode,
but it is not automatically equivalent to a public ChatGPT app-directory OAuth
integration. The deployer must verify exact issuer/audience/JWKS behavior,
client-registration support and current OpenAI requirements.

Never publish client secrets, access tokens, refresh tokens, cookies or example
production subjects in documentation, screenshots, issues or config templates.
