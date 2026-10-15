/**
 * Pipeline orchestrator. Chains the 14 steps documented in the README design section.
 *
 * Steps:
 *   1. searchAcrossQueries — paginated multi-query union
 *   2. filterByBio          — keep candidates matching bio pattern OR handle suffix
 *   3. getProfilesBatched   — fetch follower counts and full profile views
 *   4. profileActivityStats — get last-post-date + post cadence + engagement proxy
 *   5. filterByActivity     — drop dormant accounts
 *   6. loadAllPriorMemberships + annotate — cross-pack membership awareness
 *   7. scrapeSaturation + (optional) scrapePackMembers — competing packs in theme
 *   8. computeNetworkScores — augment with viewer's social graph
 *   9. computeReshareProbability + computeMultiSignal + computeInverseSaturation
 *  10. composeFinalScores  — weighted combination
 *  11. annotateWithRationale — per-member "why" string
 *  12. select top-N
 *  13. render markdown / JSON / reddit
 *  14. (optional) publish via AT Protocol
 *
 * Returns the full result object; caller decides what to write where.
 */

import { searchAcrossQueries, filterByBio } from './api/search.mjs';
import { getProfilesBatched } from './api/profiles.mjs';
import { profileActivityStats } from './api/feed.mjs';
import { filterByActivity } from './scoring/activity.mjs';
import { annotateWithRationale } from './scoring/rationale.mjs';
import { computeMultiSignal } from './scoring/multi-signal.mjs';
import { computeReshareProbability, topReshareCandidates } from './scoring/reshare-prob.mjs';
import { computeNetworkScores } from './scoring/network.mjs';
import { computeInverseSaturation } from './scoring/inverse-saturation.mjs';
import { composeFinalScores } from './scoring/compose.mjs';
import { loadAllPriorMemberships, annotateWithCrossMembership } from './tools/cross-pack-dedupe.mjs';
import { scrapeSaturation, scrapePackMembers, membershipCountFromScrapes, manualCheckUrls } from './tools/saturation-scrape.mjs';
import { loadPriorSnapshot, diffSnapshots } from './tools/versioning.mjs';
import { generateContactList } from './tools/contact-list.mjs';
import { DEFAULTS, NEWSLETTER_HANDLE_SUFFIXES } from './config.mjs';
import { preflightHandle } from './util/validate.mjs';

export async function runCuration(opts) {
  const {
    name,
    description,
    queries,
    bioMatch,
    handleSuffixes = NEWSLETTER_HANDLE_SUFFIXES,
    limit = DEFAULTS.limit,
    activityDays = DEFAULTS.activityDays,
    viewerHandle = null,
    packsDir = null,
    packDir = null,
    checkSaturation = false,
    deepSaturation = false,
    logger = console,
  } = opts;

  const log = (...args) => logger.log('[curate]', ...args);

  // 0. Pre-flight cheap validations before spending real API budget.
  if (!queries || queries.length === 0) {
    throw new Error('queries is required and must contain at least one non-empty string.');
  }
  if (!bioMatch || bioMatch.length === 0) {
    throw new Error('bioMatch is required and must contain at least one non-empty string.');
  }
  if (viewerHandle) {
    log(`Pre-flighting viewer handle @${viewerHandle}...`);
    await preflightHandle(viewerHandle);
    log('  viewer ok');
  }

  // 1. Search
  log(`Searching across ${queries.length} queries...`);
  const pool = await searchAcrossQueries(queries);
  log(`  fetched ${pool.length} unique candidates`);

  // 2. Bio filter
  const bioMatched = filterByBio(pool, bioMatch, handleSuffixes);
  log(`  bio-matched: ${bioMatched.length}`);

  // Early exit on empty pool — nothing useful to do downstream.
  if (bioMatched.length === 0) {
    log('No candidates matched. Try broader --queries or --bio-match.');
    return {
      pack: { name, description },
      members: [],
      reshareTop: [],
      contactList: { tier1: [], tier2: [], notes: [] },
      saturationResult: null,
      diff: null,
      meta: {
        builtAt: new Date().toISOString(),
        queries,
        bioMatch,
        fetchedCount: pool.length,
        bioMatchCount: 0,
        afterActivityCount: 0,
        activityDays,
        networkAugmented: viewerHandle,
        emptyResult: true,
      },
    };
  }

  // 3. Profile fetch
  log('Fetching profiles for follower counts...');
  const profiles = await getProfilesBatched(bioMatched.map(c => c.did));
  log(`  got ${profiles.length} profile views`);

  // 4 + 5. Activity stats + filter
  log(`Checking activity (last ${activityDays}d)...`);
  const activityResults = await profileActivityStats(profiles, { activityDays });
  const activityByDid = new Map(activityResults.map(r => [r.did, r]));
  const active = filterByActivity(profiles, activityByDid, activityDays);
  log(`  active: ${active.length} (dropped ${profiles.length - active.length} dormant)`);

  // 6. Cross-pack membership (read-only; doesn't filter)
  let crossMap = new Map();
  if (packsDir) {
    crossMap = await loadAllPriorMemberships(packsDir);
    log(`  prior memberships loaded for ${crossMap.size} DIDs`);
  }
  const annotated = annotateWithCrossMembership(active, crossMap);

  // 7. Saturation
  let saturationResult = null;
  let saturationCounts = new Map();
  if (checkSaturation) {
    log('Scraping SPA for competing packs in theme...');
    saturationResult = await scrapeSaturation(name);
    if (!saturationResult) {
      log('  Puppeteer not installed; emitting manual-check URLs');
      saturationResult = { manualCheckUrls: manualCheckUrls(name), packs: [] };
    } else {
      log(`  found ${saturationResult.packs.length} competing packs`);
      if (deepSaturation && saturationResult.packs.length > 0) {
        log('  deep-scraping member lists from competing packs...');
        const memberScrapes = [];
        for (const p of saturationResult.packs.slice(0, 5)) {
          const m = await scrapePackMembers(p.url);
          if (m) memberScrapes.push(m);
        }
        saturationCounts = membershipCountFromScrapes(annotated, memberScrapes);
      }
    }
  }

  // 8. Network
  log(viewerHandle ? `Computing network signals for @${viewerHandle}...` : 'Skipping network signals (no --viewer)');
  const networkScores = await computeNetworkScores(viewerHandle, annotated);

  // 9. Scoring components
  log('Computing multi-signal scores...');
  const multiSignal = computeMultiSignal(annotated, activityByDid);
  const reshareScores = computeReshareProbability(annotated, bioMatch, activityByDid);
  const inverseSaturation = computeInverseSaturation(annotated, saturationCounts);

  // 10. Compose final
  const scored = composeFinalScores({
    profiles: annotated,
    multiSignal,
    reshareScores,
    networkScores,
    inverseSaturation,
  });

  // 11. Rationale
  const withRationale = annotateWithRationale(scored, bioMatch);

  // 12. Select top-N
  const finalMembers = withRationale.slice(0, limit);
  log(`Selected top ${finalMembers.length}`);

  // Reshare top sub-roster
  const reshareTop = topReshareCandidates(finalMembers, reshareScores, 10);

  // Contact list
  const contactList = generateContactList(finalMembers, reshareScores);

  // Diff against prior run
  let diff = null;
  if (packDir) {
    const prior = await loadPriorSnapshot(packDir);
    diff = diffSnapshots(prior, { members: finalMembers });
  }

  return {
    pack: { name, description },
    members: finalMembers,
    reshareTop,
    contactList,
    saturationResult,
    diff,
    meta: {
      builtAt: new Date().toISOString(),
      queries,
      bioMatch,
      fetchedCount: pool.length,
      bioMatchCount: bioMatched.length,
      afterActivityCount: active.length,
      activityDays,
      networkAugmented: viewerHandle,
    },
  };
}
