const ADMIN_BANNER = `<style>
body{padding-top:46px!important}
#admin-banner{position:fixed;top:0;left:0;right:0;height:46px;background:#b91c1c;color:#fff;
display:flex;align-items:center;justify-content:center;text-align:center;padding:0 12px;
font:600 14px system-ui,sans-serif;z-index:2147483600;box-shadow:0 2px 8px rgba(0,0,0,.4)}
@media(max-width:480px){body{padding-top:58px!important}#admin-banner{height:58px;font-size:12px;line-height:1.25}}
</style><div id="admin-banner">⚠ ADMIN — editing the BASE app. Changes affect ALL users.</div>`;

const OVERLAY_STYLE = `<style>
#fork-fab{position:fixed;right:16px;bottom:16px;width:54px;height:54px;border-radius:50%;
border:0;background:#f6821f;color:#111;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.4);
display:grid;place-items:center;z-index:2147483000}
#fork-panel{position:fixed;right:16px;bottom:80px;width:min(360px,calc(100vw - 24px));
max-height:75vh;overflow:auto;background:#16161d;color:#eaeaea;border:1px solid #2b2b35;
border-radius:14px;padding:16px;box-shadow:0 12px 40px rgba(0,0,0,.5);z-index:2147483000;
font-family:system-ui,sans-serif}
@media(max-width:480px){#fork-panel{left:12px;right:12px;width:auto;bottom:78px;max-height:72vh}}
#fork-panel h3{margin:0 0 8px;font-size:16px}#fork-panel h4{margin:16px 0 6px;font-size:12px;
text-transform:uppercase;letter-spacing:.05em;color:#9a9aa6}
#fork-panel .muted{color:#9a9aa6;font-size:12px}
#fork-panel textarea{width:100%;box-sizing:border-box;min-height:64px;border-radius:9px;
border:1px solid #33333d;background:#0b0b0f;color:#eee;padding:10px;font-family:inherit;font-size:16px;resize:vertical}
#fork-panel input{width:100%;box-sizing:border-box;border-radius:9px;border:1px solid #33333d;
background:#0b0b0f;color:#eee;padding:10px;font-size:16px}
#fork-panel button.act{margin-top:8px;width:100%;padding:10px;border:0;border-radius:9px;
background:#f6821f;color:#111;font-weight:600;cursor:pointer}
.fp-commit{border:1px solid #26262e;border-radius:8px;padding:8px 10px;margin:6px 0}
.fp-commit .fp-msg{font-size:13px;margin-bottom:4px}
.fp-commit .fp-row{display:flex;align-items:center;gap:8px}
.fp-commit code{color:#f6821f;font-size:12px;flex:1}
.fp-revert{background:#1b1b22;color:#eee;border:1px solid #33333d;border-radius:7px;
padding:3px 10px;font-size:12px;cursor:pointer}
.fp-toggle{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:2px 0 8px}
.fp-mode{background:#0b0b0f;color:#9a9aa6;border:1px solid #33333d;border-radius:7px;
padding:4px 9px;font-size:12px;cursor:pointer}
.fp-mode.on{background:#f6821f;color:#111;border-color:#f6821f;font-weight:600}
</style>`;

const OVERLAY_SCRIPT = `<script>
(function(){
  var F = window.__FORK || { loggedIn:false };
  var fab=document.createElement('button');
  fab.id='fork-fab';
  fab.title = F.admin ? 'Edit the base app' : (F.loggedIn ? 'Customize your fork' : 'Fork this app');
  if(F.admin){ fab.style.background='#b91c1c'; fab.style.color='#fff'; }
  fab.innerHTML='<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="12" cy="19" r="2.2"/><path d="M6 8.2v1.3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V8.2"/><path d="M12 12.8v4"/></svg>';
  var panel=document.createElement('div');
  panel.id='fork-panel'; panel.style.display='none';
  document.body.appendChild(panel); document.body.appendChild(fab);
  var open=false;
  fab.onclick=function(){ open=!open; panel.style.display=open?'block':'none'; if(open) render(); };
  function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
  function setStatus(t,err){ var e=document.getElementById('fp-status'); if(e){ e.textContent=t||''; e.style.color=err?'#ff6b6b':'#9a9aa6'; } }
  var toggleHtml='<div class="fp-toggle"><span class="muted">Model</span>'
    +'<button id="fp-m-fast" class="fp-mode" data-m="fast">⚡ Fast</button>'
    +'<button id="fp-m-capable" class="fp-mode" data-m="capable">🧠 Capable</button></div>';
  function curModel(){ try{ return localStorage.getItem('forkModel')==='fast'?'fast':'capable'; }catch(e){ return 'capable'; } }
  function paintToggle(){
    var cur=curModel();
    var b=document.querySelectorAll('#fork-panel .fp-mode');
    for(var i=0;i<b.length;i++){ b[i].className='fp-mode'+(b[i].getAttribute('data-m')===cur?' on':''); }
  }
  function wireToggle(){
    var b=document.querySelectorAll('#fork-panel .fp-mode');
    for(var i=0;i<b.length;i++){ b[i].addEventListener('click', function(){ try{localStorage.setItem('forkModel',this.getAttribute('data-m'));}catch(e){} paintToggle(); }); }
    paintToggle();
  }
  function render(){
    if(F.admin){
      panel.innerHTML='<h3>Edit the BASE app</h3><p class="muted">Your changes update the root app for everyone. Existing forks will see “Pull base updates”.</p>'
        +toggleHtml
        +'<textarea id="fp-prompt" placeholder="Describe a base change… e.g. add a footer with a help link to every dashboard"></textarea>'
        +'<button class="act" id="fp-gen" style="background:#b91c1c;color:#fff">Generate base update</button>'
        +'<div id="fp-status" class="muted" style="margin-top:8px"></div>'
        +'<h4>Base history</h4><div id="fp-log" class="muted">Loading…</div>'
        +'<button class="act" id="fp-reset" style="margin-top:14px;background:#3a0d0d;color:#ff9a9a;border:1px solid #5b1a1a">Reset ALL state</button>'
        +'<div style="margin-top:10px;text-align:right">'
        +'<a href="/logout" style="color:#9a9aa6;font-size:12px;text-decoration:none">Exit admin ↪</a></div>';
      document.getElementById('fp-gen').onclick=generate;
      document.getElementById('fp-reset').onclick=resetAll;
      wireToggle();
      loadLog();
      return;
    }
    if(!F.loggedIn){
      panel.innerHTML='<h3>Fork this app</h3><p class="muted">Pick a name to get your own private copy you can change with AI.</p>'
        +'<form method="POST" action="/login"><input name="name" placeholder="e.g. alice" required/>'
        +'<button class="act" type="submit">Create my fork</button></form>';
      return;
    }
    panel.innerHTML='<h3>Customize with AI</h3>'
      +toggleHtml
      +'<textarea id="fp-prompt" placeholder="Describe a change… e.g. make the header purple, rename the title to Tasks, and add a done count"></textarea>'
      +'<button class="act" id="fp-gen">Generate new version</button>'
      +'<button class="act" id="fp-merge" style="display:none;background:#1b1b22;color:#eee;border:1px solid #33333d">Pull base updates ↓</button>'
      +'<div id="fp-status" class="muted" style="margin-top:8px"></div>'
      +'<h4>History</h4><div id="fp-log" class="muted">Loading…</div>'
      +'<div style="margin-top:14px;padding-top:12px;border-top:1px solid #26262e;text-align:right">'
      +'<a href="/logout" style="color:#9a9aa6;font-size:12px;text-decoration:none">Log out '+esc(F.user||'')+' ↪</a></div>';
    document.getElementById('fp-gen').onclick=generate;
    document.getElementById('fp-merge').onclick=merge;
    wireToggle();
    loadLog();
  }
  function resetAll(){
    if(!confirm('Delete ALL forks and reset the base to a single commit?')) return;
    setStatus('Resetting everything…');
    fetch('/admin/reset',{method:'POST'}).then(function(r){return r.json();}).then(function(s){
      if(s.error){ setStatus(s.error,true); }
      else { setStatus('Reset — deleted '+s.deletedForks+' fork repos, wiped '+s.wipedForks+' fork sessions, base reset. Reloading…'); setTimeout(function(){ location.reload(); },900); }
    }).catch(function(e){ setStatus(String(e),true); });
  }
  function merge(){
    setStatus('Pulling base updates…'); document.getElementById('fp-merge').disabled=true;
    fetch('/api/merge',{method:'POST'}).then(function(r){return r.json();}).then(function(s){
      if(s.error){ setStatus(s.error,true); document.getElementById('fp-merge').disabled=false; }
      else if(s.note && s.note.indexOf('Already')===0){ setStatus(s.note); loadLog(); document.getElementById('fp-merge').disabled=false; }
      else { setStatus('Merged — reloading…'); setTimeout(function(){ location.reload(); },300); }
    }).catch(function(e){ setStatus(String(e),true); document.getElementById('fp-merge').disabled=false; });
  }
  function loadLog(){
    fetch('/api/state').then(function(r){return r.json();}).then(function(s){
      var mb=document.getElementById('fp-merge');
      if(mb){ mb.style.display = s.baseAhead ? 'block' : 'none'; }
      var log=s.log||[];
      document.getElementById('fp-log').innerHTML = log.map(function(c){
        return '<div class="fp-commit"><div class="fp-msg">'+esc(c.message)+'</div>'
          +'<div class="fp-row"><code>'+c.short+'</code>'
          +'<button class="fp-revert" data-oid="'+c.oid+'">Revert</button></div></div>';
      }).join('') || '<span class="muted">No commits yet.</span>';
      var b=panel.querySelectorAll('.fp-revert');
      for(var i=0;i<b.length;i++){ b[i].addEventListener('click', function(){ revert(this.getAttribute('data-oid')); }); }
    });
  }
  function activity(c){
    var t=(c&&c.type)||'';
    if(t.indexOf('tool')===0 && c.toolName){ return '🔧 '+c.toolName+'…'; }
    if(t.indexOf('reasoning')===0){ return '💭 thinking…'; }
    if(t.indexOf('text')===0){ return '✍️ writing…'; }
    return '';
  }
  function generate(){
    var p=(document.getElementById('fp-prompt').value||'').trim(); if(!p) return;
    var gen=document.getElementById('fp-gen'); gen.disabled=true; setStatus('Agent starting…');
    fetch('/api/agent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:p,model:curModel()})})
      .then(function(resp){
        if(!resp.body){ throw new Error('no stream'); }
        var reader=resp.body.getReader(); var dec=new TextDecoder(); var buf='';
        function pump(){ return reader.read().then(function(res){
          if(res.done) return;
          buf += dec.decode(res.value,{stream:true});
          var blocks=buf.split('\\n\\n'); buf=blocks.pop();
          for(var i=0;i<blocks.length;i++){
            var line=blocks[i].replace(/^data: /,''); if(!line) continue;
            var msg; try{ msg=JSON.parse(line); }catch(e){ continue; }
            if(msg.kind==='status'){ setStatus(msg.text); }
            else if(msg.kind==='event'){ var c; try{c=JSON.parse(msg.chunk);}catch(e){continue;} var a=activity(c); if(a) setStatus(a); }
            else if(msg.kind==='done'){
              if(msg.error){ setStatus(msg.error,true); gen.disabled=false; }
              else { setStatus('Done — reloading…'); setTimeout(function(){ location.reload(); },500); }
            }
          }
          return pump();
        }); }
        return pump();
      }).catch(function(e){ setStatus(String(e),true); gen.disabled=false; });
  }
  function revert(oid){
    setStatus('Reverting…');
    fetch('/api/revert',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({oid:oid})})
      .then(function(r){return r.json();}).then(function(s){
        if(s.error){ setStatus(s.error,true); } else { location.reload(); }
      }).catch(function(e){ setStatus(String(e),true); });
  }
})();
</script>`;

export function appOverlay(asAdmin: boolean, loggedIn: boolean, user: string): string {
  const flag = JSON.stringify({ loggedIn, admin: asAdmin, user });
  const banner = asAdmin ? ADMIN_BANNER : "";
  return banner + `<script>window.__FORK=${flag};</script>` + OVERLAY_STYLE + OVERLAY_SCRIPT;
}
