import http from 'node:http';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { SERVER_HOST, SERVER_PORT, FEDERATION_TOKEN, FEDERATION_TOKEN_FILE, AWS_FEDERATION_PUBLIC_KEY_FILE, NODE_ID } from './config.mjs';
import { openDb, eventsAfter, importEvents, heartbeat } from './db.mjs';

openDb(); heartbeat('0.3.0');

async function bearerToken(){
  if (FEDERATION_TOKEN) return FEDERATION_TOKEN;
  try { return (await fs.readFile(FEDERATION_TOKEN_FILE,'utf8')).trim(); } catch { return ''; }
}
async function awsPublicKey(){
  try { return await fs.readFile(AWS_FEDERATION_PUBLIC_KEY_FILE,'utf8'); } catch { return ''; }
}
function requestUrl(req){ return new URL(req.url,`http://${req.headers.host||'localhost'}`); }
function sha256(buf){ return crypto.createHash('sha256').update(buf).digest('hex'); }

async function auth(req,rawBody=Buffer.alloc(0)){
  const token=await bearerToken();
  if(token){
    const cookie=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('xavi_sky_federation='));
    const cv=cookie?decodeURIComponent(cookie.split('=').slice(1).join('=')):'';
    if(req.headers.authorization===`Bearer ${token}` || req.headers['x-xavi-sky-token']===token || cv===token) return true;
  }

  const node=String(req.headers['x-xavi-sky-node']||'');
  const timestamp=String(req.headers['x-xavi-sky-timestamp']||'');
  const signature=String(req.headers['x-xavi-sky-signature']||'');
  if(node!=='aws-lambda-primary' || !timestamp || !signature) return false;
  const t=Date.parse(timestamp);
  if(!Number.isFinite(t) || Math.abs(Date.now()-t)>300000) return false;
  const key=await awsPublicKey();
  if(!key) return false;
  const u=requestUrl(req);
  const canonical=[String(req.method||'GET').toUpperCase(),`${u.pathname}${u.search}`,timestamp,sha256(rawBody)].join('\n');
  try {
    return crypto.verify('sha256',Buffer.from(canonical),key,Buffer.from(signature,'base64url'));
  } catch { return false; }
}
function send(res,status,obj){const body=JSON.stringify(obj);res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(body);}
async function rawBody(req){
  const chunks=[]; let size=0;
  for await(const c of req){size+=c.length;if(size>5_000_000)throw new Error('body too large');chunks.push(c);}
  return Buffer.concat(chunks);
}

const server=http.createServer(async(req,res)=>{
  try{
    const u=requestUrl(req);
    if(u.pathname==='/v1/health') return send(res,200,{ok:true,nodeId:NODE_ID});
    const raw=req.method==='POST'?await rawBody(req):Buffer.alloc(0);
    if(!(await auth(req,raw))) return send(res,401,{error:'auth'});
    if(req.method==='GET'&&u.pathname==='/api/xavi/sky/federation/pull'){
      const after=Number(u.searchParams.get('after')||0), limit=Number(u.searchParams.get('limit')||500);
      const rows=eventsAfter(after,limit); return send(res,200,{events:rows.map(({ingest_seq,...e})=>e),nextCursor:rows.length?Number(rows.at(-1).ingest_seq):after});
    }
    if(req.method==='POST'&&u.pathname==='/api/xavi/sky/federation/push'){
      const data=raw.length?JSON.parse(raw.toString('utf8')):{};
      const accepted=importEvents(Array.isArray(data.events)?data.events:[]); heartbeat('0.3.0');
      return send(res,200,{ok:true,accepted});
    }
    send(res,404,{error:'not found'});
  }catch(e){send(res,500,{error:String(e?.message||e)});}
});
server.listen(SERVER_PORT,SERVER_HOST,()=>console.log(`Xavi-Sky federation ${NODE_ID} listening on ${SERVER_HOST}:${SERVER_PORT}`));
