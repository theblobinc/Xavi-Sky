# Xavi-Sky

Federated Bluesky starter-pack discovery, ranking, deduplication, and observability.

Each replica owns a local SQLite database. Replicas exchange immutable events and materialize the same candidate, starter-pack, node, run, and per-account state locally. A replica continues working when peers are unavailable and catches up later without copying live SQLite files.

The production Xavi server deploys `concretecms/xavi_sky` at `/xavi-sky`. GitHub Actions and generic VPS workers use the same worker code but do not activate the ConcreteCMS GUI.

## Worker

```sh
node src/worker.mjs
```

The worker rotates discovery themes, uses the vendored `gyapaganda-a11y/bsky-pack-curator`, discovers public starter-pack URLs, updates its local replica, and synchronizes configured peers before and after discovery.

## Federation

Configure pipe-separated peer roots with `XAVI_SKY_PEERS`. Every node keeps its own `data/xavi-sky.sqlite`. The shared bearer token is supplied using `XAVI_SKY_FEDERATION_TOKEN` or a local token file and is never committed.

Events are globally deduplicated by `event_id` and `(origin_node, origin_seq)`. Accounts are deduplicated by Bluesky DID, while account-specific processing state is keyed by `(account_handle, DID)`.

## GitHub Actions and WAN-loss operation

`.github/workflows/hourly.yml` runs once per hour with a five-minute job timeout. GitHub is an independent federation replica, not a dependency of the on-premises servers. If the Xavi WAN disappears, the GitHub worker keeps running in GitHub's cloud, continues public discovery using its own Internet connection, records events locally, and attempts federation again on later runs. When `www.xavi.app` becomes reachable, the append-only event logs reconcile and deduplicate automatically.

The GitHub replica does **not** rely on Actions cache as authoritative storage. Before every run it restores an AES-256-GCM encrypted SQLite snapshot from the `xavi-sky-state` branch. After every run it checkpoints SQLite, encrypts the database, and force-replaces that branch with a single current snapshot. The public repository therefore never stores the plaintext database or federation credential, and state survives runner replacement and ordinary cache eviction. The state branch is refreshed after each worker run. In addition, scheduled runs create an empty keepalive commit on the default branch whenever its newest commit is 30 days old, preventing GitHub's documented 60-day public-repository inactivity window from being reached during a long on-premises outage.

Set the repository secret `XAVI_SKY_FEDERATION_TOKEN` to the same federation token used by the trusted Xavi-Sky replicas. The workflow uses `https://www.xavi.app` as its on-premises peer directly; no peer repository variable is required.

A WAN partition has asymmetric effects by design: GitHub can continue reaching Bluesky and accumulating new discovery state, while on-premises replicas can continue serving and processing their already-local databases but cannot reach Bluesky until an Internet path returns. Neither side discards the other's work; federation catch-up occurs after reconnection.

## Manual follow actions

The production ConcreteCMS SPA can issue an explicit one-at-a-time Bluesky follow after a signed-in Xavi user clicks **Follow** for a candidate. Credentials are read only from `/datastore3/xavi-sky/secrets/bluesky-accounts.json`; they are never committed, federated, or returned by the API.

Copy `bluesky-accounts.example.json` to that protected path and replace the placeholders with Bluesky app-passwords. Successful writes create `app.bsky.graph.follow` records and emit federated `account.state` events keyed by `(account_handle, DID)` so other replicas do not repeat the action.
