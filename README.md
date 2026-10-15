# Xavi-Sky

Federated Bluesky discovery, ranking, deduplication, and observability.

The live deployment uses an **AWS always-on primary** plus an **opportunistic production-4 replica**. GitHub is source/versioning only and does not run Xavi-Sky automation.

## Runtime topology

### AWS primary

AWS runs `xavi-sky-free-worker` once per hour through EventBridge. The worker:

- performs public Bluesky discovery independently of the on-premises network;
- persists candidates, immutable outbound events, peer cursors, follower-scan state, and imported-event dedupe markers in DynamoDB;
- maintains a DynamoDB worker lease so overlapping invocations do not act as multiple primaries;
- signs federation requests with an AWS-only P-256 private key held in encrypted SSM Parameter Store;
- pushes AWS-origin events to production-4 when it is reachable;
- pulls production-4 events back into DynamoDB and resumes from durable cursors after outages.

AWS therefore remains useful if production-4 or the Xavi WAN is unavailable. A failed federation attempt does not stop discovery or discard AWS state.

### production-4 replica

production-4 keeps the full local SQLite/event implementation in `data/xavi-sky.sqlite` and runs its own hourly discovery timer. It can continue serving the ConcreteCMS Xavi-Sky interface and performing local discovery whenever its Internet connection is available.

The public federation routes are exposed by the ConcreteCMS package. They accept the existing local bearer-token authentication and signed requests from the AWS primary. AWS possesses the private signing key; production-4 stores only the corresponding public verification key.

When production-4 returns after an outage, AWS resumes push/pull federation from its durable cursors. Events are deduplicated by immutable `event_id` and `(origin_node, origin_seq)`, while Bluesky actors are deduplicated by DID.

## GitHub

This repository is the public source and version-history location only. There is intentionally no scheduled GitHub Actions worker. Runtime state is not dependent on GitHub.

## Local worker

```sh
node src/worker.mjs
```

The local worker rotates discovery themes, uses the vendored `gyapaganda-a11y/bsky-pack-curator`, discovers public starter-pack URLs, and materializes candidates and immutable events into the local SQLite replica.

## Federation data model

Each runtime keeps durable state appropriate to its environment rather than sharing a live SQLite file over the network:

- production-4: SQLite event log and materialized tables;
- AWS: DynamoDB event/outbox records, imported-event markers, candidates, peer cursors, and worker lease.

The federation contract uses immutable event objects containing `event_id`, `origin_node`, `origin_seq`, event/entity types, entity ID, optional account handle, JSON payload, and creation time. Replaying an event is safe because receivers deduplicate by event ID.

## Follower and follow-back discovery

The AWS hourly worker also scans public follower pages for the configured Xavi Bluesky accounts. Newly seen followers are deduplicated into a follow-back candidate queue and federated to production-4 as high-priority candidate events. Follower pagination cursors are durable, so repeated hourly runs walk the follower set rather than continually rereading only the first page.

The queue is discovery/state automation. Bluesky credentials remain protected on production-4 and are not committed to GitHub or included in federation payloads.

## Manual follow actions

The production ConcreteCMS SPA can issue an explicit one-at-a-time Bluesky follow after a signed-in Xavi user clicks **Follow** for a candidate. Credentials are read only from `/datastore3/xavi-sky/secrets/bluesky-accounts.json`; they are never committed, federated, or returned by the API.

Copy `bluesky-accounts.example.json` to that protected path and replace the placeholders with Bluesky app-passwords. Successful writes create `app.bsky.graph.follow` records and emit federated `account.state` events keyed by `(account_handle, DID)` so replicas share action state.
