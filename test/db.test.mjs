import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('federation event import is idempotent', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'xavi-sky-test-'));
  process.env.XAVI_SKY_DATA_DIR=dir;
  process.env.XAVI_SKY_NODE_ID='test-node';
  const db=await import(`../src/db.mjs?test=${Date.now()}`);
  db.openDb();
  db.heartbeat('test');
  const first=db.eventsAfter(0,10);
  assert.equal(first.length,1);
  const event={...first[0]}; delete event.ingest_seq;
  assert.equal(db.importEvents([event]),0);
  assert.equal(db.eventsAfter(0,10).length,1);
  await fs.rm(dir,{recursive:true,force:true});
});
