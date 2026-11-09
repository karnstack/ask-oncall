---
id: runbooks/pvc-filling-up.md@v1
source: runbooks
type: runbook
title: "KubePersistentVolumeFillingUp on Postgres and Redis"
url: https://runbooks.castlane.internal/pvc-filling-up/v1
service: [pg-feeds, pg-payouts, redis-feeds]
alerts: [KubePersistentVolumeFillingUp]
allowed_groups: [eng, contractors]
author: mbe
version: 1
effective_at: 2026-06-22
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2026-06-22T15:38:00Z
generated: true
---
# KubePersistentVolumeFillingUp on Postgres and Redis

This alert means a PersistentVolumeClaim is close to full for one of Castlane’s stateful data services. In practice this affects `pg-feeds`, `pg-payouts`, or `redis-feeds`, in the `media`, `payouts`, or `feeds` namespaces depending on the workload. The owner teams are data platform for Postgres and feeds or payouts for the application-owned data stores, with escalation through `#platform`, `#feeds-dev`, or `#oncall-payouts` as appropriate.

## Alerts that link here

- `KubePersistentVolumeFillingUp`

## Diagnosis

1. Identify the exact PVC and pod, then confirm the free space trend.

```bash
kubectl --context prod-us-east get pvc -A | egrep 'pg-feeds|pg-payouts|redis-feeds'
kubectl --context prod-us-east describe pvc <pvc-name> -n <namespace>
kubectl --context prod-us-east get pod -n <namespace> -o wide | egrep '<statefulset-name>|<pod-name>'
```

Look for the mounted volume name, current size, and the pod using it. If the alert fired on `prod-eu-west`, verify whether it is only serving feeds data or whether the write-side problem is in `prod-us-east`.

2. For Postgres, check whether WAL is the reason for the growth before doing anything else.

```bash
psql "postgresql://<user>@pgbouncer-feeds.feeds.svc.cluster.local:6432/<db>" -c "
select slot_name,
       active,
       slot_type,
       restart_lsn,
       confirmed_flush_lsn
from pg_replication_slots
order by slot_name;"
```

Also check current WAL retention and database size trend if needed.

```bash
psql "postgresql://<user>@pgbouncer-payouts.payouts.svc.cluster.local:6432/<db>" -c "
select pg_size_pretty(sum(size)) as total_relation_size
from (
  select pg_total_relation_size(oid) as size
  from pg_class
  where relkind in ('r','t','m','i')
) s;"
```

If you see an inactive replication slot holding old WAL, that is usually the immediate cause. Do not delete WAL files by hand.

3. For Redis, check whether AOF growth is the driver.

```bash
kubectl --context prod-us-east exec -n feeds statefulset/redis-feeds -- redis-cli INFO persistence
kubectl --context prod-us-east exec -n feeds statefulset/redis-feeds -- redis-cli INFO memory
```

Look at `aof_current_size`, `aof_base_size`, and whether a rewrite is already in progress. If the AOF is large and stable writes are continuing, a rewrite is usually the right next action.

4. Confirm that the storage class supports online expansion before changing anything.

```bash
kubectl --context prod-us-east get pvc <pvc-name> -n <namespace> -o yaml | sed -n '/storageClassName:/p;/resources:/,/volumeMode:/p'
kubectl --context prod-us-east get storageclass -o yaml | egrep -A4 'allowVolumeExpansion|name:'
```

If `allowVolumeExpansion: true` is set, the PVC can be expanded without recreating the workload.

## Mitigation

1. If the disk is simply too small, expand the PVC first. Use the minimum size that restores safe headroom, then watch filesystem usage settle.

```bash
kubectl --context prod-us-east patch pvc <pvc-name> -n <namespace> \
  -p '{"spec":{"resources":{"requests":{"storage":"500Gi"}}}}'
```

After the patch, wait for the filesystem and the mounted volume to report the larger size. Do not restart the pod unless the resize is stuck.

2. If Postgres is growing because of an inactive replication slot, remove only the inactive slot that is no longer needed, after confirming it belongs to a dead consumer and has been reviewed.

```bash
psql "postgresql://<user>@pgbouncer-feeds.feeds.svc.cluster.local:6432/<db>" -c "
select slot_name
from pg_replication_slots
where active = false;"
```

Then drop the stale slot, not WAL files.

```bash
psql "postgresql://<user>@pgbouncer-feeds.feeds.svc.cluster.local:6432/<db>" -c "
select pg_drop_replication_slot('<slot_name>');"
```

3. If Redis is filling because of AOF growth, start a background rewrite once there is enough CPU and I/O headroom.

```bash
kubectl --context prod-us-east exec -n feeds statefulset/redis-feeds -- redis-cli BGREWRITEAOF
kubectl --context prod-us-east exec -n feeds statefulset/redis-feeds -- redis-cli INFO persistence
```

If `BGREWRITEAOF` cannot run because the node is overloaded or the pod is under memory pressure, expand the PVC first, then retry.

4. If the volume expansion does not complete promptly, check for the usual Kubernetes storage symptoms.

```bash
kubectl --context prod-us-east describe pod <pod-name> -n <namespace>
kubectl --context prod-us-east get events -n <namespace> --sort-by=.lastTimestamp | tail -n 30
```

Look for mount or resize related events. If the filesystem is not reflecting the new size after a reasonable wait, this becomes an escalation item.

## Escalation

Escalate if any of the following are true:

- The PVC cannot be expanded online.
- A Postgres inactive slot is present, but you cannot confirm whether it is safe to remove.
- `BGREWRITEAOF` fails twice, or Redis keeps growing after the rewrite completes.
- The pod restarts or becomes unhealthy during the resize.
- Free space remains below 15 percent after mitigation.

Route by service ownership:

- `pg-feeds`, `redis-feeds`, or feed-serving issues, page `mbe` or `#platform`.
- `pg-payouts`, page `#oncall-payouts` and `mbe`.
- For cross-service impact, open `PLAT-` or `FEED-` as appropriate and include the PVC name, current size, and the output of the slot or AOF checks.

## Settings and commands

| Service | What to check first | Safe first action |
| --- | --- | --- |
| `pg-feeds` | `pg_replication_slots` for inactive WAL retention | Expand PVC, then remove confirmed stale slot |
| `pg-payouts` | `pg_replication_slots` for inactive WAL retention | Expand PVC, then remove confirmed stale slot |
| `redis-feeds` | `INFO persistence` for AOF growth | Run `BGREWRITEAOF`, then expand PVC if needed |

## History

- 2026-06-22, version 1: Initial runbook for `KubePersistentVolumeFillingUp` on `pg-feeds`, `pg-payouts`, and `redis-feeds`.
- 2026-06-22, version 1: Added Postgres WAL diagnosis via `pg_replication_slots`, and Redis AOF mitigation via `BGREWRITEAOF`.
- 2026-06-22, version 1: Documented online PVC expansion through storage class supported resize.
