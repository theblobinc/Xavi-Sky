import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './db.mjs';
import { FEDERATION_TOKEN, FEDERATION_TOKEN_FILE } from './config.mjs';

const MAGIC = Buffer.from('XSKYDB1\0');

function secret() {
  if (FEDERATION_TOKEN) return FEDERATION_TOKEN;
  if (FEDERATION_TOKEN_FILE && fs.existsSync(FEDERATION_TOKEN_FILE)) {
    return fs.readFileSync(FEDERATION_TOKEN_FILE, 'utf8').trim();
  }
  throw new Error('XAVI_SKY_FEDERATION_TOKEN or XAVI_SKY_FEDERATION_TOKEN_FILE is required');
}

function derive(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, 32);
}

function snapshot(outputPath) {
  if (!fs.existsSync(DB_PATH)) throw new Error(`database not found: ${DB_PATH}`);
  const d = new DatabaseSync(DB_PATH);
  d.exec('PRAGMA busy_timeout=5000; PRAGMA wal_checkpoint(TRUNCATE);');
  d.close();

  const plain = fs.readFileSync(DB_PATH);
  const compressed = zlib.gzipSync(plain, { level: 9 });
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = derive(secret(), salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(MAGIC);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([MAGIC, salt, iv, tag, encrypted]);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, payload, { mode: 0o600 });
  console.log(JSON.stringify({ ok: true, action: 'snapshot', dbBytes: plain.length, encryptedBytes: payload.length }));
}

function restore(inputPath) {
  if (!fs.existsSync(inputPath)) {
    console.log(JSON.stringify({ ok: true, action: 'restore', restored: false, reason: 'snapshot-missing' }));
    return;
  }
  const payload = fs.readFileSync(inputPath);
  if (payload.length < MAGIC.length + 16 + 12 + 16 || !payload.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('invalid Xavi-Sky state snapshot');
  }
  let off = MAGIC.length;
  const salt = payload.subarray(off, off += 16);
  const iv = payload.subarray(off, off += 12);
  const tag = payload.subarray(off, off += 16);
  const encrypted = payload.subarray(off);
  const key = derive(secret(), salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  const compressed = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const plain = zlib.gunzipSync(compressed);

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(`${DB_PATH}${suffix}`, { force: true }); } catch {}
  }
  const tmp = `${DB_PATH}.restore-${process.pid}`;
  fs.writeFileSync(tmp, plain, { mode: 0o660 });
  fs.renameSync(tmp, DB_PATH);
  console.log(JSON.stringify({ ok: true, action: 'restore', restored: true, dbBytes: plain.length }));
}

const [cmd, file] = process.argv.slice(2);
if (!cmd || !file || !['snapshot', 'restore'].includes(cmd)) {
  console.error('usage: node src/github-state.mjs <snapshot|restore> <file>');
  process.exit(2);
}

if (cmd === 'snapshot') snapshot(file);
else restore(file);
