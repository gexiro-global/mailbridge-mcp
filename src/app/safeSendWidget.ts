export const MAILBRIDGE_SAFE_SEND_WIDGET_URI = "ui://mailbridge/safe-send-v2.1.0.html";

export function mailbridgeSafeSendWidgetHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>MailBridge — Safe Send</title>
  <style>
    :root{color-scheme:light dark;font:14px/1.45 ui-sans-serif,system-ui,sans-serif;--accent:#5b4df7;--danger:#b42318;--ok:#067647;--line:color-mix(in srgb,currentColor 18%,transparent);--muted:color-mix(in srgb,currentColor 62%,transparent)}
    *{box-sizing:border-box}body{margin:0;background:transparent;color:CanvasText}main{max-width:900px;margin:auto;padding:18px}.top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}h1{font-size:20px;margin:0}h2{font-size:16px;margin:0 0 8px}.muted{color:var(--muted)}.panel{border:1px solid var(--line);border-radius:14px;padding:14px;margin-top:12px;background:color-mix(in srgb,Canvas 97%,var(--accent) 3%)}form{display:grid;grid-template-columns:1fr 1fr;gap:10px}label{display:grid;gap:4px;color:var(--muted)}label.wide{grid-column:1/-1}input,textarea{width:100%;padding:9px;border:1px solid var(--line);border-radius:8px;background:Canvas;color:CanvasText}textarea{min-height:180px;resize:vertical}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}button{border:1px solid var(--line);background:Canvas;border-radius:9px;padding:9px 12px;cursor:pointer}button.primary{background:var(--accent);border-color:var(--accent);color:white}button.danger{background:var(--danger);border-color:var(--danger);color:white}button:disabled{opacity:.45;cursor:not-allowed}.badge{display:inline-flex;padding:3px 8px;border-radius:999px;border:1px solid var(--line);margin:2px}.attachment{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px solid var(--line)}.attachment:last-child{border-bottom:0}.attachment button{padding:5px 8px}.ok{color:var(--ok)}.danger-text{color:var(--danger)}#status{min-height:22px;margin-top:10px}.hidden{display:none!important}@media(max-width:650px){form{grid-template-columns:1fr}label.wide{grid-column:1}.top{flex-direction:column}}
  </style>
</head>
<body>
<main>
  <div class="top"><div><h1>MailBridge Safe Send</h1><div class="muted">Draft → validation → one-time confirmation → SMTP</div></div><span id="version" class="badge">draft —</span></div>
  <section class="panel"><form id="composer">
    <label>From<input id="from" readonly></label>
    <label>To<input id="to" autocomplete="off" required></label>
    <label>CC<input id="cc" autocomplete="off"></label>
    <label>BCC<input id="bcc" autocomplete="off"></label>
    <label class="wide">Subject<input id="subject" maxlength="998" required></label>
    <label class="wide">Body<textarea id="body" maxlength="200000" required></textarea></label>
    <label class="wide">Attachments — up to 10 files, 10 MiB each, 18 MiB total<input id="files" type="file" multiple></label>
    <div id="attachments" class="wide" aria-live="polite"></div>
  </form><div class="actions"><button id="save">Save draft</button><button id="validate">Check policy</button></div><div id="status" role="status" aria-live="polite"></div></section>
  <section id="review" class="panel hidden"><h2>Pre-send review</h2><div id="policy"></div><div id="warnings"></div><div class="actions"><button id="prepare" class="primary">Prepare one-time confirmation</button></div></section>
  <section id="confirm" class="panel hidden"><h2>Final confirmation</h2><p>Review every field above. Clicking below performs an external, irreversible SMTP operation.</p><div id="expiry" class="muted"></div><div class="actions"><button id="send" class="danger">Send now</button><button id="cancel">Cancel confirmation</button></div></section>
  <section id="receipt" class="panel hidden"><h2>Send status</h2><div id="receiptText"></div></section>
</main>
<script type="module">
const pending=new Map();let nextId=1;let draft=null;let policy=null;let validation=null;let confirmation=null;
const el=id=>document.getElementById(id);const status=message=>{el("status").textContent=message};
function request(method,params){const id=nextId++;window.parent.postMessage({jsonrpc:"2.0",id,method,params},"*");return new Promise((resolve,reject)=>pending.set(id,{resolve,reject}))}
function callTool(name,args){return request("tools/call",{name,arguments:args}).then(result=>{if(result?.isError)throw new Error(result?.content?.[0]?.text||"Operation failed");return result?.structuredContent||result})}
function addresses(value){return value.split(",").map(v=>v.trim()).filter(Boolean)}
function compose(){return{mailbox_id:draft.mailbox_id,to:addresses(el("to").value),cc:addresses(el("cc").value),bcc:addresses(el("bcc").value),subject:el("subject").value.trim(),text_body:el("body").value}}
function resetApproval(){validation=null;confirmation=null;el("review").classList.add("hidden");el("confirm").classList.add("hidden")}
function formatBytes(value){return value<1024?value+" B":value<1048576?(value/1024).toFixed(1)+" KiB":(value/1048576).toFixed(1)+" MiB"}
function renderAttachments(){const host=el("attachments");host.replaceChildren();for(const item of draft?.attachments||[]){const row=document.createElement("div");row.className="attachment";const label=document.createElement("span");label.textContent=item.filename+" · "+formatBytes(item.size)+" · "+item.mime_type;const remove=document.createElement("button");remove.type="button";remove.dataset.removeAttachment=item.attachment_id;remove.textContent="Remove";row.append(label,remove);host.append(row)}if(!(draft?.attachments||[]).length){const empty=document.createElement("span");empty.className="muted";empty.textContent="No attachments.";host.append(empty)}}
function render(data){draft=data?.draft||draft;policy=data?.policy||policy;if(!draft)return;el("from").value=draft.mailbox_id;el("to").value=(draft.to||[]).join(", ");el("cc").value=(draft.cc||[]).join(", ");el("bcc").value=(draft.bcc||[]).join(", ");el("subject").value=draft.subject||"";el("body").value=draft.text_body||"";el("version").textContent="draft v"+draft.version;renderAttachments()}
async function save(){status("Saving…");const result=await callTool("update_draft",{draft_id:draft.draft_id,expected_version:draft.version,...compose()});draft=result.draft;resetApproval();render(result);status("Draft saved.")}
function fileBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error("Cannot read "+file.name));reader.onload=()=>resolve(String(reader.result).split(",",2)[1]||"");reader.readAsDataURL(file)})}
async function addFiles(){const files=[...el("files").files];if(!files.length)return;if(files.some(file=>file.size>10485760))throw new Error("Each attachment may be at most 10 MiB.");if((draft.attachments||[]).length+files.length>10)throw new Error("A draft may contain at most 10 attachments.");await save();for(const file of files){status("Encrypting attachment: "+file.name);const content_base64=await fileBase64(file);const result=await callTool("add_draft_attachment",{draft_id:draft.draft_id,expected_version:draft.version,filename:file.name,mime_type:file.type||"application/octet-stream",content_base64});draft=result.draft;render(result)}el("files").value="";resetApproval();status("Attachments added to the encrypted draft.")}
async function removeAttachment(attachment_id){await save();const result=await callTool("remove_draft_attachment",{draft_id:draft.draft_id,expected_version:draft.version,attachment_id});draft=result.draft;resetApproval();render(result);status("Attachment removed.")}
async function validate(){await save();status("Checking policy…");const result=await callTool("validate_draft",{draft_id:draft.draft_id});validation=result.validation;policy=result.policy;el("review").classList.remove("hidden");el("policy").textContent=validation.blocked?"BLOCKED: "+validation.reasons.join(", "):"PASS · recipients: "+validation.recipient_count+" · external: "+validation.external_recipient_count+" · hourly remaining: "+validation.remaining_hour;el("policy").className=validation.blocked?"danger-text":"ok";el("warnings").textContent=validation.warnings.length?"Warnings: "+validation.warnings.join(", "):"No warnings.";el("prepare").disabled=validation.blocked;status(validation.blocked?"Sending blocked.":"Policy PASS.")}
async function prepare(){status("Creating confirmation…");const result=await callTool("prepare_draft_send",{draft_id:draft.draft_id});confirmation=result.confirmation;el("confirm").classList.remove("hidden");el("expiry").textContent="Confirmation expires: "+new Date(confirmation.expires_at).toLocaleTimeString();status("A final user click is required.")}
async function send(){el("send").disabled=true;status("Sending…");try{const result=await callTool("send_draft",{draft_id:draft.draft_id,confirmation_id:confirmation.confirmation_id,expected_version:confirmation.draft_version});draft=result.draft;render(result);el("confirm").classList.add("hidden");el("receipt").classList.remove("hidden");const copy=result.receipt?.sent_copy;const copyText=copy?(" · Sent copy: "+copy.state+(copy.folder?" ("+copy.folder+")":"")):" · Sent copy: legacy_untracked";el("receiptText").textContent="State: "+result.operation.state+" · accepted: "+result.operation.accepted_count+" · rejected: "+result.operation.rejected_count+copyText;status("Operation finished: "+result.operation.state)}finally{el("send").disabled=false}}
for(const id of ["to","cc","bcc","subject","body"])el(id).addEventListener("input",resetApproval);el("files").addEventListener("change",()=>addFiles().catch(e=>status(e.message)));el("attachments").addEventListener("click",event=>{const id=event.target?.dataset?.removeAttachment;if(id)removeAttachment(id).catch(e=>status(e.message))});el("save").onclick=()=>save().catch(e=>status(e.message));el("validate").onclick=()=>validate().catch(e=>status(e.message));el("prepare").onclick=()=>prepare().catch(e=>status(e.message));el("send").onclick=()=>send().catch(e=>status(e.message));el("cancel").onclick=()=>{confirmation=null;el("confirm").classList.add("hidden");status("Confirmation was not used.")};
window.addEventListener("message",event=>{if(event.source!==window.parent)return;const message=event.data;if(!message||message.jsonrpc!=="2.0")return;if(message.id!==undefined&&pending.has(message.id)){const p=pending.get(message.id);pending.delete(message.id);message.error?p.reject(new Error(message.error.message||"Host error")):p.resolve(message.result);return}if(message.method==="ui/notifications/tool-result")render(message.params?.structuredContent)},{passive:true});
render(window.openai?.toolOutput);if(!draft)status("Waiting for draft data from MailBridge.");
</script>
</body>
</html>`;
}
