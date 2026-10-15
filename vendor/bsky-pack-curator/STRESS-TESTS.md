# Stress Tests + Hardening Audit

This is the public log of how `bsky-pack-curator` was stress-tested before publication. It lists what was tested, what broke, what was fixed, and what surface remains unverified. Read this if you want to know how seriously the tool takes failure cases.

Built and audited on Windows 10, Node 24. Cross-platform claims are noted as unverified where applicable.

**Note on scope:** the v0.1.0 release deliberately ships *without* the AT Protocol auto-publish path. An earlier draft of the tool included `--publish` to create the pack on your account via app-password auth. That code was cleanly removed before release to eliminate the only credential-handling surface. The audit work below originally covered the publish flow too; this document has been pruned to reflect the shipped read-only surface.

---

## Test surfaces

### 1. Automated test suite — `npm test`

One test file, offline (no network, no credentials, no Puppeteer required). Safe to run on any clone in any environment, including CI.

#### `test/smoke.mjs` — 12 checks

| # | Check | What it verifies |
|---|---|---|
| 1 | module loading | All source files parse and import cleanly |
| 2 | `filterByBio` | Bio-substring match + custom-domain handle-suffix match |
| 3 | `extractRationale` | Per-member "why included" extraction from bio text |
| 4 | `computeMultiSignal` | Activity weighting beats pure follower-count when followers are equal |
| 5 | `filterByActivity` | Recent posts pass; year-old posts dropped |
| 6 | `computeReshareProbability` | Niche-active accounts outrank mega-accounts on reshare probability |
| 7 | `diffSnapshots` | Add / drop / grow / shrink correctly identified between snapshots |
| 8 | `renderRoster` | Markdown output contains pack name + member handles |
| 9 | `validateSlug` | Rejects path traversal, slashes, leading dots, Windows reserved names, oversized |
| 10 | `validateLimit` + `validateActivityDays` | Rejects 0 / >150 / negatives / non-integers |
| 11 | `withRetry` | Retries on 5xx, gives up on 4xx |
| 12 | empty-pool guards | `computeMultiSignal([])` returns `[]` instead of crashing |

### 2. Saturation scraper — manually verified end-to-end

Saturation scrape returned 5 real competing packs for the "substack" theme on first run (via DuckDuckGo HTML endpoint). Findings during build:

- bsky.app's search SPA has **no Packs filter** — `&t=packs` is a no-op; results are People-only. An early draft scraped a page that fundamentally cannot contain pack results.
- Google headless scraping is reliably CAPTCHA'd within seconds.
- DuckDuckGo's HTML endpoint (`html.duckduckgo.com/html/`) returns server-rendered results with `uddg=` URL-wrapping and is the practical discovery surface.

Saturation scraper now tries DDG first, falls back to Google. Both have CAPTCHA detection that returns clean status (`captcha: true`) rather than crashing.

### 3. CLI failure modes — manually verified

Every CLI path tested against deliberately-broken input. All produce clear errors and exit with code 1.

| Input | Behavior |
|---|---|
| `bsky-pack new` (no slug) | "requires slug" + example command |
| `bsky-pack new "../../EVIL"` | "slug must not contain slashes" |
| `bsky-pack new CON` | "Windows reserved name" |
| `bsky-pack new x` (slug 81+ chars) | "slug too long" |
| `--limit 0` / `--limit 200` | "must be at least 1" / "cannot exceed 150" |
| `--activity-days -5` | "must be non-negative" |
| `--queries=substack --bio-match=substack` (equals syntax) | Works the same as space-separated |
| `--queries a --queries b` (duplicate) | Warns + uses last value |
| `--viewer fake-handle.bsky.social` | Fails fast (preflight before expensive API calls) |
| Query returning 0 candidates | Clean exit + "try broader queries" |
| Network 5xx | Retries 3 times with exponential backoff |
| Network 4xx | Fails immediately (no retry on non-recoverable) |

### 4. CI smoke — GitHub Actions

`.github/workflows/smoke.yml` runs `npm test` on Node 20 and 22 against every push and PR. Catches module-loading regressions and assertion failures introduced by changes.

---

## Original audit findings (all fixed)

These broke on the first audit pass. All have been fixed and have test coverage where applicable.

| # | Issue | Fix |
|---|---|---|
| 1 | `npm test` pointed to non-existent file → MODULE_NOT_FOUND for any downloader | Built `test/smoke.mjs` with 12 offline checks |
| 2 | `packs/*` would commit to git, leaking real profile data into version control | `.gitignore` excludes `packs/*` with `.gitkeep` sentinel |
| 3 | `--flag=value` syntax silently ignored | Parser now handles both forms |
| 4 | Path traversal in slug (`new "../../EVIL"`) wrote outside packs/ | `validateSlug` rejects slashes / `..` / control chars / reserved names |
| 5 | Empty-pool crash with `Cannot read properties of undefined` and native UV assertion | Early-exit guards in pipeline + scoring modules |
| 6 | Bad `--viewer` wasted 30s of API calls before failing | `preflightHandle` runs BEFORE expensive ops |
| 7 | No retry on transient 429/5xx | `withRetry` wrapper with exponential backoff |
| 8 | `PACKS_ROOT = process.cwd()` meant output dir varied by CWD | Anchored to repo root via `import.meta.url`; override via `BSKY_PACKS_DIR` |
| 9 | Node 24 + Windows native UV assertion on `process.exit(1)` after fetch | Switched to `process.exitCode = 1` + natural event-loop drain |
| 10 | Saturation scraper scraped bsky.app search SPA, which has no Packs filter — returned 0 results forever | Rewrote to use DuckDuckGo HTML endpoint, with Google fallback + CAPTCHA detection |
| 11 | Display names with backticks/brackets/HTML broke markdown table layout | `sanitizeForTable` strips/escapes markdown-special characters |
| 12 | Saturation-no-puppeteer case said "no competing packs found" (misleading) | Renderer distinguishes "couldn't check" from "checked and found none" |
| 13 | `--limit 0` / `--limit 200` accepted silently | `validateLimit` rejects out-of-range with specific error |
| 14 | Duplicate flags silently dropped (`--queries a --queries b` kept only "b") | Parser warns when duplicates seen |

---

## Bluesky API side-findings worth knowing

Things discovered during stress testing that aren't documented elsewhere:

- **`app.bsky.graph.searchStarterPacks` returns 501** (MethodNotImplemented). No public API exists for theme-based pack discovery.
- **bsky.app SPA has no Packs filter in search.** Confirmed by DOM inspection. The query param `&t=packs` is a no-op.
- **Bulk `searchActors` responses omit `followersCount`.** That's why the curator does a separate `getProfiles` batch pass — searchActors gives you the candidate set; getProfiles gives you ranking signals.
- **DuckDuckGo HTML endpoint wraps all result links in `uddg=<URL-encoded>`.** A naive `a[href*="bsky.app"]` selector misses everything because the encoded form doesn't contain that substring. Real selector has to match on `uddg=` and unwrap.

---

## Known unverified surface

These are the gaps. None of them are unknown unknowns — they're listed here because they are *known* unknowns.

| Surface | Why unverified | Risk |
|---|---|---|
| macOS / Linux | Built and audited on Windows only. Path handling and shebang behavior probably fine but not asserted at runtime. | Low — uses Node's `path` module throughout; no platform-specific calls; CI does run on Linux |
| Node 20 / 22 | Built on Node 24. README claims Node 20+. CI does run on both. | Low — CI covers it |
| Custom feed generators | The tool doesn't generate or attach feed records (the entire publish path is omitted). | None for v0.1 — pack creation is manual |
| `package.json` `repository.url` | Currently points to a placeholder URL. Has no functional effect until `npm publish`. | Cosmetic |

---

## How to run all this yourself

```bash
git clone https://github.com/gyapaganda-a11y/bsky-pack-curator.git
cd bsky-pack-curator
npm install
npm test                    # 12 offline checks
```

Tests should complete in under 3 seconds. If any test fails after a clean clone, please open an issue. That is exactly what this audit is meant to prevent.
