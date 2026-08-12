/* ══════════════════════════════════════════════════════════════════════
   LOADER + LOCK
   The app body above is inert text until the parcel is available. When the
   file is locked, the parcel exists only as AES-GCM ciphertext, so a
   stranger who opens the public URL gets the shell and nothing else.
   ══════════════════════════════════════════════════════════════════════ */
/*PARCEL_BEGIN*/
var PARCEL_ENC = null;                 /* set by "Lock this file" */
var PARCEL_RAW = __PARCEL_GEOJSON__;
/*PARCEL_END*/

const b64e = buf => {                       /* chunked: spreading 138 KB as args overflows the stack */
  const a = new Uint8Array(buf); let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  return btoa(s);
};
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const ITER = 310000;                   /* PBKDF2 rounds — slows offline guessing */

async function keyFrom(pass, salt){
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:ITER, hash:'SHA-256'},
    base, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
}
async function encryptParcel(obj, pass){
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await keyFrom(pass, salt);
  const ct   = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key,
                 new TextEncoder().encode(JSON.stringify(obj)));
  return {v:1, salt:b64e(salt), iv:b64e(iv), ct:b64e(ct)};
}
async function decryptParcel(enc, pass){
  const key = await keyFrom(pass, b64d(enc.salt));
  const pt  = await crypto.subtle.decrypt({name:'AES-GCM', iv:b64d(enc.iv)}, key, b64d(enc.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
let appStarted = false;
function runApp(){
  if(appStarted) return;                 /* one instance only */
  appStarted = true;
  const s = document.createElement('script');
  s.id = 'appinj';
  s.textContent = document.getElementById('appsrc').textContent;
  document.body.appendChild(s);
}

/* Re-locks this exact file with a new passphrase and hands back a copy to
   upload. The unlocked original never has to leave your machine. */
window.lockFile = async function(pass){
  const enc = await encryptParcel(window.__PARCEL__, pass);
  /* Re-fetch the pristine file rather than serialising the live DOM. Cloning
     picked up runtime state — populated dropdowns, coordinate readouts — which
     leaked feature names straight into the "locked" copy. */
  const res = await fetch(location.href, {cache:'reload'});
  if(!res.ok) throw new Error('could not read own source');
  let src = await res.text();
  const a = src.indexOf('/*PARCEL_BEGIN*/'), b = src.indexOf('/*PARCEL_END*/');
  if(a < 0 || b < 0) throw new Error('markers missing');
  src = src.slice(0, a) + '/*PARCEL_BEGIN*/\nvar PARCEL_ENC = ' + JSON.stringify(enc)
      + ';\nvar PARCEL_RAW = null;\n' + src.slice(b);
  const u = URL.createObjectURL(new Blob([src], {type:'text/html'}));
  const el = document.createElement('a');
  el.href = u; el.download = 'field-map-locked.html'; el.click();
  setTimeout(()=>URL.revokeObjectURL(u), 5000);
  return true;
};

(async function boot(){
  if(!PARCEL_ENC){ window.__PARCEL__ = PARCEL_RAW; runApp(); return; }
  const lock = document.getElementById('lock');
  const tryPass = async (p, remember) => {
    try{
      window.__PARCEL__ = await decryptParcel(PARCEL_ENC, p);
      window.__PASS__ = p;   /* sync reuses this so you set one passphrase, not two */
      if(remember){ try{ localStorage.setItem('fm_pass', p); }catch(e){} }
      lock.style.display = 'none';
      runApp();
      return true;
    }catch(e){ return false; }
  };
  let saved = null; try{ saved = localStorage.getItem('fm_pass'); }catch(e){}
  if(saved && await tryPass(saved, false)) return;
  lock.style.display = 'flex';
  const go = async () => {
    const p = document.getElementById('lkPass').value;
    if(!p) return;
    document.getElementById('lkErr').textContent = 'Checking…';
    if(!await tryPass(p, document.getElementById('lkSave').checked)){
      document.getElementById('lkErr').textContent = 'Wrong passphrase';
      document.getElementById('lkPass').select();
    }
  };
  document.getElementById('lkGo').onclick = go;
  document.getElementById('lkPass').onkeydown = e => { if(e.key === 'Enter') go(); };
  document.getElementById('lkPass').focus();
})();

/* offline: GitHub Pages sends max-age=600, so without this the app is gone
   ten minutes after your last load */
if('serviceWorker' in navigator){
  const reg = () => navigator.serviceWorker.register('sw.js').catch(()=>{});
  if(document.readyState === 'complete') reg(); else addEventListener('load', reg);
}
