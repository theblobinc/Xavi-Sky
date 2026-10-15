import fs from 'node:fs/promises';

export const PUBLIC_API = process.env.PUBLIC_BSKY_API || 'https://public.api.bsky.app';
export const TIMEOUT_MS = num('XAVI_SKY_HTTP_TIMEOUT_MS', 10000, 1000, 30000);

export function num(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export async function fetchTimed(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...options, signal: controller.signal, redirect: 'follow' }); }
  finally { clearTimeout(timer); }
}

export async function xrpcGet(method, params = {}, base = PUBLIC_API) {
  const url = new URL(`${base}/xrpc/${method}`);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) for (const v of value) url.searchParams.append(key, String(v));
    else if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetchTimed(url, { headers: { accept: 'application/json' } });
  const data = await jsonResponse(response);
  if (!response.ok) throw httpError(response, data);
  return data;
}

export async function resolveHandle(handle) {
  if (String(handle).startsWith('did:')) return handle;
  return (await xrpcGet('com.atproto.identity.resolveHandle', { handle }))?.did || null;
}

export function parseStarterPackUrl(raw) {
  try {
    const u = new URL(String(raw).replaceAll('&amp;', '&'));
    const p = u.pathname.split('/').filter(Boolean);
    if (u.hostname !== 'bsky.app' || p[0] !== 'starter-pack' || p.length < 3) return null;
    return { url: `https://bsky.app/starter-pack/${p[1]}/${p[2]}`, actor: decodeURIComponent(p[1]), rkey: decodeURIComponent(p[2]) };
  } catch { return null; }
}

export async function readLines(file) {
  try { return (await fs.readFile(file, 'utf8')).split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')); }
  catch (e) { if (e?.code === 'ENOENT') return []; throw e; }
}

export async function writeJson(file, value) { await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8'); }
export async function readJson(file, fallback = {}) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e?.code === 'ENOENT') return fallback; throw e; }
}
export function err(e) { return e?.stack || e?.message || String(e); }

async function jsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 1200) }; }
}
function httpError(response, data) {
  const e = new Error(`${response.status} ${data?.error || ''} ${data?.message || data?.raw || ''}`.trim());
  e.status = response.status;
  e.rateLimit = Object.fromEntries([...response.headers.entries()].filter(([k]) => k.toLowerCase().includes('ratelimit')));
  return e;
}
