import { discoverAndRank } from './discover.mjs';
import { heartbeat, ingestDiscovery, startRun, finishRun, openDb } from './db.mjs';
import { syncAllPeers } from './federation.mjs';

openDb();
const started=Date.now();
heartbeat('0.2.0');
await syncAllPeers().catch(()=>[]);
const run=startRun('hourly');
let snapshot=null;
try {
  snapshot=await discoverAndRank();
  ingestDiscovery(snapshot);
  finishRun(run,'ok',snapshot,'');
  heartbeat('0.2.0');
  const sync=await syncAllPeers().catch(e=>[{ok:false,error:String(e?.message||e)}]);
  console.log(JSON.stringify({ok:true,elapsedMs:Date.now()-started,node:process.env.XAVI_SKY_NODE_ID||null,candidates:snapshot.candidateCount,packs:snapshot.starterPackCount,sync}));
} catch (e) {
  finishRun(run,'error',snapshot,String(e?.stack||e));
  await syncAllPeers().catch(()=>[]);
  console.error(e?.stack||e);
  process.exitCode=1;
}
