import fs from 'node:fs/promises';
import { FEDERATION_TOKEN, FEDERATION_TOKEN_FILE, PEERS, NODE_ID } from './config.mjs';
import { eventsAfter, importEvents, peerCursor, savePeerCursor } from './db.mjs';

async function token() {
  if (FEDERATION_TOKEN) return FEDERATION_TOKEN;
  try { return (await fs.readFile(FEDERATION_TOKEN_FILE,'utf8')).trim(); } catch { return ''; }
}
function peerId(url) { try { return new URL(url).host; } catch { return url; } }
function base(url) { return String(url).replace(/\/+$/,''); }
async function call(url, opts={}) {
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),8000);
  try {
    const t=await token();
    const headers={accept:'application/json',...(opts.body?{'content-type':'application/json'}:{}),...(t?{authorization:`Bearer ${t}`,'x-xavi-sky-token':t,'cookie':`xavi_sky_federation=${encodeURIComponent(t)}`}:{})};
    const r=await fetch(url,{...opts,headers:{...headers,...opts.headers},signal:controller.signal});
    const text=await r.text(); let data={}; try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
    if(!r.ok) throw new Error(`HTTP ${r.status}: ${data.error||text.slice(0,200)}`);
    return data;
  } finally { clearTimeout(timer); }
}

export async function syncAllPeers() {
  const results=[];
  for (const peer of PEERS) {
    try { results.push(await syncPeer(peer)); }
    catch (e) {
      savePeerCursor(peerId(peer),{last_error:String(e?.message||e)});
      results.push({peer,ok:false,error:String(e?.message||e)});
    }
  }
  return results;
}

export async function syncPeer(peer) {
  const id=peerId(peer), c=peerCursor(id), root=base(peer);
  let pushed=0,pulled=0,pushAfter=Number(c.push_after||0),pullAfter=Number(c.pull_after||0);
  for (let round=0;round<5;round++) {
    const batch=eventsAfter(pushAfter,500);
    if(!batch.length) break;
    const body={nodeId:NODE_ID,events:batch.map(({ingest_seq,...e})=>e)};
    await call(`${root}/api/xavi/sky/federation/push`,{method:'POST',body:JSON.stringify(body)});
    pushAfter=Number(batch.at(-1).ingest_seq); pushed+=batch.length;
    savePeerCursor(id,{push_after:pushAfter,last_push_at:new Date().toISOString(),last_error:''});
    if(batch.length<500) break;
  }
  for (let round=0;round<5;round++) {
    const data=await call(`${root}/api/xavi/sky/federation/pull?after=${encodeURIComponent(pullAfter)}&limit=500`);
    const events=Array.isArray(data.events)?data.events:[];
    pulled+=importEvents(events);
    pullAfter=Number(data.nextCursor??pullAfter);
    savePeerCursor(id,{pull_after:pullAfter,last_pull_at:new Date().toISOString(),last_error:''});
    if(events.length<500) break;
  }
  return {peer,ok:true,pushed,pulled,pushAfter,pullAfter};
}
