# Connect to ChatGPT

MailBridge can be connected as a custom MCP app in ChatGPT Developer Mode. This
repository does not provide a hosted endpoint, OAuth tenant or app-directory
listing.

Current OpenAI references:

- [Connect from ChatGPT](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt/)
- [Authentication](https://developers.openai.com/apps-sdk/build/auth/)
- [Deploy your app](https://developers.openai.com/apps-sdk/deploy/)
- [Submit your app](https://developers.openai.com/apps-sdk/deploy/submission/)

Interfaces and requirements can change. Confirm the current OpenAI documentation
before a production deployment or submission.

## Before connecting

1. Run `npm run check` and the synthetic smoke test.
2. Select one supported topology from [Deployment](DEPLOYMENT.md).
3. Confirm the MCP endpoint and Settings API are reachable from their respective
   clients without exposing a development listener.
4. For remote deployments, validate OAuth issuer, audience, JWKS, scopes and the
   exact subject allowlist.
5. Keep `MAILBRIDGE_ALLOW_SEND=false` unless Safe Send was separately reviewed.

## Private tunnel

1. Run MailBridge on loopback and confirm `/health` and the synthetic smoke test.
2. Create a Secure MCP Tunnel in the OpenAI platform and run the tunnel client
   against this MailBridge process.
3. In ChatGPT, select the tunnel, choose the authentication mode appropriate for
   that private deployment, acknowledge the custom-MCP warning and create the app.
4. Refresh actions and verify the expected 11 read-only tools. Safe Send tools
   must be absent unless the global gate was deliberately enabled.

Secure MCP Tunnel provides outbound-only MCP connectivity. It does not turn an
arbitrary localhost HTTP route into a browser-reachable route. The settings
widget calls the Settings API from a sandboxed browser context, so cross-device
account management also requires a browser-reachable HTTPS origin allowed by the
widget CSP. A tunnel-only deployment may expose tools successfully while the
settings form remains unavailable on another device.

## Remote HTTPS + OAuth

1. Complete [Deployment](DEPLOYMENT.md) and [Authentication](AUTHENTICATION.md).
2. Enter the stable `https://your-host.example/mcp` URL in ChatGPT.
3. Select OAuth and complete authorization for the exact resource/audience.
4. Refresh actions and verify the tool inventory before adding an account.
5. Open `list_mailboxes`, use the settings widget and run `mailbox_health`.
6. Prove read-only behavior with a controlled unread message: record
   `unread=true`, fetch with `BODY.PEEK`, then confirm it remains unread.

The normal app configuration needs `mail.read`, `mail.health.read` and
`mail.settings.write`. Add `mail.send` only when the optional Safe Send layer is
deliberately enabled. The settings scope changes connector configuration, not
mailbox message flags or content.

Use an app-specific mailbox password when required by the provider. Never enter
a normal Google account password. MailBridge never displays a stored password;
use Replace credentials to rotate it.

## Disconnect and delete

Disconnect the custom app in ChatGPT to revoke that client connection. Also
revoke OAuth access at the identity provider when appropriate. Deleting a
mailbox in MailBridge removes its connector records; it does not delete messages
at the mailbox provider. The operator must separately handle backups, proxy logs
and downstream model-provider retention.

## Directory-submission boundary

A working self-hosted Developer Mode connection does not establish ChatGPT app-
directory readiness or approval. A directory submission requires a separately
operated stable service, verified publisher identity, public privacy/support
URLs, current policy compliance, positive and negative test cases and OpenAI
review. None of those outcomes is claimed by this repository.
