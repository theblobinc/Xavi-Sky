import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, NODE_ID, NODE_KIND } from './config.mjs';

export const DB_PATH = process.env.XAVI_SKY_DB || path.join(DATA_DIR, 'xavi-sky.sqlite');
let db;

export function openDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events(
      ingest_seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      origin_node TEXT NOT NULL,
      origin_seq INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      account_handle TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(origin_node, origin_seq)
    );
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_type,entity_id);
    CREATE TABLE IF NOT EXISTS candidates(
      did TEXT PRIMARY KEY,
      handle TEXT NOT NULL DEFAULT '', display_name TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
      followers_count INTEGER, follows_count INTEGER, posts_count INTEGER,
      score REAL NOT NULL DEFAULT 0, curator_score REAL NOT NULL DEFAULT 0,
      themes_json TEXT NOT NULL DEFAULT '[]', sources_json TEXT NOT NULL DEFAULT '[]',
      first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS starter_packs(
      url TEXT PRIMARY KEY, themes_json TEXT NOT NULL DEFAULT '[]',
      first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS account_state(
      account_handle TEXT NOT NULL, did TEXT NOT NULL, state TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '', last_event_id TEXT, last_action_at TEXT,
      PRIMARY KEY(account_handle,did)
    );
    CREATE TABLE IF NOT EXISTS nodes(
      node_id TEXT PRIMARY KEY, node_kind TEXT NOT NULL DEFAULT 'worker', label TEXT NOT NULL DEFAULT '',
      version TEXT NOT NULL DEFAULT '', first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
      last_sync_at TEXT, capabilities_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS runs(
      run_id TEXT PRIMARY KEY, node_id TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
      status TEXT NOT NULL, theme TEXT, candidates_seen INTEGER NOT NULL DEFAULT 0,
      packs_seen INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS peer_cursors(
      peer_id TEXT PRIMARY KEY, pull_after INTEGER NOT NULL DEFAULT 0, push_after INTEGER NOT NULL DEFAULT 0,
      last_pull_at TEXT, last_push_at TEXT, last_error TEXT NOT NULL DEFAULT ''
    );
  `);
  ensureNode();
  return db;
}

function now() { return new Date().toISOString(); }
function j(v) { return JSON.stringify(v ?? null); }
function p(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }
function nextOriginSeq(d) {
  const key = `origin_seq:${NODE_ID}`;
  const row = d.prepare('SELECT value FROM meta WHERE key=?').get(key);
  const previous = Number(row?.value || 0);
  const n = Math.max(previous + 1, Date.now() * 1000);
  d.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(n));
  return n;
}

export function emitEvent(eventType, entityType, entityId, payload={}, accountHandle=null) {
  const d=openDb(), createdAt=now(), originSeq=nextOriginSeq(d), eventId=crypto.randomUUID();
  d.prepare(`INSERT INTO events(event_id,origin_node,origin_seq,event_type,entity_type,entity_id,account_handle,payload_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(eventId,NODE_ID,originSeq,eventType,entityType,entityId,accountHandle,j(payload),createdAt);
  applyEvent({event_id:eventId,origin_node:NODE_ID,origin_seq:originSeq,event_type:eventType,entity_type:entityType,entity_id:entityId,account_handle:accountHandle,payload_json:j(payload),created_at:createdAt}, d);
  return eventId;
}

export function importEvents(events=[]) {
  const d=openDb(); let accepted=0;
  d.exec('BEGIN IMMEDIATE');
  try {
    const ins=d.prepare(`INSERT OR IGNORE INTO events(event_id,origin_node,origin_seq,event_type,entity_type,entity_id,account_handle,payload_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`);
    for (const e of events) {
      if (!e?.event_id || !e?.origin_node || !Number.isFinite(Number(e?.origin_seq))) continue;
      const r=ins.run(e.event_id,e.origin_node,Number(e.origin_seq),e.event_type||'',e.entity_type||'',e.entity_id||'',e.account_handle||null,e.payload_json||'{}',e.created_at||now());
      if (Number(r.changes||0)>0) { applyEvent(e,d); accepted++; }
    }
    d.exec('COMMIT');
  } catch (err) { d.exec('ROLLBACK'); throw err; }
  return accepted;
}

export function eventsAfter(after=0, limit=500) {
  const rows=openDb().prepare(`SELECT ingest_seq,event_id,origin_node,origin_seq,event_type,entity_type,entity_id,account_handle,payload_json,created_at
    FROM events WHERE ingest_seq>? ORDER BY ingest_seq ASC LIMIT ?`).all(Number(after)||0, Math.max(1,Math.min(2000,Number(limit)||500)));
  return rows;
}

function applyEvent(e,d=openDb()) {
  const payload=typeof e.payload_json==='string' ? p(e.payload_json,{}) : (e.payload_json||{});
  const t=e.event_type, ts=e.created_at||now();
  if (t==='candidate.upsert') {
    const old=d.prepare('SELECT * FROM candidates WHERE did=?').get(e.entity_id);
    const themes=[...new Set([...(p(old?.themes_json,'[]')||[]),...(payload.themes||[])])];
    const sources=[...new Set([...(p(old?.sources_json,'[]')||[]),...(payload.sources||[])])];
    d.prepare(`INSERT INTO candidates(did,handle,display_name,description,followers_count,follows_count,posts_count,score,curator_score,themes_json,sources_json,first_seen_at,last_seen_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(did) DO UPDATE SET
      handle=excluded.handle,display_name=excluded.display_name,description=excluded.description,
      followers_count=COALESCE(excluded.followers_count,candidates.followers_count),follows_count=COALESCE(excluded.follows_count,candidates.follows_count),
      posts_count=COALESCE(excluded.posts_count,candidates.posts_count),score=MAX(candidates.score,excluded.score),curator_score=MAX(candidates.curator_score,excluded.curator_score),
      themes_json=excluded.themes_json,sources_json=excluded.sources_json,last_seen_at=MAX(candidates.last_seen_at,excluded.last_seen_at)`)
      .run(e.entity_id,payload.handle||old?.handle||'',payload.displayName||old?.display_name||'',payload.description||old?.description||'',payload.followersCount??null,payload.followsCount??null,payload.postsCount??null,Number(payload.score||0),Number(payload.curatorScore||0),j(themes),j(sources),old?.first_seen_at||ts,ts);
  } else if (t==='starter_pack.upsert') {
    const old=d.prepare('SELECT * FROM starter_packs WHERE url=?').get(e.entity_id);
    const themes=[...new Set([...(p(old?.themes_json,'[]')||[]),...(payload.themes||[])])];
    d.prepare(`INSERT INTO starter_packs(url,themes_json,first_seen_at,last_seen_at) VALUES(?,?,?,?)
      ON CONFLICT(url) DO UPDATE SET themes_json=excluded.themes_json,last_seen_at=MAX(starter_packs.last_seen_at,excluded.last_seen_at)`)
      .run(e.entity_id,j(themes),old?.first_seen_at||payload.firstSeenAt||ts,payload.lastSeenAt||ts);
  } else if (t==='account.state') {
    d.prepare(`INSERT INTO account_state(account_handle,did,state,detail,last_event_id,last_action_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(account_handle,did) DO UPDATE SET state=excluded.state,detail=excluded.detail,last_event_id=excluded.last_event_id,last_action_at=excluded.last_action_at WHERE excluded.last_action_at >= COALESCE(account_state.last_action_at,'')`)
      .run(e.account_handle||payload.accountHandle||'',e.entity_id,payload.state||'seen',payload.detail||'',e.event_id,payload.at||ts);
  } else if (t==='node.heartbeat') {
    upsertNode(e.origin_node,payload.nodeKind||'worker',payload.label||e.origin_node,payload.version||'',payload.capabilities||[],ts,d);
  } else if (t==='run.finished') {
    d.prepare(`INSERT INTO runs(run_id,node_id,started_at,finished_at,status,theme,candidates_seen,packs_seen,error) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(run_id) DO UPDATE SET finished_at=excluded.finished_at,status=excluded.status,theme=excluded.theme,candidates_seen=excluded.candidates_seen,packs_seen=excluded.packs_seen,error=excluded.error`)
      .run(e.entity_id,e.origin_node,payload.startedAt||ts,payload.finishedAt||ts,payload.status||'ok',payload.theme||'',Number(payload.candidatesSeen||0),Number(payload.packsSeen||0),payload.error||'');
  }
}

export function ingestDiscovery(snapshot) {
  for (const c of snapshot?.candidates||[]) emitEvent('candidate.upsert','actor',c.did,c);
  for (const sp of snapshot?.starterPacks||[]) emitEvent('starter_pack.upsert','starter_pack',sp.url,sp);
}

export function markAccountState(accountHandle,did,state,detail='') {
  return emitEvent('account.state','actor',did,{state,detail,at:now()},accountHandle);
}

export function startRun(theme='') {
  const runId=crypto.randomUUID(), startedAt=now();
  openDb().prepare('INSERT INTO runs(run_id,node_id,started_at,status,theme) VALUES(?,?,?,?,?)').run(runId,NODE_ID,startedAt,'running',theme);
  return {runId,startedAt};
}
export function finishRun(run,status,snapshot,error='') {
  const payload={startedAt:run.startedAt,finishedAt:now(),status,theme:snapshot?.theme||'',candidatesSeen:snapshot?.candidateCount||0,packsSeen:snapshot?.starterPackCount||0,error:String(error||'')};
  emitEvent('run.finished','run',run.runId,payload);
}
export function heartbeat(version='0.1.0') { emitEvent('node.heartbeat','node',NODE_ID,{nodeKind:NODE_KIND,label:NODE_ID,version,capabilities:['discovery','ranking','sqlite-replica','federation']}); }

function ensureNode(){ upsertNode(NODE_ID,NODE_KIND,NODE_ID,'0.1.0',['discovery','ranking','sqlite-replica','federation'],now(),db); }
function upsertNode(id,kind,label,version,caps,ts,d=openDb()){
  d.prepare(`INSERT INTO nodes(node_id,node_kind,label,version,first_seen_at,last_seen_at,capabilities_json) VALUES(?,?,?,?,?,?,?)
  ON CONFLICT(node_id) DO UPDATE SET node_kind=excluded.node_kind,label=excluded.label,version=excluded.version,last_seen_at=MAX(nodes.last_seen_at,excluded.last_seen_at),capabilities_json=excluded.capabilities_json`)
  .run(id,kind,label,version,ts,ts,j(caps));
}

export function peerCursor(peerId){ return openDb().prepare('SELECT * FROM peer_cursors WHERE peer_id=?').get(peerId)||{peer_id:peerId,pull_after:0,push_after:0,last_error:''}; }
export function savePeerCursor(peerId,patch={}){
  const old=peerCursor(peerId); const v={...old,...patch};
  openDb().prepare(`INSERT INTO peer_cursors(peer_id,pull_after,push_after,last_pull_at,last_push_at,last_error) VALUES(?,?,?,?,?,?)
    ON CONFLICT(peer_id) DO UPDATE SET pull_after=excluded.pull_after,push_after=excluded.push_after,last_pull_at=excluded.last_pull_at,last_push_at=excluded.last_push_at,last_error=excluded.last_error`)
    .run(peerId,Number(v.pull_after||0),Number(v.push_after||0),v.last_pull_at||null,v.last_push_at||null,v.last_error||'');
}
