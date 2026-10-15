import fs from 'node:fs/promises';
import { openDb, markAccountState } from './db.mjs';

const ENABLED = /^(1|true|yes|on)$/i.test(process.env.XAVI_SKY_FOLLOW_ENABLED || '');
const ACCOUNTS_FILE = process.env.XAVI_SKY_ACCOUNTS_FILE || new URL('../secrets/bluesky-accounts.json', import.meta.url).pathname;
const PER_RUN = Math.max(1, Math.min(500, Number(process.env.XAVI_SKY_FOLLOW_MAX_PER_ACCOUNT || 300)));
const DAILY_MAX = Math.max(PER_RUN, Math.min(10000, Number(process.env.XAVI_SKY_FOLLOW_DAILY_MAX_PER_ACCOUNT || 6000)));
const WRITE_DELAY_MS = Math.max(75, Number(process.env.XAVI_SKY_FOLLOW_WRITE_DELAY_MS || 150));
const PUBLIC_API = 'https://public.api.bsky.app';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function loadAccounts() {
  const raw = JSON.parse(await fs.readFile(ACCOUNTS_FILE, 'utf8'));
  return Array.isArray(raw?.accounts) ? raw.accounts.filter(a => a?.handle && a?.appPassword) : [];
}
async function xrpc(base, method, name, body, token='') {
  const url = `${String(base).replace(/\/+$/,'')}/xrpc/${name}`;
  const r = await fetch(url, {
    method,
    headers: {
      accept: 'application/json',
      ...(body ? {'content-type':'application/json'} : {}),
      ...(token ? {authorization:`Bearer ${token}`} : {}),
      'user-agent':'Xavi-Sky/0.4',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data={}; try { data=text?JSON.parse(text):{}; } catch { data={raw:text}; }
  if(!r.ok) {
    const e = new Error(`${name} HTTP ${r.status}: ${data?.message||data?.error||text.slice(0,200)}`);
    e.status=r.status; e.data=data; throw e;
  }
  return {data,headers:r.headers};
}
async function createSession(account) {
  const service=account.service||'https://bsky.social';
  const {data}=await xrpc(service,'POST','com.atproto.server.createSession',{identifier:account.handle,password:account.appPassword});
  return {...data,service};
}
async function graphList(endpoint, actor, max=20000) {
  const out=[]; let cursor='';
  do {
    const u=new URL(`${PUBLIC_API}/xrpc/${endpoint}`);
    u.searchParams.set('actor',actor); u.searchParams.set('limit','100');
    if(cursor) u.searchParams.set('cursor',cursor);
    const r=await fetch(u,{headers:{accept:'application/json','user-agent':'Xavi-Sky/0.4'}});
    if(!r.ok) throw new Error(`${endpoint} HTTP ${r.status}`);
    const j=await r.json();
    const rows = endpoint.endsWith('getFollowers') ? (j.followers||[]) : (j.follows||[]);
    out.push(...rows); cursor=j.cursor||'';
  } while(cursor && out.length<max);
  return out.slice(0,max);
}
function actionCount(accountHandle, sinceIso) {
  const d=openDb();
  try {
    return Number(d.prepare(`SELECT COUNT(*) AS n FROM events
      WHERE account_handle=? AND event_type='account.state' AND created_at>=?
      AND json_extract(payload_json,'$.state')='followed'`).get(accountHandle,sinceIso)?.n||0);
  } catch {
    return Number(d.prepare(`SELECT COUNT(*) AS n FROM events
      WHERE account_handle=? AND event_type='account.state' AND created_at>=?
      AND payload_json LIKE '%"state":"followed"%'`).get(accountHandle,sinceIso)?.n||0);
  }
}
function candidates(accountHandle, limit=10000) {
  return openDb().prepare(`SELECT c.did,c.handle,c.score,c.last_seen_at
    FROM candidates c
    WHERE c.did<>'' AND NOT EXISTS (
      SELECT 1 FROM account_state s
      WHERE s.account_handle=? AND s.did=c.did AND s.state IN ('followed','unavailable')
    )
    ORDER BY c.score DESC,c.last_seen_at DESC LIMIT ?`).all(accountHandle,limit);
}
async function followOne(session, accountHandle, did, reason) {
  const record={$type:'app.bsky.graph.follow',subject:did,createdAt:new Date().toISOString()};
  await xrpc(session.service,'POST','com.atproto.repo.createRecord',
    {repo:session.did,collection:'app.bsky.graph.follow',record},session.accessJwt);
  markAccountState(accountHandle,did,'followed',reason);
}
export async function runFollowCycle() {
  if(!ENABLED) return {enabled:false,accounts:[]};
  const accounts=await loadAccounts();
  const results=[];
  for(const account of accounts) {
    const r={handle:account.handle,ok:false,followbacks:0,discovery:0,attempted:0,unavailable:0,errors:[]};
    try {
      const session=await createSession(account);
      const [following,followers]=await Promise.all([
        graphList('app.bsky.graph.getFollows',session.did),
        graphList('app.bsky.graph.getFollowers',session.did),
      ]);
      const followed=new Set(following.map(x=>x.did).filter(Boolean));
      followed.add(session.did);
      const oneHourAgo=new Date(Date.now()-3600_000).toISOString();
      const dayAgo=new Date(Date.now()-86400_000).toISOString();
      const usedHour=actionCount(account.handle,oneHourAgo), usedDay=actionCount(account.handle,dayAgo);
      const budget=Math.max(0,Math.min(PER_RUN-usedHour,DAILY_MAX-usedDay));
      const queue=[];
      for(const f of followers) if(f?.did && !followed.has(f.did)) queue.push({did:f.did,reason:'followback'});
      const queued=new Set(queue.map(x=>x.did));
      if(queue.length<budget) {
        for(const c of candidates(account.handle,Math.max(2000,budget*8))) {
          if(queue.length>=budget) break;
          if(!c?.did || followed.has(c.did) || queued.has(c.did) || c.did===session.did) continue;
          queue.push({did:c.did,reason:'discovery'}); queued.add(c.did);
        }
      }
      for(const q of queue.slice(0,budget)) {
        r.attempted++;
        try {
          await followOne(session,account.handle,q.did,q.reason);
          followed.add(q.did);
          if(q.reason==='followback') r.followbacks++; else r.discovery++;
        } catch(e) {
          const msg=String(e?.message||e);
          if(e?.status===401 && /taken down/i.test(msg)) {
            markAccountState(account.handle,q.did,'unavailable','account taken down');
            r.unavailable++;
          } else {
            r.errors.push({did:q.did,error:msg.slice(0,240)});
          }
          if(e?.status===429) break;
        }
        await sleep(WRITE_DELAY_MS);
      }
      r.ok=true; r.usedHourBefore=usedHour; r.usedDayBefore=usedDay; r.budget=budget;
    } catch(e) { r.errors.push({error:String(e?.message||e).slice(0,500)}); }
    results.push(r);
  }
  return {enabled:true,perRun:PER_RUN,dailyMax:DAILY_MAX,accounts:results};
}
