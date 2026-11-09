---
id: runbooks/media-node-disk.md@v1
source: runbooks
type: runbook
title: "Disk filling up on media nodes"
url: https://runbooks.castlane.internal/media-node-disk/v1
service: [transcoder]
alerts: [NodeFilesystemSpaceFillingUp, NodeFilesystemAlmostOutOfSpace]
allowed_groups: [eng, contractors]
author: vi
version: 1
effective_at: 2025-03-04
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-03-04T16:45:00Z
generated: true
---
# Disk filling up on media nodes

This runbook covers media worker nodes running `transcoder` in the `media` namespace. The service writes temporary files to an `emptyDir` mounted at `/scratch`, with a `sizeLimit` of 20Gi. Ownership is with the media team, with help from platform if node capacity or eviction behavior looks wrong.

## Alerts that link here

- NodeFilesystemSpaceFillingUp
- NodeFilesystemAlmostOutOfSpace

## Diagnosis

1. Confirm which node is under pressure.

```bash
kubectl --context prod-us-east get nodes
kubectl --context prod-us-east describe node <node-name> | sed -n '/Conditions:/,/Addresses:/p'
kubectl --context prod-us-east top node <node-name>
```

Look for `DiskPressure`, rising filesystem use, or a node that is close to eviction thresholds.

2. Find `transcoder` pods on that node and check for evictions.

```bash
kubectl --context prod-us-east -n media get pods -o wide | grep <node-name>
kubectl --context prod-us-east -n media get pods | grep Evicted
kubectl --context prod-us-east -n media describe pod <pod-name>
```

If pods are evicted, check whether they exceeded `/scratch` or crashed while writing temp files. Look for `Evicted`, `ExceededEphemeralStorage`, or repeated restarts.

3. Check whether `transcoder` is using the scratch path heavily.

```bash
kubectl --context prod-us-east -n media exec <pod-name> -- sh -c 'df -h /scratch && du -sh /scratch/* 2>/dev/null | sort -h | tail -20'
```

If the pod is still alive, this shows whether `/scratch` is near the 20Gi limit. Large temp files that linger after failures point to cleanup problems.

4. Check container runtime image waste on the node.

```bash
kubectl --context prod-us-east debug node/<node-name> -it --image=busybox -- chroot /host sh -c 'crictl images | head -50'
kubectl --context prod-us-east debug node/<node-name> -it --image=busybox -- chroot /host sh -c 'crictl ps -a'
```

If image layers pile up, the node filesystem can fill even when pod logs look normal.

5. Prune unused images on the node.

```bash
kubectl --context prod-us-east debug node/<node-name> -it --image=busybox -- chroot /host sh -c 'crictl rmi --prune'
```

Run this only after confirming the node is safe to touch. It clears unused runtime images and often frees enough space to stop new evictions.

6. Recheck node pressure after cleanup.

```bash
kubectl --context prod-us-east describe node <node-name> | sed -n '/Conditions:/,/Addresses:/p'
kubectl --context prod-us-east top node <node-name>
kubectl --context prod-us-east -n media get pods -o wide | grep <node-name>
```

If the node still reports pressure, the cause is usually ongoing scratch growth, a crash loop, or another workload on the same node.

## Mitigation

1. If the node is actively evicting `transcoder` pods, reduce churn first.

```bash
kubectl --context prod-us-east -n media get pods | grep Evicted
kubectl --context prod-us-east -n media rollout status deploy/transcoder
```

2. Clear dead pods and let the deployment reschedule.

```bash
kubectl --context prod-us-east -n media delete pod <evicted-pod-name>
```

3. If a specific node keeps filling, drain it and let the scheduler move pods elsewhere.

```bash
kubectl --context prod-us-east drain <node-name> --ignore-daemonsets --delete-emptydir-data
```

Use this when the node is unhealthy or keeps filling after pruning. The `emptyDir` data is temporary, so deleting those pods is acceptable.

4. If the issue is repeated scratch overrun from a bad deploy, roll back the service.

```bash
/incident
/deploy rollback transcoder
```

Use rollback only if the current `transcoder` version is the trigger. Keep the incident channel updated before and after.

5. If the node is still at risk after prune and reschedule, cordon it.

```bash
kubectl --context prod-us-east cordon <node-name>
```

Leave it cordoned until filesystem use returns to normal and no new evictions occur.

## Escalation

Escalate to `mbe` if node disk use stays high after image prune and pod cleanup. Escalate to `vi` or `lm` if the problem tracks a `transcoder` deploy or a sudden rise in failed jobs. If multiple nodes in `prod-us-east` are affected, page platform in `#platform` and open a ticket with the node names, time of first alert, and the cleanup actions already taken.

Use `#incidents` and the active incident channel if this is paging more than one service. If the node is in a bad state after drain and prune, ask platform to replace it rather than trying repeated manual cleanup.

## Scratch limits

`transcoder` uses `/scratch` as an `emptyDir` with a `sizeLimit` of 20Gi. When a pod exceeds that limit, Kubernetes evicts it. Most cases come from one of two causes:

- Large temporary files piling up during encoding.
- Cleanup missing after a crash or abrupt termination.

If evictions repeat on the same workload, treat it as a service issue, not a node issue, until proven otherwise.

## History

- 2025-03-04, Version 1. Initial runbook for media node disk pressure, with node checks, image prune, and eviction handling.
- 2025-02-18, Drafted from `transcoder` oncall notes after repeated `emptyDir` evictions on `prod-us-east`.
- 2025-01-29, Added node filesystem checks and runtime cleanup steps after an increase in image layer buildup.
