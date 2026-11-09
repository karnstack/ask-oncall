---
id: wiki-export-2024/Postgres_Failover.md
source: wiki-export-2024
type: wiki
title: Postgres Failover
url: https://wiki.castlane.internal/display/ENG/Postgres+Failover
service: [pg-feeds, pg-payouts]
allowed_groups: [eng]
author: mbe
version: 7
effective_at: 2024-04-11
superseded_by: null
is_current: true   # the export knows nothing about the runbook registry; it was frozen on 2024-09-30
deleted_at: null
exported_at: 2024-09-30T12:00:00Z
updated_at: 2024-04-11T16:20:00Z
---

# Postgres Failover

Engineering / Platform / Databases / Postgres Failover

Created by mbe, last modified on Apr 11, 2024 (version 7)

Planned or emergency switchover of a Postgres primary to a standby. Covers
`pg-feeds` (3 nodes) and `pg-payouts` (2 nodes). Both clusters run Postgres on
the `db` VMs with repmgr managing replication. PgBouncer runs in Kubernetes
and points at the primary by hostname.

Owner: data platform. Ping mbe in #platform if you are unsure about any step.

## When to use this

- The primary is degraded (disk errors, I/O latency over 200 ms, kernel
  messages about the volume) but still up.
- Planned maintenance on the primary VM.
- Do NOT use this if the primary is already down hard. repmgrd will promote
  a standby on its own within about 60 seconds. Check `cluster show` first.

## Hosts

| Cluster | Node | Role (normal) |
|---|---|---|
| pg-feeds | pg-feeds-1.db.castlane.internal | primary |
| pg-feeds | pg-feeds-2.db.castlane.internal | standby |
| pg-feeds | pg-feeds-3.db.castlane.internal | standby |
| pg-payouts | pg-payouts-1.db.castlane.internal | primary |
| pg-payouts | pg-payouts-2.db.castlane.internal | standby |

SSH as `postgres` through the bastion: `ssh -J bastion.castlane.internal postgres@pg-feeds-2.db.castlane.internal`

## Procedure

### 1. Check the cluster

On any node:

```
repmgr -f /etc/repmgr.conf cluster show
```

All nodes should be `running`, and exactly one `primary`.

### 2. Check lag on the standby you will promote

```
psql -c "select now() - pg_last_xact_replay_timestamp() as replay_lag;"
```

Under 1 second is fine. If it is over 10 seconds, stop and ask in `#platform`.

### 3. Stop writes from feed-builder

```
kubectl -n feeds scale deploy/feed-builder --replicas=0
```

upload-api keeps working; uploads queue in Redis until feed-builder is back.

### 4. Dry run the switchover

On the standby you are promoting (usually `pg-feeds-2`):

```
repmgr -f /etc/repmgr.conf standby switchover --siblings-follow --dry-run
```

Read the output. It must end with `prerequisites for executing STANDBY SWITCHOVER are met`.

### 5. Run the switchover

Same node:

```
repmgr -f /etc/repmgr.conf standby switchover --siblings-follow
```

Takes 20 to 60 seconds. The old primary is demoted and follows the new one.

### 6. Point PgBouncer at the new primary

Edit the `[databases]` host in the `pgbouncer-feeds` ConfigMap, then reload
every pod:

```
kubectl -n feeds edit configmap pgbouncer-feeds-config
kubectl -n feeds rollout restart deploy/pgbouncer-feeds
```

### 7. Start writes again

```
kubectl -n feeds scale deploy/feed-builder --replicas=12
```

Watch `FeedBuildLagHigh` clear. Post in `#incidents` that the switchover is done.

## pg-payouts

Same steps with the `pg-payouts` hosts and namespace `payouts`. In step 3
scale `deploy/payouts-worker` to 0 instead. Never switch over during the
monthly payout run (06:00 to 08:00 UTC on the 15th).

## History

- v2 (2024-04-11): added `--siblings-follow`, without it pg-feeds-3 kept
  following the demoted node.
- v1 (2023): first version.

This page is moving to the runbooks repo (runbooks.castlane.internal). Edit it there, not here.

Labels: postgres, repmgr, failover, runbook

Comments (2)

rs, Jun 3, 2024: step 6 restarts every pgbouncer pod at once, is that ok during the day?

mbe, Jun 3, 2024: yes, clients reconnect in a second or two. Rolling restart, not all at once.
