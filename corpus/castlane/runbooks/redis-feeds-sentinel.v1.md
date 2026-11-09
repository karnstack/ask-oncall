---
id: runbooks/redis-feeds-sentinel.md@v1
source: runbooks
type: runbook
title: "redis-feeds Sentinel failover"
url: https://runbooks.castlane.internal/redis-feeds-sentinel/v1
service: [redis-feeds]
alerts: [KubeStatefulSetReplicasMismatch]
allowed_groups: [eng, contractors]
author: gf
version: 1
effective_at: 2024-08-27
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2024-08-27T13:20:00Z
generated: true
---
# redis-feeds Sentinel failover

`redis-feeds` is the Redis layer for transcode and feed-rebuild queues in the `media` and `feeds` paths. It runs in `prod-us-east`, in the `media` namespace for the workload side and with Sentinel managing leader election for the Redis set. Ownership sits with platform and feeds, which is to say, everyone wants it fixed and nobody wants to hear about it.

This runbook covers the normal case where Sentinel has already failed over, and the less normal case where someone asks for a manual failover. There are three Redis pods and three Sentinel pods, per ADR-0022. Clients do not guess the master, they discover it through Sentinel. Good. Guessing is how tickets are born.

## Alerts that link here

- `KubeStatefulSetReplicasMismatch`

## Diagnosis

1. Check whether the Redis StatefulSet is healthy and whether the pod count matches the desired replicas.

```bash
kubectl --context prod-us-east -n media get statefulset redis-feeds
kubectl --context prod-us-east -n media get pods -l app=redis-feeds -o wide
kubectl --context prod-us-east -n media get pods -l app=redis-feeds-sentinel -o wide
```

Look for one Redis pod missing, restarting, or stuck `Pending`. Also check whether all three Sentinel pods are up. If one Sentinel is down but the Redis quorum is intact, Sentinel usually still manages to fail over on its own.

2. Ask Sentinel who the master is right now.

```bash
kubectl --context prod-us-east -n media exec -it redis-feeds-0 -- \
  redis-cli -p 26379 sentinel get-master-addr-by-name feeds
```

You should get an IP and port. If this returns nothing, or the command hangs, Sentinel is not in good shape. Do not start poking Redis directly as a hobby. That way lies confusion and a longer incident.

3. Confirm which pod is currently master, and whether the others agree.

```bash
kubectl --context prod-us-east -n media exec -it redis-feeds-0 -- redis-cli -p 6379 role
kubectl --context prod-us-east -n media exec -it redis-feeds-1 -- redis-cli -p 6379 role
kubectl --context prod-us-east -n media exec -it redis-feeds-2 -- redis-cli -p 6379 role
```

Exactly one pod should report `master`. The others should report `slave`. If two pods think they are master, stop and escalate. Split-brain is not a personality trait we encourage.

4. Check recent events for pod restarts, node pressure, or scheduling problems.

```bash
kubectl --context prod-us-east -n media describe pod redis-feeds-0
kubectl --context prod-us-east -n media get events --sort-by=.lastTimestamp | tail -n 20
```

If there is a node issue, you will usually see it here before you see it anywhere useful.

5. If Sentinel changed master recently, verify clients are resolving the new address.

```bash
kubectl --context prod-us-east -n media exec -it redis-feeds-0 -- \
  redis-cli -p 26379 sentinel masters
```

Check that `flags` includes `master`, not `s_down` or `o_down`. If the cluster has already failed over, this is usually enough to move on and watch the queues recover.

## Mitigation

Most of the time, the correct action is to do less.

- If one Redis pod is crash-looping, let Kubernetes restart it.
- If the master pod is gone and Sentinel has already promoted a replica, leave it alone.
- If only a Sentinel pod is bad, restart the pod or let the StatefulSet reconcile it.

Do **not** manually promote a Redis pod unless platform asked for that exact action. Manual failover is available, but it is not a comfort blanket.

If platform explicitly requests a manual failover, use the Sentinel pod and trigger it directly.

```bash
kubectl --context prod-us-east -n media exec -it redis-feeds-0 -- \
  redis-cli -p 26379 sentinel failover feeds
```

Then watch the result.

```bash
kubectl --context prod-us-east -n media exec -it redis-feeds-0 -- \
  redis-cli -p 26379 sentinel get-master-addr-by-name feeds
```

Wait for the new master address to settle, then confirm the Redis `role` output matches.

## Escalation

Escalate to `#platform` if any of these are true:

- Sentinel cannot identify a master after several minutes.
- Two Redis pods report `master`.
- The StatefulSet remains mismatched after pod restarts.
- The new master is not reachable from clients and queues are backing up.

Use `#feeds-dev` if the queue consumers are the visible symptom, but the root cause is clearly Redis. If the issue is tied to nodes or persistent volume problems, involve the platform on-call and keep the thread short. Long threads do not repair storage.

## Reference

- Sentinel discovery source of truth is `sentinel get-master-addr-by-name feeds`.
- Three Redis pods and three Sentinel pods are expected, per ADR-0022.
- Clients should not be pointed at a fixed Redis pod. That defeats the point of Sentinel and creates future archaeology.

## History

- 2024-08-27, v1, initial version for `redis-feeds` Sentinel failover and discovery.
- 2024-08-26, drafted from the production topology notes for ADR-0022.
- 2024-08-27, reviewed for alert coverage and manual failover constraints.
