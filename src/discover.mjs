import fs from 'node:fs/promises';
import path from 'node:path';
import { runCuration } from '../vendor/bsky-pack-curator/src/pipeline.mjs';
import { DATA_DIR, THEMES, MAX_CANDIDATES, PACKS_PER_THEME, SEED_PACKS_FILE } from './config.mjs';
import { fetchTimed, parseStarterPackUrl, readJson, readLines, writeJson, err } from './lib.mjs';

const CURATOR_COMMIT = '8718d5380226ff9f0201a31a7186ea586062fe60';

export async function discoverAndRank() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const theme = THEMES[new Date().getUTCHours() % THEMES.length];
  const keywords = theme.split(/\s+/).filter(s => s.length >= 3);
  const old = await readJson(path.join(DATA_DIR, 'queue.json'), { candidates: [], starterPacks: [] });
  const byDid = new Map((old.candidates || []).map(c => [c.did, c]));
  const packs = new Map((old.starterPacks || []).map(p => [p.url, p]));

  console.log(`[curator] theme=${theme}`);
  try {
    const result = await runCuration({
      name: theme,
      description: `Xavi-Sky hourly discovery for ${theme}`,
      queries: [theme],
      bioMatch: keywords,
      limit: 200,
      activityDays: 30,
      viewerHandle: process.env.XAVI_SKY_VIEWER_HANDLE || '',
      checkSaturation: false,
      logger: console,
    });
    for (const m of result.members || []) mergeCandidate(byDid, m, theme);
  } catch (e) {
    console.warn(`[curator] degraded: ${err(e)}`);
  }

  for (const raw of await readLines(SEED_PACKS_FILE)) addPack(packs, raw, 'seed');
  try {
    for (const url of (await discoverPackUrls(theme)).slice(0, PACKS_PER_THEME)) addPack(packs, url, theme);
  } catch (e) {
    console.warn(`[starter-packs] discovery degraded: ${err(e)}`);
  }

  const candidates = [...byDid.values()];
  for (const c of candidates) {
    c.sources = [...new Set(c.sources || [])];
    c.themes = [...new Set(c.themes || [])];
    c.score = Number(((c.curatorScore || 0) * 1000 + Math.log1p(c.followersCount || 0) * 10).toFixed(4));
  }
  candidates.sort((a, b) => b.score - a.score || (b.followersCount || 0) - (a.followersCount || 0));
  const trimmed = candidates.slice(0, MAX_CANDIDATES);
  const starterPacks = [...packs.values()].sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt))).slice(0, 1000);
  const output = {
    generatedAt: new Date().toISOString(), theme,
    engine: 'gyapaganda-a11y/bsky-pack-curator + public web starter-pack discovery',
    curatorCommit: CURATOR_COMMIT,
    candidateCount: trimmed.length,
    starterPackCount: starterPacks.length,
    starterPacks,
    candidates: trimmed,
  };
  await writeJson(path.join(DATA_DIR, 'queue.json'), output);
  await fs.writeFile(path.join(DATA_DIR, 'queue.tsv'), toTsv(trimmed), 'utf8');
  await fs.writeFile(path.join(DATA_DIR, 'starter-packs.tsv'), packsTsv(starterPacks), 'utf8');
  console.log(`[queue] candidates=${trimmed.length} starterPacks=${starterPacks.length}`);
  return output;
}

function mergeCandidate(map, m, theme) {
  const c = map.get(m.did) || { did: m.did, handle: '', displayName: '', description: '', curatorScore: 0, sources: [], themes: [] };
  c.handle = m.handle || c.handle;
  c.displayName = m.displayName || c.displayName;
  c.description = m.description || c.description;
  c.followersCount = m.followersCount ?? c.followersCount ?? null;
  c.followsCount = m.followsCount ?? c.followsCount ?? null;
  c.postsCount = m.postsCount ?? c.postsCount ?? null;
  c.curatorScore = Math.max(c.curatorScore || 0, m.finalScore || 0);
  c.scoreBreakdown = m.scoreBreakdown || c.scoreBreakdown;
  c.rationale = m.rationale || c.rationale;
  c.sources.push(`curator:${theme}`);
  c.themes.push(theme);
  map.set(c.did, c);
}

async function discoverPackUrls(theme) {
  const q = encodeURIComponent(`\"starter pack\" ${theme} site:bsky.app/starter-pack/`);
  const response = await fetchTimed(`https://html.duckduckgo.com/html/?q=${q}`, {
    headers: { 'user-agent': 'Mozilla/5.0 Xavi-Sky/0.1', accept: 'text/html' },
  });
  if (!response.ok) throw new Error(`DuckDuckGo HTTP ${response.status}`);
  const html = await response.text();
  const urls = new Set();
  for (const m of html.matchAll(/uddg=([^&\"']+)/g)) {
    try {
      const p = parseStarterPackUrl(decodeURIComponent(m[1]).replaceAll('&amp;', '&'));
      if (p) urls.add(p.url);
    } catch {}
  }
  for (const m of html.matchAll(/https?:\/\/bsky\.app\/starter-pack\/[A-Za-z0-9._:%-]+\/[A-Za-z0-9._~%-]+/g)) {
    const p = parseStarterPackUrl(m[0]);
    if (p) urls.add(p.url);
  }
  return [...urls];
}

function addPack(map, raw, theme) {
  const p = parseStarterPackUrl(raw);
  if (!p) return;
  const old = map.get(p.url) || { url: p.url, themes: [], firstSeenAt: new Date().toISOString() };
  old.themes = [...new Set([...(old.themes || []), theme])];
  old.lastSeenAt = new Date().toISOString();
  map.set(p.url, old);
}

function toTsv(rows) {
  const head = ['rank','score','handle','did','followers','posts','themes','rationale'];
  const body = rows.map((c, i) => [i + 1, c.score, c.handle, c.did, c.followersCount ?? '', c.postsCount ?? '', c.themes.join(' | '), c.rationale || '']);
  return [head, ...body].map(r => r.map(clean).join('\t')).join('\n') + '\n';
}
function packsTsv(rows) {
  return [['url','themes','firstSeenAt','lastSeenAt'], ...rows.map(p => [p.url, (p.themes || []).join(' | '), p.firstSeenAt || '', p.lastSeenAt || ''])].map(r => r.map(clean).join('\t')).join('\n') + '\n';
}
function clean(v) { return String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim(); }
