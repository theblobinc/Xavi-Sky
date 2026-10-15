/**
 * Saturation check — find existing starter packs in a theme.
 *
 * Why this is hard: app.bsky.graph.searchStarterPacks returns 501 (MethodNotImplemented)
 * on the public AppView, AND bsky.app's search SPA has no Packs filter — the query
 * param `&t=packs` is a no-op; results are People-only. So neither the API nor the
 * official search UI can answer "what packs exist for theme X."
 *
 * The only working discovery surface is Google's index of public pack URLs:
 *   `site:bsky.app/starter-pack/ <theme>` returns real, ranked pack URLs with titles.
 *
 * Strategy:
 *   1. If Puppeteer is installed, run a Google site:search and extract pack URLs.
 *   2. Detect Google CAPTCHA / "unusual traffic" page and fall back gracefully.
 *   3. Without Puppeteer, return null and the caller emits manual-check URLs.
 *
 * Caveat: Google's index isn't real-time. Brand-new packs (<1 week) may not appear yet.
 * Use this for "what well-known packs already exist in this theme," not for race-conditions
 * with same-day publishers.
 */

import { DEFAULTS } from '../config.mjs';

export async function scrapeSaturation(theme, opts = {}) {
  const { limit = DEFAULTS.saturationScrapeLimit, timeoutMs = 25000 } = opts;

  let puppeteer;
  try {
    puppeteer = await import('puppeteer');
  } catch {
    return null;  // Puppeteer not installed; caller falls back to manual-check URLs
  }

  // Try DuckDuckGo's HTML endpoint first — far more automation-friendly than Google.
  // Fall through to Google as a backup; many themes still resolve well there.
  const sources = [
    { name: 'duckduckgo-html', fn: scrapeDuckDuckGoHtml },
    { name: 'google',          fn: scrapeGoogle },
  ];

  let lastResult = null;
  for (const src of sources) {
    const result = await src.fn(theme, { limit, timeoutMs, puppeteer: puppeteer.default });
    lastResult = result;
    if (result && result.packs && result.packs.length > 0) {
      return {
        theme,
        packs: result.packs.slice(0, limit),
        captcha: false,
        source: src.name,
        scrapedAt: new Date().toISOString(),
      };
    }
    if (result && result.captcha) continue;  // try next source
    if (result && result.packs && result.packs.length === 0) {
      // Genuine empty result — return it from the first source
      return {
        theme,
        packs: [],
        captcha: false,
        source: src.name,
        scrapedAt: new Date().toISOString(),
      };
    }
  }
  return {
    theme,
    packs: [],
    captcha: !!(lastResult && lastResult.captcha),
    source: 'all-sources-failed',
    scrapedAt: new Date().toISOString(),
  };
}

async function scrapeDuckDuckGoHtml(theme, { limit, timeoutMs, puppeteer }) {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    );
    // DDG HTML endpoint returns server-rendered results — no JS required
    const q = encodeURIComponent(`"starter pack" ${theme} site:bsky.app/starter-pack/`);
    const url = `https://html.duckduckgo.com/html/?q=${q}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await new Promise(r => setTimeout(r, 800));

    return await page.evaluate(() => {
      const bodyText = document.body.innerText || '';
      const captcha = /unusual traffic|are you a robot|captcha|verify/i.test(bodyText) && bodyText.length < 500;
      if (captcha) return { captcha: true, packs: [] };

      // DDG's HTML endpoint wraps every result link in /l/?uddg=<URL-encoded>.
      // Match on the uddg wrapper (or on result__a class) and unwrap.
      const anchors = [
        ...document.querySelectorAll('a.result__a, a[href*="uddg="], a[href*="bsky.app/starter-pack"]'),
      ];
      const seen = new Set();
      const packs = [];
      for (const a of anchors) {
        let href = a.getAttribute('href') || '';
        if (href.includes('uddg=')) {
          const m = href.match(/uddg=([^&]+)/);
          if (m) href = decodeURIComponent(m[1]);
        }
        href = href.split('#')[0];
        if (!href.startsWith('https://bsky.app/starter-pack')) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        const text = (a.innerText || a.textContent || '').trim().slice(0, 200);
        packs.push({ url: href, textSnippet: text });
      }
      return { captcha: false, packs };
    });
  } finally {
    await browser.close();
  }
}

async function scrapeGoogle(theme, { limit, timeoutMs, puppeteer }) {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    );
    const q = encodeURIComponent(`"starter pack" ${theme} site:bsky.app/starter-pack/`);
    const url = `https://www.google.com/search?q=${q}&num=${Math.min(limit, 20)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await new Promise(r => setTimeout(r, 1500));

    return await page.evaluate(() => {
      const bodyText = document.body.innerText || '';
      const captcha = /unusual traffic|are you a robot|verify you('|')re human|captcha/i.test(bodyText);
      if (captcha) return { captcha: true, packs: [] };

      const anchors = [...document.querySelectorAll('a[href*="bsky.app/starter-pack"]')];
      const seen = new Set();
      const packs = [];
      for (const a of anchors) {
        let href = a.getAttribute('href') || '';
        if (href.startsWith('/url?')) {
          const params = new URLSearchParams(href.split('?')[1]);
          href = params.get('q') || href;
        }
        href = href.split('#')[0];
        if (!href.startsWith('https://bsky.app/starter-pack')) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        const h3 = a.closest('a, div')?.querySelector?.('h3');
        const text = (h3?.innerText || a.innerText || '').trim().slice(0, 200);
        packs.push({ url: href, textSnippet: text });
      }
      return { captcha: false, packs };
    });
  } finally {
    await browser.close();
  }
}

/**
 * Per-pack deep scrape: visit the pack page and extract member handles.
 * Used for inverse-saturation member counting when --deep-saturation is set.
 */
export async function scrapePackMembers(packUrl, opts = {}) {
  const { timeoutMs = 20000 } = opts;
  let puppeteer;
  try { puppeteer = await import('puppeteer'); } catch { return null; }

  const browser = await puppeteer.default.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(packUrl, { waitUntil: 'networkidle2', timeout: timeoutMs });
    await page.waitForSelector('a[href*="/profile/"]', { timeout: timeoutMs }).catch(() => {});
    const handles = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a[href*="/profile/"]')];
      const set = new Set();
      for (const a of links) {
        const m = (a.getAttribute('href') || '').match(/\/profile\/([^/?#]+)/);
        if (m && m[1] && !m[1].startsWith('did:')) set.add(m[1]);
      }
      return [...set];
    });
    return { url: packUrl, handles };
  } finally {
    await browser.close();
  }
}

export function membershipCountFromScrapes(candidates, packMemberScrapes) {
  const handleToDid = new Map(candidates.map(c => [c.handle, c.did]));
  const counts = new Map();
  for (const scrape of packMemberScrapes) {
    if (!scrape || !scrape.handles) continue;
    for (const h of scrape.handles) {
      const did = handleToDid.get(h);
      if (!did) continue;
      counts.set(did, (counts.get(did) || 0) + 1);
    }
  }
  return counts;
}

/**
 * Manual-check URLs for when Puppeteer is unavailable OR Google CAPTCHAs us.
 */
export function manualCheckUrls(theme) {
  return [
    `https://www.google.com/search?q=${encodeURIComponent(`"starter pack" ${theme} site:bsky.app/starter-pack/`)}`,
    `https://duckduckgo.com/?q=${encodeURIComponent(`"starter pack" ${theme} site:bsky.app`)}`,
    `https://bsky.app/search?q=${encodeURIComponent(theme)}  (people-only; bsky has no pack search UI)`,
  ];
}
