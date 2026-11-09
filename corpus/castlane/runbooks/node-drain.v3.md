---
id: runbooks/node-drain.md@v3
source: runbooks
type: runbook
title: "Draining a node for maintenance"
url: https://runbooks.castlane.internal/node-drain/v3
service: [platform]
alerts: [KubeNodeNotReady, KubePodNotReady]
allowed_groups: [eng, contractors]
author: hq
version: 3
effective_at: 2026-01-20
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2026-01-20T11:10:00Z
generated: true
---
# Draining a node for maintenance

Use this runbook when a Kubernetes node needs planned maintenance, kernel work, hardware replacement, or controlled retirement. It applies to Castlane clusters in the `platform` namespace scope for node operations, but the same steps affect workloads across all namespaces on that node. Owner team is `platform`, with coordination from the owning service team if the node carries service-specific traffic.

**Do not skip the leader check if the node runs Postgres.**  
**In `cdn-edge` pools, drain one node at a time.**

## Alerts that link here

- `KubeNodeNotReady`
- `KubePodNotReady`

## Diagnosis

1. Identify the node and confirm which cluster it belongs to.

   ```bash
   kubectl --context prod-us-east get nodes -o wide
   kubectl --context prod-eu-west get nodes -o wide
   ```

2. Check whether the node is already cordoned or has unstable conditions.

   ```bash
   kubectl --context prod-us-east describe node <node>
   kubectl --context prod-eu-west describe node <node>
   ```

   Look for `Unschedulable: true`, `MemoryPressure`, `DiskPressure`, or repeated `NotReady` transitions.

3. Check whether the node is hosting Pods that cannot be safely evicted.

   ```bash
   kubectl --context prod-us-east get pods -A -o wide --field-selector spec.nodeName=<node>
   kubectl --context prod-eu-west get pods -A -o wide --field-selector spec.nodeName=<node>
   ```

   Watch for stateful workloads, `pdb` protected workloads, or anything in `pg-feeds` or `pg-payouts`.

4. Check PodDisruptionBudgets before any drain.

   ```bash
   kubectl --context prod-us-east get pdb -A
   kubectl --context prod-eu-west get pdb -A
   ```

   **If a PDB would block eviction, do not force the drain.** Adjust the maintenance window or coordinate a temporary service-side mitigation first.

5. If the node runs Postgres, confirm whether it holds the current leader.

   ```bash
   kubectl --context prod-us-east get pods -n default -o wide | grep -E 'pg-feeds|pg-payouts'
   kubectl --context prod-us-east get pods -n default -o wide | grep <node>
   ```

   If the leader is on this node, move the leader first using the Postgres failover runbook: https://runbooks.castlane.internal/postgres-failover

   **Do not drain a Postgres leader node first.**

6. If the node is in a `cdn-edge` pool, confirm there is at most one maintenance target at a time.

   ```bash
   kubectl --context prod-eu-west get nodes -l pool=cdn-edge
   kubectl --context prod-eu-west get pods -n edge -o wide
   ```

   **After the 2026-01 edge capacity incident, never drain more than one `cdn-edge` node at once.**

## Mitigation

1. Cordon the node so no new Pods schedule onto it.

   ```bash
   kubectl --context prod-us-east cordon <node>
   kubectl --context prod-eu-west cordon <node>
   ```

2. Re-check PodDisruptionBudgets and workload placement.

   ```bash
   kubectl --context prod-us-east get pdb -A
   kubectl --context prod-us-east get pods -A -o wide --field-selector spec.nodeName=<node>
   ```

3. Drain the node with the standard command.

   ```bash
   kubectl --context prod-us-east drain <node> --ignore-daemonsets --delete-emptydir-data --timeout=10m
   kubectl --context prod-eu-west drain <node> --ignore-daemonsets --delete-emptydir-data --timeout=10m
   ```

4. If drain hangs, inspect the blocking Pod and decide whether to wait, reschedule, or escalate.

   ```bash
   kubectl --context prod-us-east get pod <pod> -n <namespace> -o yaml
   kubectl --context prod-us-east describe pod <pod> -n <namespace>
   ```

   **Do not use a forced delete unless the service owner and oncall have agreed.**

5. After the drain completes, verify the node is empty except for DaemonSets.

   ```bash
   kubectl --context prod-us-east get pods -A -o wide --field-selector spec.nodeName=<node>
   kubectl --context prod-eu-west get pods -A -o wide --field-selector spec.nodeName=<node>
   ```

6. Hand the node to the maintenance owner, or uncordon it if the work is finished.

   ```bash
   kubectl --context prod-us-east uncordon <node>
   kubectl --context prod-eu-west uncordon <node>
   ```

## Escalation

- If the node stays `NotReady` after cordon and drain, open `PLAT-` and page `#oncall`.
- If a Postgres leader cannot be moved cleanly, escalate to `mbe` and follow the Postgres failover runbook before touching the node again.
- If drain blocks on application Pods with a strict PDB, contact the owning team in the service channel and document the blocker.
- If the node is in a `cdn-edge` pool and capacity looks tight, notify `yu` or `bo` before taking the next node out.
- If you see repeated kubelet or container runtime failures on the node, attach `kubectl describe node <node>` output and the event list to the ticket.

## History

- 2025-11-08, version 1, initial runbook for planned node maintenance across prod clusters.
- 2026-01-08, version 2, added the Postgres leader check and explicit PDB review before drain.
- 2026-01-20, version 3, added the one-node-at-a-time rule for `cdn-edge` pools after the edge capacity incident.
