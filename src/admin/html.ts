import type { MailboxConfig } from "../config/schema.js";
import type { BrandConfigurationWarning } from "../security/brandGuard.js";
import type { AdminAuditEvent, AdminConnectionTestResult } from "./types.js";

export const PANEL_CSS = `
:root{color-scheme:light;--ink:#17212b;--muted:#5d6b78;--line:#d9e0e7;--bg:#f4f7f9;--card:#fff;--ok:#176b3a;--warn:#9a5b00;--bad:#a52323;--accent:#214f7a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
header{background:#14283a;color:#fff;padding:15px 24px}header strong{font-size:18px}nav{float:right}nav a{color:#fff;margin-left:18px}
main{max-width:1180px;margin:24px auto;padding:0 20px}.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:20px;margin-bottom:18px}
h1,h2{margin-top:0}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-size:13px}
label{display:block;font-weight:650;margin:12px 0 5px}input,select,textarea{width:100%;padding:9px;border:1px solid #aeb9c4;border-radius:5px;background:#fff}textarea{min-height:90px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 18px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:15px}button,.button{display:inline-block;border:0;border-radius:5px;background:var(--accent);color:#fff;padding:8px 12px;text-decoration:none;cursor:pointer}button.secondary,.button.secondary{background:#526373}
.pill{display:inline-block;padding:2px 7px;border-radius:999px;background:#e8edf2;font-size:12px}.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}.muted{color:var(--muted)}
.warning{border-left:4px solid var(--warn);padding:10px 12px;background:#fff5dd}.error{border-left:4px solid var(--bad);padding:10px 12px;background:#feecec}code{overflow-wrap:anywhere}
form.inline{display:inline}fieldset{border:1px solid var(--line);border-radius:6px;margin:14px 0}.checkbox{display:flex;gap:8px;align-items:center;font-weight:400}.checkbox input{width:auto}
.login-card{max-width:460px;margin:60px auto}
@media(max-width:800px){.grid{grid-template-columns:1fr}table{display:block;overflow-x:auto}nav{float:none;margin-top:8px}}
`;

export function loginPage(csrf: string, failed = false): string {
  return layout("Operator login", `<div class="card login-card">
    <h1>MailBridge operator</h1><p class="muted">Private loopback-only administration panel.</p>
    ${failed ? '<p class="error">Authentication failed.</p>' : ""}
    <form method="post" action="/admin/login" autocomplete="off">
      ${csrfField(csrf)}
      <label for="username">Operator</label><input id="username" name="username" required autocomplete="username">
      <label for="password">Password</label><input id="password" name="password" type="password" required autocomplete="current-password">
      <div class="actions"><button type="submit">Sign in</button></div>
    </form></div>`, false);
}

export function mailboxListPage(
  mailboxes: MailboxConfig[],
  states: Map<string, AdminConnectionTestResult>,
  warnings: Map<string, BrandConfigurationWarning[]>,
  csrf: string,
): string {
  const rows = mailboxes.map((mailbox) => {
    const state = states.get(mailbox.id);
    const warning = warnings.get(mailbox.id) ?? [];
    return `<tr><td><a href="/admin/mailboxes/${u(mailbox.id)}/edit">${h(mailbox.display_name)}</a><br><code>${h(mailbox.id)}</code></td>
      <td>${h(mailbox.email)}<br><span class="pill">${h(mailbox.brand)}</span>${warning.length ? '<div class="warning">CROSS_BRAND_CONFIGURATION_WARNING</div>' : ""}</td>
      <td>${mailbox.enabled ? '<span class="ok">enabled</span>' : '<span class="muted">disabled</span>'}</td>
      <td>${state ? `<strong class="${state.status === "PASS" ? "ok" : "bad"}">${state.status}</strong><br>tested ${h(state.checked_at)}<br>last success ${h(state.last_successful_check ?? "—")}` : "unknown"}</td>
      <td>${state?.folder_discovery.count ?? "—"}</td><td>${state ? (state.tls_verification.success ? '<span class="ok">verified</span>' : '<span class="bad">failed</span>') : "unknown"}</td>
      <td>${h(state?.error_category ?? "—")}</td><td><div class="actions">
        <form class="inline" method="post" action="/admin/mailboxes/${u(mailbox.id)}/test">${csrfField(csrf)}<button>TEST IMAP</button></form>
        <form class="inline" method="post" action="/admin/mailboxes/${u(mailbox.id)}/toggle">${csrfField(csrf)}<button class="secondary">${mailbox.enabled ? "Disable" : "Enable"}</button></form>
      </div></td></tr>`;
  }).join("");
  return layout("Mailboxes", `<div class="actions"><a class="button" href="/admin/mailboxes/new">Add mailbox</a></div>
    <div class="card"><h1>Mailboxes</h1><table><thead><tr><th>Mailbox</th><th>Address / brand</th><th>State</th><th>Last test</th><th>Folders</th><th>TLS</th><th>Last error</th><th>Actions</th></tr></thead><tbody>${rows || '<tr><td colspan="8">No mailboxes configured.</td></tr>'}</tbody></table></div>`);
}

export function mailboxFormPage(mailbox: MailboxConfig | null, csrf: string, error?: string): string {
  const value = mailbox ?? {
    id: "", display_name: "", email: "", brand: "OTHER", purpose: "", imap_host: "", imap_port: 993, tls: true,
    username_secret: "", password_secret: "", enabled: false, allowed_folders: ["INBOX"], result_limit: 50, tags: [],
    brand_hints: { organisation_names: [], domains: [], private: false },
  };
  const action = mailbox ? `/admin/mailboxes/${u(mailbox.id)}/save` : "/admin/mailboxes";
  return layout(mailbox ? "Edit mailbox" : "Add mailbox", `<div class="card"><h1>${mailbox ? "Edit mailbox" : "Add mailbox"}</h1>
    ${error ? `<p class="error">${h(error)}</p>` : ""}
    <form method="post" action="${action}" autocomplete="off">${csrfField(csrf)}<div class="grid">
      <div><label>mailbox_id</label><input name="mailbox_id" value="${h(value.id)}" required ${mailbox ? "readonly" : ""}></div>
      <div><label>Display name</label><input name="display_name" value="${h(value.display_name)}" required></div>
      <div><label>Email</label><input name="email" type="email" value="${h(value.email)}" required></div>
      <div><label>Brand</label><select name="brand">${["GENERAL", "BUSINESS", "PRIVATE", "OTHER"].map((brand) => `<option ${value.brand === brand ? "selected" : ""}>${brand}</option>`).join("")}</select></div>
      <div><label>Purpose</label><input name="purpose" value="${h(value.purpose)}" required></div>
      <div><label>IMAP host</label><input name="imap_host" value="${h(value.imap_host)}" required></div>
      <div><label>IMAP port</label><input name="imap_port" type="number" min="1" max="65535" value="${value.imap_port}" required></div>
      <div><label>TLS mode</label><select name="tls_mode"><option value="implicit" ${value.tls ? "selected" : ""}>Implicit TLS</option><option value="starttls" ${!value.tls ? "selected" : ""}>STARTTLS required</option></select></div>
      <div><label>Username secret reference</label><input name="username_secret" value="${h(value.username_secret)}" required autocomplete="off"></div>
      <div><label>Username (optional replace)</label><input name="username_value" value="" autocomplete="off" placeholder="Never displayed after save"></div>
      <div><label>Password secret reference</label><input name="password_secret" value="${h(value.password_secret)}" required autocomplete="off"></div>
      <div><label>Password (optional replace)</label><input name="password_value" type="password" value="" autocomplete="new-password" placeholder="Never displayed after save"></div>
      <div><label>Folder allowlist</label><textarea name="allowed_folders">${h(value.allowed_folders.join("\n"))}</textarea></div>
      <div><label>Tags</label><textarea name="tags">${h(value.tags.join("\n"))}</textarea></div>
      <div><label>Result limit</label><input name="result_limit" type="number" min="1" max="100" value="${value.result_limit}"></div>
      <div><label class="checkbox"><input name="enabled" type="checkbox" ${value.enabled ? "checked" : ""}> Enabled</label></div>
    </div><div class="actions"><button type="submit">Save configuration</button><a class="button secondary" href="/admin">Cancel</a></div></form></div>`);
}

export function connectionTestPage(mailbox: MailboxConfig, result: AdminConnectionTestResult, csrf: string): string {
  const cert = result.tls_verification.certificate;
  const folderBoxes = result.folder_discovery.folders.map((folder) => `<label class="checkbox"><input type="checkbox" name="folder" value="${h(folder.folder_id)}" ${mailbox.allowed_folders.includes(folder.folder_id) ? "checked" : ""} ${folder.selectable ? "" : "disabled"}> ${h(folder.display_name)} ${folder.special_use ? `<span class="muted">${h(folder.special_use)}</span>` : ""} <span class="muted">${folder.selectable ? "selectable" : "non-selectable"}</span></label>`).join("");
  return layout("IMAP test", `<div class="card"><h1>IMAP test: ${h(mailbox.id)}</h1><p><strong class="${result.status === "PASS" ? "ok" : "bad"}">${result.status}</strong> — ${result.latency_ms} ms</p>
    <table><tbody>
      <tr><th>DNS resolution</th><td>${yes(result.dns_resolution.success)} (${result.dns_resolution.address_count} addresses)</td></tr>
      <tr><th>TCP connection</th><td>${yes(result.tcp_connection.success)} ${result.tcp_connection.latency_ms ?? "—"} ms</td></tr>
      <tr><th>TLS verification</th><td>${yes(result.tls_verification.success)} (${result.tls_verification.mode})</td></tr>
      <tr><th>Certificate subject / SAN</th><td>${cert ? `${h(cert.subject ?? "—")}<br>${h(cert.san.join(", "))}<br>valid to ${h(cert.valid_to ?? "—")}` : "verified by IMAP adapter or unavailable"}</td></tr>
      <tr><th>Authentication</th><td>${yes(result.authentication.success)}</td></tr>
      <tr><th>Folder discovery</th><td>${yes(result.folder_discovery.success)} (${result.folder_discovery.count})</td></tr>
      <tr><th>BODY.PEEK flag check</th><td>${result.body_peek.success === null ? "UNVERIFIED" : yes(result.body_peek.success)} — ${h(result.body_peek.reason)}</td></tr>
      <tr><th>Redacted error</th><td>${h(result.error_category ?? "—")}</td></tr>
    </tbody></table></div>
    <div class="card"><h2>Folder allowlist</h2><form method="post" action="/admin/mailboxes/${u(mailbox.id)}/folders">${csrfField(csrf)}<fieldset>${folderBoxes || "No folders discovered."}</fieldset><button>Save folder allowlist</button></form></div>`);
}

export function auditPage(events: AdminAuditEvent[]): string {
  const rows = events.map((event) => `<tr><td>${h(event.at)}</td><td>${h(event.actor)}</td><td>${h(event.mailbox_id ?? "—")}</td><td>${h(event.action)}</td><td>${h(event.result)}</td></tr>`).join("");
  return layout("Audit", `<div class="card"><h1>Metadata-only audit</h1><p class="muted">No body, subject, sender, recipients, passwords or tokens are stored.</p><table><thead><tr><th>Time</th><th>Actor</th><th>Mailbox</th><th>Action</th><th>Result</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No events.</td></tr>'}</tbody></table></div>`);
}

export function errorPage(status: number, message: string): string {
  return layout(`Error ${status}`, `<div class="card"><h1>Error ${status}</h1><p class="error">${h(message)}</p><a class="button secondary" href="/admin">Back</a></div>`);
}

function layout(title: string, body: string, navigation = true): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${h(title)} — MailBridge</title><link rel="stylesheet" href="/admin/style.css"></head><body><header><strong>MailBridge Admin</strong>${navigation ? '<nav><a href="/admin">Mailboxes</a><a href="/admin/audit">Audit</a></nav>' : ""}</header><main>${body}</main></body></html>`;
}

function csrfField(csrf: string): string { return `<input type="hidden" name="csrf" value="${h(csrf)}">`; }
function h(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }
function u(value: string): string { return encodeURIComponent(value); }
function yes(value: boolean): string { return value ? '<span class="ok">PASS</span>' : '<span class="bad">FAIL</span>'; }
