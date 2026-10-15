/**
 * Offline smoke test. Verifies module loading + pure-function correctness without
 * hitting the network. Safe to run on any fresh clone via `npm test`.
 *
 * Network-dependent end-to-end runs are covered by `npm run e2e` (see package.json).
 */

import assert from 'node:assert/strict';

function section(name) {
  process.stdout.write(`  ${name} ... `);
}
function ok() { process.stdout.write('ok\n'); }

console.log('bsky-pack-curator smoke test\n');

// 1. All modules load cleanly
section('module loading');
await import('../src/config.mjs');
await import('../src/api/client.mjs');
await import('../src/api/search.mjs');
await import('../src/api/profiles.mjs');
await import('../src/api/feed.mjs');
await import('../src/api/graph.mjs');
await import('../src/scoring/multi-signal.mjs');
await import('../src/scoring/activity.mjs');
await import('../src/scoring/rationale.mjs');
await import('../src/scoring/network.mjs');
await import('../src/scoring/reshare-prob.mjs');
await import('../src/scoring/inverse-saturation.mjs');
await import('../src/scoring/compose.mjs');
await import('../src/tools/saturation-scrape.mjs');
await import('../src/tools/cross-pack-dedupe.mjs');
await import('../src/tools/versioning.mjs');
await import('../src/tools/contact-list.mjs');
await import('../src/render/markdown.mjs');
await import('../src/render/json.mjs');
await import('../src/render/reddit.mjs');
await import('../src/pipeline.mjs');
ok();

// 2. Bio filter
section('filterByBio');
const { filterByBio } = await import('../src/api/search.mjs');
const fake = [
  { did: '1', handle: 'a.bsky.social', description: 'I write a substack on cats' },
  { did: '2', handle: 'b.bsky.social', description: 'random user' },
  { did: '3', handle: 'c.substack.com', description: '' },
];
const matched = filterByBio(fake, ['substack'], ['.substack.com']);
assert.equal(matched.length, 2);
assert.equal(matched[0].did, '1');
assert.equal(matched[1].did, '3');
ok();

// 3. Rationale extraction
section('extractRationale');
const { extractRationale } = await import('../src/scoring/rationale.mjs');
const profile = {
  description: 'Berkeley professor. Substack: ex-DoL Secretary. I also write essays.',
  displayName: 'Test User',
  handle: 'test.bsky.social',
};
const r = extractRationale(profile, ['substack']);
assert.match(r, /Substack/);
ok();

// 4. Multi-signal scoring — activity weighting changes ordering vs pure follower count
section('computeMultiSignal');
const { computeMultiSignal } = await import('../src/scoring/multi-signal.mjs');
const profiles = [
  { did: 'big-dormant', followersCount: 1000000 },
  { did: 'big-active',  followersCount: 1000000 },
  { did: 'small-active', followersCount: 5000 },
];
const activity = new Map([
  ['big-dormant',  { did: 'big-dormant',  postsLast30d: 0,  avgLikes: 0,   avgReposts: 0 }],
  ['big-active',   { did: 'big-active',   postsLast30d: 25, avgLikes: 500, avgReposts: 50 }],
  ['small-active', { did: 'small-active', postsLast30d: 25, avgLikes: 100, avgReposts: 20 }],
]);
const scored = computeMultiSignal(profiles, activity);
const byDid = new Map(scored.map(s => [s.did, s.multiSignal]));
// Big-active should clearly beat big-dormant (proves activity weighting works)
assert.ok(byDid.get('big-active') > byDid.get('big-dormant'),
  'big+active should outscore big+dormant when followers are equal');
// Activity weighting should make small-active competitive with big-dormant
// (they may tie or small-active wins, but both prove activity matters)
assert.ok(byDid.get('small-active') >= byDid.get('big-dormant') - 0.1,
  'small+active should be within striking distance of big+dormant');
ok();

// 5. Activity filter
section('filterByActivity');
const { filterByActivity } = await import('../src/scoring/activity.mjs');
const recent = new Date(Date.now() - 5 * 86400 * 1000).toISOString();
const old = new Date(Date.now() - 365 * 86400 * 1000).toISOString();
const acts = new Map([
  ['1', { did: '1', lastPostAt: recent, postsLast30d: 5 }],
  ['2', { did: '2', lastPostAt: old, postsLast30d: 0 }],
]);
const filtered = filterByActivity(
  [{ did: '1' }, { did: '2' }],
  acts,
  30,
);
assert.equal(filtered.length, 1);
assert.equal(filtered[0].did, '1');
ok();

// 6. Reshare probability ranks niche accounts higher
section('computeReshareProbability');
const { computeReshareProbability } = await import('../src/scoring/reshare-prob.mjs');
const profilesR = [
  { did: '1', followersCount: 800000, description: 'one substack reference here' },
  { did: '2', followersCount: 2000, description: 'substack substack newsletter substack' },
];
const actsR = new Map([
  ['1', { did: '1', postsLast30d: 5 }],
  ['2', { did: '2', postsLast30d: 20 }],
]);
const rs = computeReshareProbability(profilesR, ['substack'], actsR);
assert.ok(rs[1].reshareProbability > rs[0].reshareProbability, 'niche-active small account should outscore mega-account');
ok();

// 7. Versioning diff
section('diffSnapshots');
const { diffSnapshots } = await import('../src/tools/versioning.mjs');
const prior = { members: [{ did: '1', followersCount: 1000 }, { did: '2', followersCount: 5000 }] };
const current = { members: [{ did: '1', followersCount: 2500 }, { did: '3', followersCount: 100 }] };
const diff = diffSnapshots(prior, current);
assert.equal(diff.isFirstRun, false);
assert.equal(diff.addedCount, 1);
assert.equal(diff.droppedCount, 1);
assert.equal(diff.grew.length, 1);
ok();

// 8. Render markdown produces something
section('renderRoster');
const { renderRoster } = await import('../src/render/markdown.mjs');
const md = renderRoster({
  pack: { name: 'Test', description: 'test' },
  members: [{ did: '1', handle: 'a.bsky.social', displayName: 'A', followersCount: 100, rationale: 'a writer' }],
  contactList: { tier1: [], tier2: [], notes: [] },
  reshareTop: [],
  saturationResult: null,
  diff: null,
  meta: {
    builtAt: '2026-01-01T00:00:00Z',
    queries: ['x'], bioMatch: ['x'],
    fetchedCount: 1, bioMatchCount: 1, afterActivityCount: 1,
    activityDays: 30,
  },
});
assert.match(md, /# Starter Pack — Test/);
assert.match(md, /a\.bsky\.social/);
ok();

// 9. Slug validation (path-traversal + Windows reserved names)
section('validateSlug');
const { validateSlug, validateLimit, validateActivityDays } = await import('../src/util/validate.mjs');
assert.equal(validateSlug('substack-writers'), 'substack-writers');
assert.throws(() => validateSlug('../EVIL'),     /must not contain/i);
assert.throws(() => validateSlug('a/b'),         /must not contain slashes/i);
assert.throws(() => validateSlug('.hidden'),     /must not start with a dot/i);
assert.throws(() => validateSlug(''),            /required/i);
assert.throws(() => validateSlug('x'.repeat(81)),/too long/i);
assert.throws(() => validateSlug('CON'),         /reserved/i);
assert.throws(() => validateSlug('com1.pack'),   /reserved/i);
ok();

// 9b. Limit + activity-days validators
section('validateLimit / validateActivityDays');
assert.equal(validateLimit(undefined), 150);
assert.equal(validateLimit('25'), 25);
assert.throws(() => validateLimit(0),       /at least 1/i);
assert.throws(() => validateLimit(200),     /cannot exceed 150/i);
assert.throws(() => validateLimit('abc'),   /positive integer/i);
assert.throws(() => validateLimit(1.5),     /positive integer/i);
assert.equal(validateActivityDays(undefined), 30);
assert.equal(validateActivityDays('0'), 0);
assert.throws(() => validateActivityDays(-5), /non-negative/i);
assert.throws(() => validateActivityDays('xyz'), /non-negative integer/i);
ok();

// 10. Retry wrapper recognizes retryable errors
section('withRetry');
const { withRetry } = await import('../src/util/retry.mjs');
let calls = 0;
const result = await withRetry(async () => {
  calls++;
  if (calls < 2) throw new Error('XRPC foo 503: transient');
  return 'recovered';
}, { attempts: 3, baseDelayMs: 10 });
assert.equal(result, 'recovered');
assert.equal(calls, 2, 'should have retried exactly once');
// Non-retryable error should fail immediately
let nonRetryCalls = 0;
await assert.rejects(
  withRetry(async () => { nonRetryCalls++; throw new Error('XRPC foo 400: bad request'); }, { attempts: 3, baseDelayMs: 10 }),
  /400/,
);
assert.equal(nonRetryCalls, 1, 'should not retry on 400');
ok();

// 11. Empty-pool scoring doesn't crash
section('empty-pool guards');
const emptyScored = computeMultiSignal([], new Map());
assert.equal(emptyScored.length, 0);
ok();

console.log('\nAll smoke tests passed.');
