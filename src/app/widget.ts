export const MAILBRIDGE_WIDGET_URI = "ui://mailbridge/manage-mailboxes-v2.1.0.html";

export interface MailBridgeWidgetRenderOptions {
  localDemo?: boolean;
  safeSendDemo?: boolean;
  bootstrap?: {
    settingsApiUrl: string;
    token: string;
    csrf: string;
  };
}

export function mailbridgeReadOnlyWidgetHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>MailBridge — mailboxes</title>
  <style>
    :root{color-scheme:light dark;font:14px/1.45 ui-sans-serif,system-ui,sans-serif;--line:color-mix(in srgb,currentColor 18%,transparent);--muted:color-mix(in srgb,currentColor 62%,transparent)}
    *{box-sizing:border-box}body{margin:0;background:transparent;color:CanvasText}main{max-width:920px;margin:auto;padding:18px}h1{font-size:20px;margin:0}.notice{padding:10px 12px;border:1px solid var(--line);border-radius:10px;color:var(--muted);margin:12px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}.card{border:1px solid var(--line);border-radius:14px;padding:14px;background:Canvas}.card h2{font-size:16px;margin:0 0 6px}.meta{color:var(--muted);overflow-wrap:anywhere}.status{display:inline-flex;margin-top:9px;padding:3px 8px;border:1px solid var(--line);border-radius:999px}
  </style>
</head>
<body>
<main>
  <h1>MailBridge</h1>
  <div class="notice">IMAP reading remains read-only. Sending is available only for explicitly approved actions and mailboxes with separately enabled SMTP.</div>
  <div id="message" role="status" aria-live="polite"></div>
  <section id="mailboxes" class="grid"></section>
</main>
<script type="module">
const list=document.querySelector("#mailboxes");
const message=document.querySelector("#message");
function render(data){
  const mailboxes=Array.isArray(data?.mailboxes)?data.mailboxes:[];
  list.replaceChildren();
  if(!mailboxes.length){message.textContent="No mailbox data is available.";return}
  message.textContent="Mailboxes: "+mailboxes.length;
  for(const box of mailboxes){
    const card=document.createElement("article");card.className="card";
    const title=document.createElement("h2");title.textContent=String(box.display_name||box.mailbox_id||"Mailbox");
    const email=document.createElement("div");email.className="meta";email.textContent=String(box.mailbox_email||box.email||"");
    const status=document.createElement("span");status.className="status";status.textContent=(box.enabled?"Enabled · ":"Disabled · ")+String(box.connection_status||"unknown");
    card.append(title,email,status);list.append(card);
  }
}
render(window.openai?.toolOutput);
window.addEventListener("message",event=>{
  if(event.source!==window.parent)return;
  const msg=event.data;
  if(msg?.jsonrpc==="2.0"&&msg.method==="ui/notifications/tool-result")render(msg.params?.structuredContent);
},{passive:true});
</script>
</body>
</html>`;
}

export function mailbridgeWidgetHtml(options: MailBridgeWidgetRenderOptions = {}): string {
  const localDemo = options.localDemo === true;
  const safeSendDemo = localDemo && options.safeSendDemo === true;
  const bodyAttributes = localDemo
    ? ` class="local-demo" data-local-demo="true"${safeSendDemo ? ' data-safe-send-demo="true"' : ""}`
    : "";
  const localDemoNotice = localDemo
    ? safeSendDemo
      ? '<div id="local-demo-banner" class="notice demo-notice"><strong>LOCAL SAFE SEND STAGING — SYNTHETIC TRANSPORT — NO REAL EMAIL</strong><br>All mailboxes, messages and send results are synthetic. This mode opens no IMAP or SMTP connections.</div>'
      : '<div id="local-demo-banner" class="notice demo-notice"><strong>LOCAL SYNTHETIC DEMO — NO REAL MAILBOX CONNECTED</strong><br>All mailboxes and messages are synthetic. The Add form neither stores nor tests real credentials.</div>'
    : "";
  const bootstrap = options.bootstrap
    ? `<script>window.openai={toolResponseMetadata:${JSON.stringify({
      settings_api_url: options.bootstrap.settingsApiUrl,
      settings_token: options.bootstrap.token,
      settings_csrf: options.bootstrap.csrf,
      local_demo: localDemo,
      safe_send_demo: safeSendDemo,
    })}};</script>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>MailBridge — mailbox settings</title>
  <style>
    :root{color-scheme:light dark;font:14px/1.45 ui-sans-serif,system-ui,sans-serif;--accent:#6d5efc;--line:color-mix(in srgb,currentColor 18%,transparent);--muted:color-mix(in srgb,currentColor 62%,transparent)}
    *{box-sizing:border-box}body{margin:0;background:transparent;color:CanvasText}main{max-width:920px;margin:auto;padding:18px}.top{display:flex;gap:12px;align-items:flex-start;justify-content:space-between}.notice{padding:10px 12px;border:1px solid var(--line);border-radius:10px;color:var(--muted);margin:12px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:12px}.card,.panel{border:1px solid var(--line);border-radius:14px;padding:14px;background:color-mix(in srgb,Canvas 96%,var(--accent) 4%)}h1{font-size:20px;margin:0}h2{font-size:16px;margin:0 0 8px}.meta{color:var(--muted);overflow-wrap:anywhere}.status{display:inline-flex;padding:3px 8px;border-radius:999px;background:color-mix(in srgb,var(--accent) 16%,transparent)}button{border:1px solid var(--line);background:Canvas;border-radius:9px;padding:8px 11px;cursor:pointer}button.primary{background:var(--accent);color:white;border-color:var(--accent)}button.danger{color:#d33}.actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}label{display:grid;gap:4px;color:var(--muted)}input,select,textarea{width:100%;padding:9px;border:1px solid var(--line);border-radius:8px;background:Canvas;color:CanvasText}label.wide,.form-actions{grid-column:1/-1}.form-actions{display:flex;gap:8px}.hidden{display:none!important}#message{min-height:22px;margin:8px 0;color:var(--muted)}dialog{border:1px solid var(--line);border-radius:14px;background:Canvas;color:CanvasText;max-width:700px;width:calc(100% - 28px)}dialog::backdrop{background:#0008}@media(max-width:580px){form{grid-template-columns:1fr}.top{flex-direction:column}}
    .demo-notice{color:CanvasText;border-color:#d08b00;background:color-mix(in srgb,#ffb000 15%,Canvas)}.local-demo main>.notice:not(.demo-notice),.local-demo .credential,.local-demo #replace{display:none!important}
  </style>
</head>
<body${bodyAttributes}>
<main>
  ${localDemoNotice}
  <div class="top"><div><h1>MailBridge</h1><div class="meta">Read-only IMAP with optional, policy-gated SMTP</div></div><button id="add" class="primary">Add mailbox</button></div>
  <div class="notice">Self-hosted app. Passwords go directly to your connector, are encrypted when saved and can never be displayed again.</div>
  <div id="message" role="status" aria-live="polite"></div>
  <section id="mailboxes" class="grid"></section>
  <section class="panel" style="margin-top:14px"><h2>Application data</h2><p class="meta">Disconnecting the app in ChatGPT stops access. You can separately delete every saved configuration and credential below.</p><button id="deleteAll" class="danger">Delete all MailBridge data</button></section>
</main>
<dialog id="editor"><h2 id="editorTitle">Add mailbox</h2><form id="mailboxForm" method="dialog">
  <input id="editingId" type="hidden">
  <label>Display name<input name="display_name" required maxlength="160"></label>
  <label>E-mail<input name="email" type="email" required></label>
  <label>Brand<select name="brand"><option>GENERAL</option><option>BUSINESS</option><option>PRIVATE</option><option>OTHER</option></select></label>
  <label>Purpose<input name="purpose" required maxlength="300" value="Primary mailbox"></label>
  <label>IMAP hostname<input name="imap_host" required placeholder="imap.example.com"></label>
  <label>Port<input name="imap_port" type="number" min="1" max="65535" value="993" required></label>
  <label>TLS<select name="tls_mode"><option value="implicit">Implicit TLS</option><option value="starttls">STARTTLS</option></select></label>
  <label>Folders<input name="allowed_folders" value="INBOX" required></label>
  <label><span><input name="send_enabled" type="checkbox" style="width:auto"> Enable sending for this mailbox</span></label>
  <label>Transport<select name="send_transport"><option value="smtp">SMTP</option></select></label>
  <label>SMTP hostname<input name="smtp_host" placeholder="smtp.example.com"></label>
  <label>SMTP port<input name="smtp_port" type="number" min="1" max="65535" value="465"></label>
  <label>SMTP TLS<select name="smtp_tls_mode"><option value="implicit">Implicit TLS</option><option value="starttls">STARTTLS</option></select></label>
  <label class="credential">IMAP login<input name="username" autocomplete="username" maxlength="512"></label>
  <label class="credential">Password / app password<input name="password" type="password" autocomplete="new-password" maxlength="16384"></label>
  <label class="create-only"><span><input name="enabled" type="checkbox" checked style="width:auto"> Enable after a successful test</span></label>
  <div class="form-actions"><button type="button" id="cancelEditor">Cancel</button><button type="button" id="testDraft">Test</button><button class="primary" type="submit">Save</button></div>
</form></dialog>
<dialog id="replace"><h2>Replace credentials</h2><form id="replaceForm" method="dialog">
  <input id="replaceId" type="hidden"><label>IMAP login<input name="username" autocomplete="username" required maxlength="512"></label><label>New password / app password<input name="password" type="password" autocomplete="new-password" required maxlength="16384"></label>
  <div class="form-actions"><button type="button" id="cancelReplace">Cancel</button><button class="primary" type="submit">Test and replace</button></div>
</form></dialog>
<dialog id="policy"><h2>Safe Send policy</h2><form id="policyForm" method="dialog">
  <input id="policyId" type="hidden">
  <label>Send mode<select name="send_mode"><option value="disabled">Disabled</option><option value="draft_only">Draft + confirmation only</option><option value="direct_allowed">Direct send allowed</option></select></label>
  <label>External recipients<select name="external_recipients"><option value="warn">Warn</option><option value="block">Block</option><option value="allow">Allow</option></select></label>
  <label class="wide">Allowed domains (optional, comma-separated)<input name="allowed_domains" autocomplete="off"></label>
  <label class="wide">Blocked domains (comma-separated)<input name="denied_domains" autocomplete="off"></label>
  <label>Maximum recipients<input name="max_recipients" type="number" min="1" max="50" required></label>
  <label>Hourly limit<input name="max_per_hour" type="number" min="1" max="500" required></label>
  <label>Daily limit<input name="max_per_day" type="number" min="1" max="5000" required></label>
  <label>Confirmation lifetime (seconds)<input name="confirmation_ttl_seconds" type="number" min="30" max="600" required></label>
  <label class="wide"><span><input type="checkbox" checked disabled style="width:auto"> Final confirmation is always required</span></label>
  <div class="form-actions"><button type="button" id="cancelPolicy">Cancel</button><button class="primary" type="submit">Save policy</button></div>
</form></dialog>
<dialog id="deleteMailbox"><h2>Delete mailbox</h2><form id="deleteMailboxForm" method="dialog">
  <input id="deleteMailboxId" type="hidden"><p class="meta">Type the mailbox ID exactly: <strong id="deleteMailboxConfirmationLabel"></strong>. This removes the mailbox and its encrypted data.</p><label>Mailbox ID confirmation<input name="confirmation" autocomplete="off" required></label>
  <div class="form-actions"><button type="button" id="cancelDeleteMailbox">Cancel</button><button class="danger" type="submit">Delete</button></div>
</form></dialog>
<dialog id="deleteAllDialog"><h2>Delete all data</h2><form id="deleteAllForm" method="dialog">
  <p class="meta">Type exactly <strong>DELETE ALL MAILBRIDGE DATA</strong>.</p><label>Confirmation<input name="confirmation" autocomplete="off" required></label>
  <div class="form-actions"><button type="button" id="cancelDeleteAll">Cancel</button><button class="danger" type="submit">Delete everything</button></div>
</form></dialog>
${bootstrap}
<script type="module">
const bridge=window.openai||{};
function responseMeta(value){
  const root=value&&typeof value==="object"?value:{};
  const result=root.mcp_tool_result||root.call_tool_result||root;
  if(!result||typeof result!=="object")return{};
  const nested=result._meta;
  return nested&&typeof nested==="object"?nested:(root._meta&&typeof root._meta==="object"?root._meta:root);
}
const meta=responseMeta(bridge.toolResponseMetadata||bridge.toolResponseMeta||{});
const localDemo=Boolean(meta.local_demo||document.body.dataset.localDemo==="true");
let token=String(meta.settings_token||"");
let csrf=String(meta.settings_csrf||"");
const apiBase=String(meta.settings_api_url||"").replace(/\\\/$/,"");
let mailboxes=[];
let queue=Promise.resolve();
const list=document.querySelector("#mailboxes"), message=document.querySelector("#message"), editor=document.querySelector("#editor"), replace=document.querySelector("#replace"), policyDialog=document.querySelector("#policy"), deleteMailboxDialog=document.querySelector("#deleteMailbox"), deleteAllDialog=document.querySelector("#deleteAllDialog");
const form=document.querySelector("#mailboxForm"), replaceForm=document.querySelector("#replaceForm"), policyForm=document.querySelector("#policyForm"), deleteMailboxForm=document.querySelector("#deleteMailboxForm"), deleteAllForm=document.querySelector("#deleteAllForm");
function say(text){message.textContent=text}
function scrub(formElement){for(const input of formElement.querySelectorAll('input[type="password"]')) input.value=""}
async function request(path,options={}){
  const run=async()=>{
    if(!apiBase||!token||!csrf) throw new Error("The settings session is unavailable. Call open_mailbox_settings again.");
    const response=await fetch(apiBase+path,{...options,headers:{"Authorization":"Settings "+token,"X-MailBridge-CSRF":csrf,"Content-Type":"application/json",...(options.headers||{})}});
    token=response.headers.get("X-MailBridge-Settings-Token")||"";
    csrf=response.headers.get("X-MailBridge-Settings-CSRF")||"";
    const data=response.status===204?{}:await response.json().catch(()=>({error:"invalid_response"}));
    if(!response.ok) throw new Error(data.error||data.test?.error_category||"Operation failed");
    return data;
  };
  const result=queue.then(run,run); queue=result.catch(()=>{}); return result;
}
function field(data,name){return data.get(name)?.toString().trim()||""}
function csv(value){return value.split(",").map(v=>v.trim().toLowerCase()).filter(Boolean)}
function mailboxPayload(formElement,credentials,includeEnabled=false){
  const data=new FormData(formElement); const value={display_name:field(data,"display_name"),email:field(data,"email"),brand:field(data,"brand"),purpose:field(data,"purpose"),imap_host:field(data,"imap_host").toLowerCase(),imap_port:Number(field(data,"imap_port")),tls_mode:field(data,"tls_mode"),allowed_folders:field(data,"allowed_folders").split(",").map(v=>v.trim()).filter(Boolean),send_enabled:formElement.elements.send_enabled.checked,send_transport:field(data,"send_transport"),smtp_host:field(data,"smtp_host").toLowerCase()||null,smtp_port:Number(field(data,"smtp_port")),smtp_tls_mode:field(data,"smtp_tls_mode")};
  if(credentials){if(localDemo){value.username="synthetic-local-only";value.password="synthetic-local-only"}else{value.username=field(data,"username");value.password=field(data,"password")}} if(includeEnabled)value.enabled=formElement.elements.enabled.checked;return value;
}
function button(text,action,kind=""){const el=document.createElement("button");el.textContent=text;el.type="button";if(kind)el.className=kind;if(localDemo&&text==="Replace credentials")el.classList.add("hidden");el.addEventListener("click",action);return el}
function render(){list.replaceChildren();if(!mailboxes.length){const empty=document.createElement("div");empty.className="card meta";empty.textContent="No mailboxes have been added yet.";list.append(empty);return}
  for(const box of mailboxes){const card=document.createElement("article");card.className="card";const title=document.createElement("h2");title.textContent=box.display_name;const email=document.createElement("div");email.className="meta";email.textContent=box.email+" · "+box.brand;const status=document.createElement("span");status.className="status";status.textContent=(box.enabled?"Enabled · ":"Disabled · ")+box.connection_status;const host=document.createElement("p");host.className="meta";host.textContent=box.imap_host+":"+box.imap_port+" · "+box.tls_mode;const checked=document.createElement("p");checked.className="meta";checked.textContent="Last successful test: "+(box.last_successful_check?new Date(box.last_successful_check).toLocaleString():"none");const actions=document.createElement("div");actions.className="actions";
    actions.append(button("Edit",()=>openEdit(box)),button("Test",()=>operation(async()=>{const data=await request("/mailboxes/"+box.mailbox_id+"/test",{method:"POST",body:"{}"});say("Test: "+data.test.status);await refresh()})),button("Replace credentials",()=>openReplace(box.mailbox_id)),button("Safe Send policy",()=>openPolicy(box.mailbox_id)),button(box.enabled?"Disable":"Enable",()=>operation(async()=>{await request("/mailboxes/"+box.mailbox_id+"/"+(box.enabled?"disable":"enable"),{method:"POST",body:"{}"});await refresh()})),button("Delete",()=>openDeleteMailbox(box.mailbox_id),"danger"));card.append(title,email,status,host,checked,actions);list.append(card)}
}
async function refresh(){const data=await request("/mailboxes");mailboxes=data.mailboxes;render()}
async function operation(work){try{say("Working…");await work();if(message.textContent==="Working…")say("Done.")}catch(error){say(error instanceof Error?error.message:"Operation failed")}}
function openAdd(){form.reset();document.querySelector("#editingId").value="";document.querySelector("#editorTitle").textContent="Add mailbox";for(const el of form.querySelectorAll(".credential,.create-only"))el.classList.remove("hidden");form.elements.purpose.value="Primary mailbox";form.elements.imap_port.value="993";form.elements.allowed_folders.value="INBOX";form.elements.smtp_port.value="465";form.elements.enabled.checked=true;editor.showModal()}
function openEdit(box){form.reset();document.querySelector("#editingId").value=box.mailbox_id;document.querySelector("#editorTitle").textContent="Edit mailbox";for(const el of form.querySelectorAll(".credential,.create-only"))el.classList.add("hidden");for(const name of ["display_name","email","brand","purpose","imap_host","imap_port","tls_mode","send_transport","smtp_host","smtp_port","smtp_tls_mode"])form.elements[name].value=box[name]??"";form.elements.send_enabled.checked=Boolean(box.send_enabled);form.elements.allowed_folders.value=box.allowed_folders.join(", ");editor.showModal()}
function openReplace(id){replaceForm.reset();document.querySelector("#replaceId").value=id;replace.showModal()}
function openPolicy(id){operation(async()=>{const data=await request("/mailboxes/"+id+"/send-policy");const value=data.policy;policyForm.reset();document.querySelector("#policyId").value=id;for(const name of ["send_mode","external_recipients","max_recipients","max_per_hour","max_per_day","confirmation_ttl_seconds"])policyForm.elements[name].value=value[name];policyForm.elements.allowed_domains.value=value.allowed_domains.join(", ");policyForm.elements.denied_domains.value=value.denied_domains.join(", ");policyDialog.showModal()})}
function openDeleteMailbox(id){deleteMailboxForm.reset();document.querySelector("#deleteMailboxId").value=id;document.querySelector("#deleteMailboxConfirmationLabel").textContent=id;deleteMailboxDialog.showModal()}
document.querySelector("#add").addEventListener("click",openAdd);document.querySelector("#cancelEditor").addEventListener("click",()=>{scrub(form);editor.close()});document.querySelector("#cancelReplace").addEventListener("click",()=>{scrub(replaceForm);replace.close()});document.querySelector("#cancelPolicy").addEventListener("click",()=>policyDialog.close());document.querySelector("#cancelDeleteMailbox").addEventListener("click",()=>deleteMailboxDialog.close());document.querySelector("#cancelDeleteAll").addEventListener("click",()=>deleteAllDialog.close());
document.querySelector("#testDraft").addEventListener("click",()=>operation(async()=>{if(document.querySelector("#editingId").value){say("Use the Test button on the saved mailbox card.");return}const payload=mailboxPayload(form,true,false);try{const data=await request("/mailboxes/test",{method:"POST",body:JSON.stringify(payload)});say("Test: "+data.test.status)}finally{payload.password="";payload.username="";scrub(form)}}));
form.addEventListener("submit",event=>{event.preventDefault();operation(async()=>{const id=document.querySelector("#editingId").value;if(id){const payload=mailboxPayload(form,false,false);await request("/mailboxes/"+id,{method:"PATCH",body:JSON.stringify(payload)});editor.close();await refresh()}else{const payload=mailboxPayload(form,true,true);try{await request("/mailboxes",{method:"POST",body:JSON.stringify(payload)});editor.close();await refresh()}finally{payload.password="";payload.username="";scrub(form)}}})});
replaceForm.addEventListener("submit",event=>{event.preventDefault();operation(async()=>{const id=document.querySelector("#replaceId").value;const data=new FormData(replaceForm);const payload={username:field(data,"username"),password:field(data,"password")};try{await request("/mailboxes/"+id+"/replace-credentials",{method:"POST",body:JSON.stringify(payload)});replace.close();await refresh()}finally{payload.password="";payload.username="";scrub(replaceForm)}})});
policyForm.addEventListener("submit",event=>{event.preventDefault();operation(async()=>{const id=document.querySelector("#policyId").value;const data=new FormData(policyForm);const payload={send_mode:field(data,"send_mode"),require_confirmation:true,allowed_domains:csv(field(data,"allowed_domains")),denied_domains:csv(field(data,"denied_domains")),max_recipients:Number(field(data,"max_recipients")),max_per_hour:Number(field(data,"max_per_hour")),max_per_day:Number(field(data,"max_per_day")),external_recipients:field(data,"external_recipients"),confirmation_ttl_seconds:Number(field(data,"confirmation_ttl_seconds"))};await request("/mailboxes/"+id+"/send-policy",{method:"PATCH",body:JSON.stringify(payload)});policyDialog.close();say("Safe Send policy saved.")})});
deleteMailboxForm.addEventListener("submit",event=>{event.preventDefault();operation(async()=>{const confirmation=field(new FormData(deleteMailboxForm),"confirmation");const id=document.querySelector("#deleteMailboxId").value;if(confirmation!==id)throw new Error("Mailbox ID confirmation did not match");await request("/mailboxes/"+id,{method:"DELETE",body:JSON.stringify({confirmation})});deleteMailboxDialog.close();await refresh()})});
document.querySelector("#deleteAll").addEventListener("click",()=>{deleteAllForm.reset();deleteAllDialog.showModal()});
deleteAllForm.addEventListener("submit",event=>{event.preventDefault();operation(async()=>{const confirmation=field(new FormData(deleteAllForm),"confirmation");if(confirmation!=="DELETE ALL MAILBRIDGE DATA")throw new Error("Invalid confirmation");await request("/account/data",{method:"DELETE",body:JSON.stringify({confirmation})});deleteAllDialog.close();mailboxes=[];render();token="";csrf="";say("All application data and credentials were deleted.")})});
const initial=bridge.toolOutput?.mailboxes;if(Array.isArray(initial)){mailboxes=initial;render()}operation(refresh);
</script>
</body>
</html>`;
}
