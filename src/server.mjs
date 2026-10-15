import http from 'node:http';
import fs from 'node:fs/promises';
import { SERVER_HOST, SERVER_PORT, FEDERATION_TOKEN, FEDERATION_TOKEN_FILE, NODE_ID } from './config.mjs';
import { openDb, eventsAfter, importEvents, heartbeat } from './db.mjs';

openDb(); heartbeat('0.2.0');
async function auth(req){
  let t=FEDERATION_TOKEN;
  if(!t){try{t=(await fs.readFile(FEDERATION_TOKEN_FILE,'utf8')).trim();}catch{}}
  if(!t) return false;
  const cookie=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('xavi_sky_federation=')); const cv=cookie?decodeURIComponent(cookie.split('=').slice(1).join('=')):''; return req.headers.authorization===`Bearer ${t}` || req.headers['x-xavi-sky-token']===t || cv===t;
}
function send(res,status,obj){const body=JSON.stringify(obj);res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(body);}
async function body(req){let s='';for await(const c of req){s+=c;if(s.length>5_000_000)throw new Error('body too large');}return s?JSON.parse(s):{};}

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(u.pathname==='/v1/health') return send(res,200,{ok:true,nodeId:NODE_ID});
    if(!(await auth(req))) return send(res,401,{error:'auth'});
    if(req.method==='GET'&&u.pathname==='/api/xavi/sky/federation/pull'){
      const after=Number(u.searchParams.get('after')||0), limit=Number(u.searchParams.get('limit')||500);
      const rows=eventsAfter(after,limit); return send(res,200,{events:rows.map(({ingest_seq,...e})=>e),nextCursor:rows.length?Number(rows.at(-1).ingest_seq):after});
    }
    if(req.method==='POST'&&u.pathname==='/api/xavi/sky/federation/push'){
      const data=await body(req), accepted=importEvents(Array.isArray(data.events)?data.events:[]); heartbeat('0.2.0');
      return send(res,200,{ok:true,accepted});
    }
    send(res,404,{error:'not found'});
  }catch(e){send(res,500,{error:String(e?.message||e)});}
});
server.listen(SERVER_PORT,SERVER_HOST,()=>console.log(`Xavi-Sky federation ${NODE_ID} listening on ${SERVER_HOST}:${SERVER_PORT}`));
