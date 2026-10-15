/**
 * AT Protocol public read client.
 *
 * Wraps fetch() against public.api.bsky.app/xrpc/<method>. All endpoints used
 * by this tool are unauthenticated reads — there is no auth code path in the
 * client by design.
 */

import { PUBLIC_API, DEFAULTS } from '../config.mjs';
import { withRetry } from '../util/retry.mjs';

export async function publicGet(method, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) qs.append(k, item);
    } else {
      qs.set(k, String(v));
    }
  }
  const url = `${PUBLIC_API}/xrpc/${method}${qs.toString() ? '?' + qs.toString() : ''}`;
  return withRetry(async () => {
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`XRPC ${method} ${r.status}: ${body.slice(0, 200)}`);
    }
    return r.json();
  });
}

/**
 * Small helper for sequential awaits with a delay between, to be polite under
 * the public API's shared rate limits.
 */
export async function serialEach(items, fn, delayMs = DEFAULTS.rateLimitDelayMs) {
  const out = [];
  for (const item of items) {
    out.push(await fn(item));
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  }
  return out;
}

/**
 * Bounded-concurrency map. Used for activity / network checks where each candidate
 * needs its own API call but we don't want to flood.
 */
export async function concurrentMap(items, concurrency, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        results[i] = { __error: err.message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
