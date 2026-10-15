# Changelog

All notable changes to `bsky-pack-curator` will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-05-18

### Initial release

Read-only Bluesky starter-pack curation tool. Reads from the public AT Protocol AppView, produces a ranked roster + supporting documents, leaves the actual pack-creation step to the user via bsky.app's pack-builder UI.

### Added

- **Curation pipeline** — 13-step pipeline from search query to ranked roster (`src/pipeline.mjs`)
- **API client** — public-read wrapper around `public.api.bsky.app/xrpc/*` with retry/backoff (`src/api/client.mjs`)
- **Search** — paginated multi-query `searchActors` with DID-deduped union (`src/api/search.mjs`)
- **Profiles** — batched `getProfiles` for follower-count enrichment (`src/api/profiles.mjs`)
- **Activity stats** — `getAuthorFeed`-based last-post-date and engagement proxy (`src/api/feed.mjs`)
- **Social graph** — relationship lookups + follow-list pulls (`src/api/graph.mjs`)
- **Scoring modules** — multi-signal, activity, rationale, network, reshare-probability, inverse-saturation, compose (`src/scoring/`)
- **Saturation scraper** — DuckDuckGo HTML endpoint with Google fallback + CAPTCHA detection (`src/tools/saturation-scrape.mjs`)
- **Cross-pack dedupe** — track membership across runs (`src/tools/cross-pack-dedupe.mjs`)
- **Versioned diffs** — added / dropped / grew / shrank between snapshots (`src/tools/versioning.mjs`)
- **Tiered contact list** — auto-generated tag-on-launch / DM-day-1 / reply-thank tiers (`src/tools/contact-list.mjs`)
- **Renderers** — roster markdown, JSON snapshot + dataset, r/Bluesky post template (`src/render/`)
- **CLI** — `new` / `rerun` / `check-saturation` / `contacts` subcommands with `--help` (`bin/bsky-pack.mjs`)
- **Validation** — slug, limit, activity-days, viewer-handle pre-flight (`src/util/validate.mjs`)
- **Retry wrapper** — 3-attempt exponential backoff on transient 5xx / network errors (`src/util/retry.mjs`)
- **12 offline smoke tests** in `test/smoke.mjs`
- **GitHub Actions CI** running tests on Node 20 + 22
- **Examples** at `examples/README.md`
- **Stress-test audit log** at `STRESS-TESTS.md`

### Design choices

- **Read-only by design.** The tool does not authenticate to any Bluesky account, store credentials, or write online state. Final pack-creation is manual via bsky.app, so the tool never holds an app password and never has a credential-leak surface.
- **Activity weighting beats follower count.** The default ranking promotes accounts that actually post over dormant accounts with high follower counts.
- **Saturation discovery via DuckDuckGo.** Bluesky's public API has no pack-search endpoint (`app.bsky.graph.searchStarterPacks` returns 501) and the bsky.app SPA has no Packs filter, so theme-based competing-pack discovery has to go through general-purpose web search.
- **Cross-platform Node 20+ only.** Built on Windows + Node 24; CI runs on Linux + Node 20 + Node 22. macOS untested but uses no platform-specific code.
