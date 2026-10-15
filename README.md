# Xavi-Sky

Xavi-Sky is a local Bluesky discovery and manual-curation tool. It searches public Bluesky data for potentially interesting accounts, ranks and deduplicates them, and presents a review queue in the Xavi SPA.

**Xavi-Sky does not automatically follow accounts.** The scheduled worker contains no Bluesky follow-write code. A follow can only be created from the signed-in SPA after a user presses **Follow** and confirms the action.

## Runtime topology

The live runtime is intentionally simple:

- **production-4** runs the hourly discovery/ranking worker and stores state in local SQLite.
- **ConcreteCMS/Xavi-Sky SPA** provides the authenticated review interface and manual actions.
- **GitHub** is source/version history only. There is no scheduled GitHub Actions worker.
- **AWS is not part of Xavi-Sky.**
- There is no federation service or shared live database.

## Automated discovery

`src/worker.mjs` runs once per hour. It only performs discovery and ranking:

1. Rotates through configured themes.
2. Uses the vendored `gyapaganda-a11y/bsky-pack-curator` pipeline to search public accounts.
3. Bio-matches the active theme.
4. Fetches public profile/follower/post signals.
5. Drops accounts that appear inactive over the configured activity window.
6. Computes a curator score, score breakdown, and human-readable rationale.
7. Deduplicates actors by Bluesky DID.
8. Writes candidates, starter packs, run history, and ranking metadata into local SQLite.

The worker has no account password configuration and no `com.atproto.repo.createRecord` path.

Run it manually with:

```sh
node src/worker.mjs
```

The production systemd timer runs it at approximately seven minutes past each hour.

## Manual review SPA

The ConcreteCMS package is served at `/xavi-sky` and requires a signed-in Xavi user. The review interface includes:

- **Review Queue** — ranked suggestions for the selected Bluesky account.
- **All Candidates** — broader searchable candidate inventory.
- **Decisions** — followed, dismissed, snoozed, and queued review state.
- **Starter Packs** — discovered public starter-pack links.
- **Diagnostics** — recent local worker/event information.

Review controls include:

- search by handle, bio, or ranking rationale;
- theme filtering;
- minimum follower filtering;
- sorting by quality score, follower count, activity, or recency;
- visible rationale, source/theme tags, and score-breakdown signals;
- **Snooze** to hide an account temporarily;
- **Dismiss** to keep an account out of the queue;
- **Return to queue** from the Decisions tab;
- **Follow** only by an explicit user click followed by a confirmation prompt.

Legacy `followback` candidates from the removed cloud automation are excluded from the default review queue.

## Manual follow safety boundary

The only Bluesky follow-write implementation lives in:

```text
concretecms/xavi_sky/controller/api/Actions.php
```

The endpoint requires all of the following:

- authenticated Xavi/ConcreteCMS user;
- valid Xavi-Sky CSRF token;
- a configured local Bluesky account;
- a valid target DID;
- request field `manual: true`;
- a browser-side confirmation after the user clicks **Follow**.

Credentials remain local in:

```text
/datastore3/xavi-sky/secrets/bluesky-accounts.json
```

They are not committed to GitHub and are not used by the hourly discovery worker.

## Data

Primary state:

```text
/datastore3/xavi-sky/data/xavi-sky.sqlite
```

Candidate records persist public profile counts, ranking score, curator score, themes, discovery sources, rationale, and score-breakdown JSON. Manual per-account decisions are stored separately in `account_state`, keyed by `(account_handle, DID)`.

## Configuration

See `config.example.env`. The worker configuration contains discovery settings only; there are intentionally no federation or automatic-follow settings.
