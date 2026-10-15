# Example commands

Copy-paste these to see the tool in action. Each one runs the full curation pipeline against the public Bluesky API. No credentials needed for any of them.

The output goes to `packs/<slug>/roster.md`, which includes a 4-step walkthrough for creating the pack on bsky.app once you've reviewed the roster.

## Substack writers (broad theme, large pool)

```bash
node bin/bsky-pack.mjs new substack-writers \
  --queries "substack" \
  --bio-match "substack" \
  --name "Substack Writers on Bluesky" \
  --description "150 Substack writers active on Bluesky, ranked by activity-weighted score." \
  --viewer YOUR_HANDLE.bsky.social
```

Pool size: ~400 candidates. Final: top 150 by composite score.

## Independent scholars (niche, high reshare-rate)

```bash
node bin/bsky-pack.mjs new indie-scholars \
  --queries "independent scholar,indie researcher,independent researcher" \
  --bio-match "independent scholar,indie researcher,independent researcher" \
  --name "Independent Scholars on Bluesky" \
  --description "The non-institutional academy on Bluesky. Curated for visibility." \
  --viewer YOUR_HANDLE.bsky.social
```

Pool size: ~400. Top follower count is ~20k, not millions — by design for the reshare-rate advantage.

## Long-form essayists / newsletter writers

```bash
node bin/bsky-pack.mjs new longform-essayists \
  --queries "essayist,long-form essay,newsletter writer" \
  --bio-match "essayist,long-form,longform,newsletter" \
  --name "Long-form Writers on Bluesky" \
  --description "150 essayists and newsletter writers on Bluesky." \
  --viewer YOUR_HANDLE.bsky.social
```

## With saturation check (requires Puppeteer)

```bash
npm install puppeteer    # one-time, ~170MB download

node bin/bsky-pack.mjs new substack-writers \
  --queries "substack" \
  --bio-match "substack" \
  --check-saturation
```

Scrapes DuckDuckGo (falling back to Google) for existing packs in the theme so you know what you're competing with.

## Re-run a saved pack and see the diff

```bash
node bin/bsky-pack.mjs rerun substack-writers
```

Output shows accounts added, dropped, grown 2×, and shrunk 30%+ since last run.

## Just check saturation, no curation

```bash
node bin/bsky-pack.mjs check-saturation "indie hackers"
```

## Get the contact list for a saved pack

```bash
node bin/bsky-pack.mjs contacts indie-scholars
```

Prints the tiered tag-on-launch / DM-day-1 list for your amplification choreography.
