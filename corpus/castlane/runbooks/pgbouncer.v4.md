---
id: runbooks/pgbouncer.md@v4
source: runbooks
type: runbook
title: PgBouncer (pgbouncer-feeds, pgbouncer-payouts)
url: https://runbooks.castlane.internal/pgbouncer/v4
service: [pgbouncer-feeds, pgbouncer-payouts]
alerts: [PgBouncerPoolSaturated]
allowed_groups: [eng, contractors]
author: mbe
version: 4
effective_at: 2026-10-28
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2026-10-28T11:02:00Z
---

# PgBouncer (pgbouncer-feeds, pgbouncer-payouts)

All Postgres traffic goes through PgBouncer. Rewritten after INC-2291,
effective 2026-10-28. The short version: when the pool is saturated, do not
add PgBouncer pods.

## What runs where

| Deployment | Namespace | Pods | In front of | Databases |
|---|---|---|---|---|
| pgbouncer-feeds | feeds | 3 | pg-feeds | `feeds` (leader), `feeds_ro` (replicas) |
| pgbouncer-payouts | payouts | 2 | pg-payouts | `payouts` |

pgbouncer-feeds users: `feed_builder`, `upload_api`, `private_feeds`,
`stats_reader`. pgbouncer-payouts users: `payouts_app`, `payouts_batch`.

## Settings

```
[pgbouncer]
pool_mode = transaction
max_client_conn = 2000
default_pool_size = 25
max_db_connections = 100
reserve_pool_size = 0
query_wait_timeout = 120
```

pgbouncer-payouts keeps `pool_size=20` per database, `max_db_connections = 50`.

## Why 25 and not 40

Until 2026-10-28 this runbook said `default_pool_size = 40`. That was safe
with two pgbouncer-feeds pods. Since 2026-09-08 there are three (PLAT-4410),
and every pod opens its own pool for every database and user pair:

```
3 pods x 40 x 4 users = 480 server connections
pg-feeds max_connections  = 400
```

During INC-2291 the pools filled for the first time. Postgres refused the
extra connections with SQLSTATE 53300 (`FATAL: sorry, too many clients
already`) and feed-builder failed requests instead of waiting. The old
mitigation, scaling pgbouncer-feeds out, made it worse: a fourth pod is
another 160 connections.

```
3 pods x 25 x 4 users = 300 server connections
```

300 leaves room under 400 for Patroni, replication, migrations, the
exporter and the superuser slots. `max_db_connections = 100` caps one pod
even if someone raises the pool size again. With these numbers a saturated
pool makes clients wait in PgBouncer (`cl_waiting`) for a few hundred
milliseconds. Waiting is fine. 53300 is not.

If you change the pod count or add a user, redo the multiplication first.

## PgBouncerPoolSaturated

```
sum by (namespace, database) (pgbouncer_pools_client_waiting_connections) > 10
for: 3m
```

1. Admin console on each pod:

   ```
   kubectl -n feeds exec <pod> -- psql -h 127.0.0.1 -p 6432 -U pgbouncer pgbouncer -c "SHOW POOLS;"
   ```

   `cl_waiting` above 0 with `sv_active` at 25 means the pool is full.
2. Check the client side. `53300` or `too many clients already` in app logs
   means Postgres is out of connections, not PgBouncer: someone has raised
   the pool size or the pod count. Go back to 25:

   ```
   SET default_pool_size = 25;
   RECONNECT feeds;
   ```

   on every pod, then fix the ConfigMap so it survives a restart.
3. `query_wait_timeout` errors with no 53300 means real load. Find slow
   queries on the leader (`pg_stat_activity`, oldest `xact_start` first).
   Cancel only what is clearly stuck.
4. Do not scale pgbouncer-feeds out. Do not raise `default_pool_size`.
   If load is genuinely higher than the pool, page data platform.

## Changing a setting

Edit `pgbouncer-feeds-config`, wait a minute, `RELOAD;` on each pod, and
redo the connection count above in the PR description.

## History

- v4 (2026-10-28): pool 40 to 25, `max_db_connections`, scale-out step
  removed, FAQ removed (it said 40 was enough for every load). After INC-2291.
- v3 (2025-08-14): `feeds_ro`, FAQ, scale-out step.
