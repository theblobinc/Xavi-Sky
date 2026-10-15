# bsky-pack-curator

> Built by [Vincent Couey](https://bsky.app/profile/vincentcouey.bsky.social) at [DeepSynthesis.org](https://deepsynthesis.org). Free, MIT-licensed, no sign-up.

Curate and score Bluesky starter packs from the public AT Protocol API.

Most pack-builder tools sort by follower count and stop there. This one adds activity weighting, network-graph augmentation, saturation scraping, per-member rationale extraction, cross-pack deduplication, versioned diffs, and a tiered amplification contact list. Output is a ranked roster you paste into the Bluesky pack-builder UI to create the live pack on your account.

**The tool is read-only.** It reads from Bluesky's public API and writes only to local files in `packs/`. It does not authenticate to your Bluesky account, store credentials, or modify anything online. The final step — creating the pack on bsky.app — is yours, with the roster as a one-page paste sheet.

## 5-minute quickstart

```bash
# 1. Clone + install
git clone https://github.com/gyapaganda-a11y/bsky-pack-curator.git
cd bsky-pack-curator
npm install

# 2. Verify your install works
npm test

# 3. Curate your first pack
node bin/bsky-pack.mjs new my-first-pack \
  --queries "substack" \
  --bio-match "substack" \
  --limit 20

# 4. Read your output
cat packs/my-first-pack/roster.md
```

The roster includes a 4-step walkthrough for pasting the result into bsky.app's pack builder. To explore more options: `node bin/bsky-pack.mjs help new` or browse `examples/README.md`.

## Why this exists

Bluesky's pack-search XRPC method (`app.bsky.graph.searchStarterPacks`) returns `501 MethodNotImplemented` on the public AppView, AND bsky.app's search SPA has no Packs filter at all. The packs surface is hard to inspect programmatically. This tool fills the gap on the curation side — giving the curator activity-weighted rankings, social-graph context, and competing-pack discovery that no built-in UI provides.

## Install

```bash
git clone https://github.com/gyapaganda-a11y/bsky-pack-curator.git
cd bsky-pack-curator
npm install
```

**Requirements:** Node 20+.

**No Bluesky credentials needed.** All endpoints used are public reads.

**For saturation scraping** (optional, only needed for `--check-saturation`), install Puppeteer:

```bash
npm install puppeteer    # ~170 MB Chromium download
```

Without Puppeteer, `--check-saturation` falls back to printing manual-check URLs.

## More examples

```bash
# Network-graph augmented (boosts mutuals + your follows in the rankings)
node bin/bsky-pack.mjs new substack-writers \
  --queries "substack,newsletter writer" \
  --bio-match "substack,newsletter" \
  --viewer yourhandle.bsky.social

# With saturation check
node bin/bsky-pack.mjs new substack-writers \
  --queries "substack" --bio-match "substack" \
  --check-saturation
```

See `examples/README.md` for more.

## Subcommands

| Command | Purpose |
|---|---|
| `new <slug>` | Run full curation pipeline, save outputs |
| `rerun <slug>` | Re-run last config; output diff vs prior snapshot |
| `check-saturation "<theme>"` | DDG/Google-scrape competing packs in a theme (Puppeteer required) |
| `contacts <slug>` | Print tiered tag/DM list for a saved pack |

Run any command with `--help` for full flag list.

## Pipeline design

The full pipeline runs 13 steps. Each step is a separate module so you can fork and replace any one of them.

```
 1. searchAcrossQueries         multi-query union, deduped by DID
 2. filterByBio                 keep candidates matching bio pattern OR handle suffix
 3. getProfilesBatched          fetch follower counts (searchActors omits these)
 4. profileActivityStats        last-post-date + post cadence + engagement proxy
 5. filterByActivity            drop dormant accounts (default: no posts in 30d)
 6. loadAllPriorMemberships     cross-pack membership awareness
 7. scrapeSaturation            DDG/Google scrape competing packs (optional)
 8. computeNetworkScores        viewer's social graph (optional)
 9. computeMultiSignal          followers × activity × engagement (normalized, weighted)
10. computeReshareProbability   inverse-followers × keyword density × activity
11. computeInverseSaturation    members in fewer competing packs get a bonus
12. composeFinalScores          weighted sum -> ranked list
13. annotateWithRationale       per-member "why included" bio sentence
```

## The ten overhauls

What this tool does that bare follower-sort doesn't:

1. **Multi-signal ranking** — `followers × log(posts_in_last_30d) × engagement_rate`, normalized
2. **Activity-recency filter** — drop dormant accounts (configurable window)
3. **Per-member rationale** — extract the bio sentence that triggered the match
4. **Network-graph personalization** — boost candidates in viewer's social graph
5. **Reshare-probability scoring** — separately rank "most likely to amplify on inclusion"
6. **Cross-pack dedupe** — track membership across all your packs over time
7. **Saturation scraper** — DDG/Google-scrape competing packs in the theme since the bsky API is 501
8. **Inverse-saturation scoring** — under-represented members get a bonus
9. **Versioned diffs** — re-run later to see who joined, dropped, grew, shrank
10. **Tiered contact list** — auto-generated tag-on-launch / DM-day-1 / reply-thank tiers

## Configuration

Scoring weights live in `src/config.mjs` and can be tuned:

```js
export const SCORING_WEIGHTS = {
  followers: 1.0,           // log-scaled follower count
  activity: 0.6,            // recent post cadence
  engagement: 0.4,          // likes-per-post proxy
  network: 0.8,             // boost if in your social graph
  reshareLikelihood: 0.5,   // smaller niche-matched accounts amplify harder
  inverseSaturation: 0.3,   // bonus for under-represented in existing packs
};
```

Defaults like activity window, batch sizes, and rate limits live in the same file.

## Rate limits and politeness

The public AppView is generous but not infinite. Default activity-check concurrency is 8 and there's an 80ms delay between sequential calls. Tune in `src/config.mjs` if you see 429s. There's also a 3-attempt exponential-backoff retry for transient 5xx / network failures.

For a typical 150-account pack: ~5 search pages × queries, ~6 getProfiles batches, ~150 getAuthorFeed calls (parallel-throttled), plus relationship lookups if `--viewer` is set. Expect 30–90 seconds end-to-end.

## What this tool deliberately doesn't do

- **Doesn't authenticate to your Bluesky account.** No credentials, no app passwords, no writes. The final pack-creation step is manual via bsky.app, by design.
- **Doesn't enforce a pack-content ethics policy.** Bio-match is keyword-mechanical; you're responsible for vetting members before publishing.
- **Doesn't run a custom feed server.** A hosted algorithmic feed needs separate infra.

## Testing + audit

This repo was stress-tested before publication. See [STRESS-TESTS.md](STRESS-TESTS.md) for the full audit log: what was tested, what broke, what was fixed, what surface remains unverified, and how to reproduce every check yourself.

## Note on this repository URL

The `repository.url` field in `package.json` currently points to
`https://github.com/gyapaganda-a11y/bsky-pack-curator.git`. If you fork, update it
to your fork's URL before running `npm publish`.

## About

Made by [Vincent Couey](https://bsky.app/profile/vincentcouey.bsky.social) at [DeepSynthesis.org](https://deepsynthesis.org).

Free to use, fork, or extend. No sign-up. No telemetry. No tracking. The tool reads public Bluesky data and writes only to local files. If you ship something cool with it, ping me on Bluesky — I'd love to see it.

## License

MIT
