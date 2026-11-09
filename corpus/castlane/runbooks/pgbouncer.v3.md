---
id: runbooks/pgbouncer.md@v3
source: runbooks
type: runbook
title: PgBouncer (pgbouncer-feeds, pgbouncer-payouts)
url: https://runbooks.castlane.internal/pgbouncer/v3
service: [pgbouncer-feeds, pgbouncer-payouts]
alerts: [PgBouncerPoolSaturated]
allowed_groups: [eng, contractors]
author: mbe
version: 3
effective_at: 2025-08-14
superseded_by: runbooks/pgbouncer.md@v4
is_current: false
deleted_at: null
updated_at: 2026-10-28T11:02:00Z
---

# PgBouncer (pgbouncer-feeds, pgbouncer-payouts)

Everything that talks to Postgres goes through PgBouncer. Apps never connect
to Postgres directly. This page covers both deployments, the settings we run
with and why, and what to do when `PgBouncerPoolSaturated` fires.

## What runs where

| Deployment | Namespace | Pods | In front of | Databases |
|---|---|---|---|---|
| pgbouncer-feeds | feeds | 2 | pg-feeds | `feeds` (primary), `feeds_ro` (standbys) |
| pgbouncer-payouts | payouts | 2 | pg-payouts | `payouts` |

Clients connect to the `pgbouncer-feeds` service on port 6432. The users
that go through pgbouncer-feeds are `feed_builder`, `upload_api`,
`private_feeds` and `stats_reader`. pgbouncer-payouts serves
`payouts_app` and `payouts_batch`.

The config lives in the ConfigMaps `pgbouncer-feeds-config` and
`pgbouncer-payouts-config`. Passwords are in `userlist.txt`, mounted from the
Secret of the same name, rotated by the secrets job (see the secrets
rotation runbook).

## Settings

```
[pgbouncer]
listen_port = 6432
pool_mode = transaction
max_client_conn = 2000
default_pool_size = 40
reserve_pool_size = 5
reserve_pool_timeout = 3
query_wait_timeout = 120
server_idle_timeout = 600
server_lifetime = 3600
admin_users = pgbouncer
stats_users = pgbouncer_exporter
```

What each one means for us:

- `pool_mode = transaction`: a server connection is held only for the length
  of a transaction. This is why apps must not use session state (`SET`,
  advisory locks, prepared statements outside a transaction). feed-builder
  had a bug about this in 2024, see the feed-builder runbook.
- `max_client_conn = 2000`: how many app connections one pod accepts. We
  run about 600 at peak per pod, so there is plenty of room.
- `default_pool_size = 40`: server connections per database and user pair.
  For pgbouncer-feeds that is 40. For pgbouncer-payouts it is 20 (set in the
  `[databases]` section with `pool_size=20`).
- `reserve_pool_size = 5`: extra connections a pool may open when a client
  has waited longer than `reserve_pool_timeout` seconds. Good for short
  spikes.
- `query_wait_timeout = 120`: a client that waits this long for a server
  connection gets an error. This is the error apps report as
  `query_wait_timeout` in their logs.
- `server_idle_timeout`, `server_lifetime`: idle server connections close
  after 10 minutes; every server connection is recycled after an hour.

## The alert

`PgBouncerPoolSaturated` fires when clients are waiting for a server
connection:

```
sum by (namespace, database) (pgbouncer_pools_client_waiting_connections) > 10
for: 3m
```

Severity `page` for pgbouncer-feeds, `ticket` for pgbouncer-payouts outside
the payout run.

## Diagnosis

1. Open the PgBouncer dashboard: https://grafana.castlane.internal/d/pgbouncer
   Look at "clients waiting" and "server connections active" per pod.
2. Connect to the admin console on one pod:

   ```
   kubectl -n feeds exec deploy/pgbouncer-feeds -- psql -h 127.0.0.1 -p 6432 -U pgbouncer pgbouncer
   ```

3. Run `SHOW POOLS;`. The columns that matter:
   - `cl_active`: clients linked to a server connection right now
   - `cl_waiting`: clients waiting for one. Above 0 for long means the pool is full.
   - `sv_active`: server connections in use. If this equals the pool size, the pool is full.
   - `maxwait`: how long the oldest waiting client has waited, in seconds.
4. Run `SHOW STATS;` to see which database has the traffic.
5. Check the apps. Which user's row has `cl_waiting`? Usually `feed_builder`
   after a big publish, or `private_feeds` when a private show goes out.

## Mitigation

If `cl_waiting` stays above 0 and `sv_active` equals the pool size, the pool
is too small for the load. Check that `default_pool_size` is 40 (someone may
have lowered it for testing) and then add PgBouncer capacity:

```
kubectl -n feeds scale deploy/pgbouncer-feeds --replicas=4
```

Each new pod brings its own pool, so this adds server connections at once.
Scale back to 2 the next day and open a ticket for data platform to look at
the pool size.

If only one app is waiting, look at that app first. A slow query holds its
server connection for longer, so the pool fills even though load is normal.
Find it with:

```
ssh -J bastion.castlane.internal postgres@pg-feeds-1.db.castlane.internal psql -c "select pid, usename, now() - xact_start as age, left(query, 80) from pg_stat_activity where state <> 'idle' order by age desc limit 10;"
```

and cancel it with `select pg_cancel_backend(<pid>);` if it is clearly
stuck. Never `pg_terminate_backend` the `feed_builder` publish transaction
without asking the feeds team; it leaves a half-built feed.

## Changing a setting

1. Edit the ConfigMap: `kubectl -n feeds edit configmap pgbouncer-feeds-config`.
2. Wait about a minute for the file to update in the pods.
3. Reload each pod from the admin console with `RELOAD;`. No restart, no
   dropped clients.
4. Put the change in the runbooks repo the same day, with a reason.

## FAQ

**Why not just set `default_pool_size` to 200?** Postgres works best with a
small number of busy connections. 40 per pair is enough for every load we
have seen.

**Can apps bypass PgBouncer during an incident?** No. Direct connections
skip the pool limits and can starve everyone else.

**Does `RELOAD` drop connections?** No. Pool size changes apply as
connections are opened and closed.

**Why are there two databases on pgbouncer-feeds?** `feeds_ro` sends
read-only traffic (stats, private feed reads) to the standbys so the
primary only takes writes and the reads that need to be fresh.

**What about pgbouncer-payouts?** Same settings, smaller pools, and
almost no traffic except during the payout run on the 15th.

## History

- v3 (2025-08-14): added `feeds_ro`, the FAQ and the scale-out step.
- v2 (2024-02-20): moved from the VM pgbouncer to Kubernetes.
- v1 (2024): first version.
