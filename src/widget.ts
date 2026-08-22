import { MAILBRIDGE_VERSION } from "./version.js";

export const MAILBRIDGE_WIDGET_URI = "ui://mailbridge/demo-dashboard-v2.html";
export const MCP_APPS_PROTOCOL_VERSION = "2026-01-26";

export function mailbridgeWidgetHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>MailBridge</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 18px; background: transparent; color: CanvasText; }
    .shell { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 18px; padding: 18px; background: color-mix(in srgb, Canvas 94%, #4f46e5 6%); }
    header { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
    h1 { margin: 0; font-size: 20px; letter-spacing: -0.02em; }
    .badge { border: 1px solid #22c55e; color: #15803d; background: color-mix(in srgb, #22c55e 10%, transparent); border-radius: 999px; padding: 5px 9px; font-size: 12px; font-weight: 700; }
    .notice { margin: 14px 0; padding: 10px 12px; border-radius: 10px; background: color-mix(in srgb, #f59e0b 12%, transparent); font-size: 13px; line-height: 1.45; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(190px,1fr)); gap: 10px; }
    article { border: 1px solid color-mix(in srgb, CanvasText 14%, transparent); border-radius: 12px; padding: 12px; background: Canvas; }
    article strong { display: block; margin-bottom: 5px; }
    article span { display: block; opacity: .68; font-size: 12px; overflow-wrap: anywhere; }
    footer { margin-top: 14px; opacity: .62; font-size: 12px; }
  </style>
</head>
<body>
  <main class="shell">
    <header><h1>MailBridge</h1><span class="badge">READ-ONLY</span></header>
    <p class="notice"><strong>Synthetic showcase.</strong> No real mailbox, credential, or production endpoint is connected.</p>
    <section id="mailboxes" class="grid" aria-live="polite"><article><strong>Waiting for tool result…</strong><span>Call list_mailboxes to load the dashboard.</span></article></section>
    <footer>MCP Apps-compatible UI · zero write operations · untrusted email treated as data</footer>
  </main>
  <script>
    const target = document.getElementById("mailboxes");
    const initializeId = 1;
    function render(payload) {
      const mailboxes = payload && Array.isArray(payload.mailboxes) ? payload.mailboxes : [];
      if (!mailboxes.length) return;
      target.replaceChildren(...mailboxes.map((mailbox) => {
        const card = document.createElement("article");
        const title = document.createElement("strong");
        const address = document.createElement("span");
        const details = document.createElement("span");
        title.textContent = mailbox.display_name || "Mailbox";
        address.textContent = mailbox.mailbox_email || "synthetic.invalid";
        details.textContent = (mailbox.folder_count || 0) + " folders · " + (mailbox.message_count || 0) + " messages";
        card.append(title, address, details);
        return card;
      }));
    }
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (message && message.jsonrpc === "2.0" && message.id === initializeId && message.result) {
        window.parent.postMessage({
          jsonrpc: "2.0",
          method: "ui/notifications/initialized",
        }, "*");
      }
      if (message && message.jsonrpc === "2.0" && message.method === "ui/notifications/tool-result") {
        render(message.params && message.params.structuredContent);
      }
    });
    if (window.parent !== window) {
      window.parent.postMessage({
        jsonrpc: "2.0",
        id: initializeId,
        method: "ui/initialize",
        params: {
          protocolVersion: "${MCP_APPS_PROTOCOL_VERSION}",
          appInfo: {
            name: "mailbridge-dashboard",
            title: "MailBridge",
            version: "${MAILBRIDGE_VERSION}"
          },
          appCapabilities: {}
        }
      }, "*");
    }
    if (window.openai && window.openai.toolOutput) render(window.openai.toolOutput);
  </script>
</body>
</html>`;
}
