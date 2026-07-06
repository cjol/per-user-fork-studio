import { DurableObject } from "cloudflare:workers";

// Single-file app: a per-fork Durable Object that server-renders the dashboard
// and persists items in this.ctx.storage. Plain HTML + inline JS, no build deps.
type Item = { id: number; text: string };

const TITLE = "My Dashboard";
const ACCENT = "#f6821f";

// Browser script (kept dependency-free; single quotes + unquoted HTML attrs so
// it needs no escaping).
const CLIENT_JS =
  "var list=document.getElementById('list');" +
  "var input=document.getElementById('draft');" +
  "function esc(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');}" +
  "function render(items){list.innerHTML=items.map(function(it){return '<li><span>'+esc(it.text)+'</span><button class=del data-id='+it.id+'>x</button></li>';}).join('');}" +
  "function add(){var t=input.value.trim();if(!t)return;fetch('/api/items',{method:'POST',body:JSON.stringify({text:t})}).then(function(r){return r.json();}).then(function(items){render(items);input.value='';});}" +
  "function del(id){fetch('/api/items?id='+id,{method:'DELETE'}).then(function(r){return r.json();}).then(render);}" +
  "document.getElementById('add').onclick=add;" +
  "input.addEventListener('keydown',function(e){if(e.key==='Enter')add();});" +
  "list.addEventListener('click',function(e){if(e.target.classList.contains('del'))del(e.target.getAttribute('data-id'));});";

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function page(items: Item[]): string {
  const rows = items
    .map(function (it) {
      return '<li><span>' + escHtml(it.text) + '</span><button class=del data-id=' + it.id + '>x</button></li>';
    })
    .join("");
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"/>' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"/>' +
    '<title>' + TITLE + '</title><style>' +
    '*{box-sizing:border-box}html,body{margin:0}' +
    'body{font-family:system-ui,sans-serif;background:#0b0b0f;color:#eaeaea}' +
    '.hdr{background:' + ACCENT + ';color:#111;padding:24px}.hdr h1{margin:0;font-size:26px}' +
    '.wrap{padding:24px;max-width:640px;margin:0 auto}' +
    '.row{display:flex;gap:8px;margin-bottom:12px}' +
    '.row input{flex:1;min-width:0;padding:12px;border-radius:8px;border:1px solid #33333d;background:#0b0b0f;color:#eee;font-size:16px}' +
    '.row button{padding:12px 16px;border-radius:8px;border:0;background:' + ACCENT + ';color:#111;font-weight:600;cursor:pointer}' +
    'ul{list-style:none;padding:0;margin:0}' +
    'li{background:#16161d;border:1px solid #26262e;border-radius:10px;padding:12px 16px;margin:8px 0;display:flex;align-items:center;gap:8px}' +
    'li span{flex:1;word-break:break-word}li .del{background:transparent;color:#888;border:0;font-size:22px;cursor:pointer}' +
    '@media(max-width:480px){.hdr{padding:16px}.hdr h1{font-size:20px}.wrap{padding:16px}}' +
    '</style></head><body>' +
    '<header class="hdr"><h1>' + TITLE + '</h1></header>' +
    '<main class="wrap"><p>Your items are saved on the server and survive reloads.</p>' +
    '<div class="row"><input id="draft" placeholder="Add an item"/><button id="add">Add</button></div>' +
    '<ul id="list">' + rows + '</ul></main>' +
    '<script>' + CLIENT_JS + '</script></body></html>';
}

export class App extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const items = ((await this.ctx.storage.get("items")) as Item[]) ?? [];
    if (url.pathname === "/api/items") {
      if (request.method === "POST") {
        const body = (await request.json()) as { text: string };
        items.push({ id: Date.now(), text: body.text });
        await this.ctx.storage.put("items", items);
        return Response.json(items);
      }
      if (request.method === "DELETE") {
        const id = Number(url.searchParams.get("id"));
        const next = items.filter(function (i) { return i.id !== id; });
        await this.ctx.storage.put("items", next);
        return Response.json(next);
      }
      return Response.json(items);
    }
    return new Response(page(items), {
      headers: { "content-type": "text/html;charset=utf-8" }
    });
  }
}
