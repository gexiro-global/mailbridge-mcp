# Connect to ChatGPT

MailBridge is a custom MCP app. Enable Developer Mode in ChatGPT, then create an
app using one of these connection modes.

OpenAI references: [connect from ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt),
[authentication](https://developers.openai.com/plugins/build/auth) and
[deployment/submission](https://developers.openai.com/plugins/deploy/submission).

## Private tunnel

1. Run MailBridge on loopback and confirm `/health` and the synthetic smoke test.
2. Create a Secure MCP Tunnel in the OpenAI platform and run the tunnel client
   against this MailBridge process.
3. In ChatGPT, select the tunnel, choose the authentication mode appropriate for
   that private deployment, acknowledge the custom-MCP warning and create the app.
4. Refresh actions and verify 11 read-only tools. Safe Send tools must be absent
   unless the global gate was deliberately enabled.

Secure MCP Tunnel is outbound-only connectivity for MCP. It does not make an
arbitrary localhost Settings API browser-reachable. For cross-device account
configuration, provide the widget with an approved CSP-allowed private HTTPS
origin or use the remote topology below.

## Remote HTTPS + OAuth

1. Complete [deployment](DEPLOYMENT.md) and [authentication](AUTHENTICATION.md).
2. Enter the stable `https://your-host.example/mcp` URL in ChatGPT.
3. Select OAuth and complete authorization for the exact resource/audience.
4. Refresh actions, open `list_mailboxes`, and add accounts in the widget.
5. Run `mailbox_health` and a read-only `BODY.PEEK` unread-preservation test.

Use an app-specific mailbox password when the provider requires one. Never enter
a normal Google account password. MailBridge never displays a stored password;
use Replace credentials to rotate it.

This repository does not provide a shared hosted endpoint or OAuth tenant. A
public ChatGPT app-directory submission requires a separately operated service,
privacy/support URLs and successful OpenAI review.
