import { discoverAndRank } from './discover.mjs';
import { heartbeat, ingestDiscovery, startRun, finishRun, openDb } from './db.mjs';

openDb();
const started=Date.now();
heartbeat('0.5.0');
const run=startRun('hourly');
let snapshot=null;
try {
  snapshot=await discoverAndRank();
  ingestDiscovery(snapshot);
  finishRun(run,'ok',snapshot,'');
  heartbeat('0.5.0');
  console.log(JSON.stringify({ok:true,mode:'discovery-only',manualFollowOnly:true,elapsedMs:Date.now()-started,node:process.env.XAVI_SKY_NODE_ID||null,candidates:snapshot.candidateCount,packs:snapshot.starterPackCount}));
} catch (e) {
  finishRun(run,'error',snapshot,String(e?.stack||e));
    console.error(e?.stack||e);
  process.exitCode=1;
}
