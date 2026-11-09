---
id: runbooks/image-pull.md@v1
source: runbooks
type: runbook
title: "ImagePullBackOff from our registry"
url: https://runbooks.castlane.internal/image-pull/v1
service: [platform]
alerts: [KubeContainerWaiting]
allowed_groups: [eng, contractors]
author: bo
version: 1
effective_at: 2025-04-15
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-04-15T11:10:00Z
generated: true
---
# ImagePullBackOff from our registry

This runbook covers pods in any Castlane namespace that cannot pull images from `registry.castlane.internal`. It is owned by platform, because the failure usually sits at the boundary between Kubernetes, image publishing, and secret rotation. Most cases are one of three things, a tag was never pushed, the `regcred` pull secret expired after rotation, or the registry itself is down.

## Alerts that link here

- `KubeContainerWaiting`

## Diagnosis

1. Confirm the pod is actually stuck on image pull and capture the exact image reference.

```bash
kubectl -n <namespace> get pod <pod-name> -o wide
kubectl -n <namespace> describe pod <pod-name>
```

In the `Events` section, look for messages like `Failed to pull image`, `rpc error`, `unauthorized`, or `x509`. This is the fastest path to the real cause, and it is more reliable than guessing from the deployment spec.

2. Check whether the image tag exists in the manifest and matches what CI published.

```bash
kubectl -n <namespace> get deploy <deployment-name> -o jsonpath='{.spec.template.spec.containers[*].image}{"\n"}'
```

If the tag is a build tag, compare it with the last successful pipeline in the usual release path. A common pattern is that the deployment points at a tag that never made it to `registry.castlane.internal`, usually because CI failed after the image build step.

3. Verify the namespace has the expected pull secret and that it is still valid.

```bash
kubectl -n <namespace> get secret regcred
kubectl -n <namespace> describe secret regcred
kubectl -n <namespace> get serviceaccount default -o yaml
```

`regcred` should exist in the namespace and be referenced by the service account or pod spec. If the secret was rotated, the old credentials may have expired even though the object still exists. Check whether the secret data was refreshed in the rotation window.

4. Check whether the registry is reachable from the cluster and whether the issue is widespread.

```bash
kubectl -n <namespace> run pullcheck --rm -it --restart=Never --image=registry.castlane.internal/library/alpine:3.20 -- sh
```

If the test pod also fails to pull, the issue is not limited to one workload. If it starts, the problem is likely tag-specific or secret-specific.

5. If the registry is suspected, look for a broad failure pattern before changing workloads.

```bash
kubectl get pods -A | grep -E 'ImagePullBackOff|ErrImagePull'
kubectl -n kube-system get pods
```

A large number of pull failures across namespaces points to registry unavailability or an auth break. If only one deployment is affected, the image tag or `regcred` is the more likely cause.

## Mitigation

| Cause | Action | Notes |
| --- | --- | --- |
| Tag not pushed | Re-run the failed CI job or rebuild and push the missing tag | Do not edit the deployment to `:latest` just to make it start |
| `regcred` expired or missing | Recreate or refresh the pull secret in the namespace, then roll the workload | Keep the secret name as `regcred` so the service account binding stays stable |
| Registry down | Pause rollout activity, wait for recovery, and retry pulls | Confirm the registry is healthy before restarting many replicas |

Use a controlled rollout after the image or secret is fixed.

```bash
kubectl -n <namespace> rollout restart deploy/<deployment-name>
kubectl -n <namespace> rollout status deploy/<deployment-name> --timeout=5m
```

If the deployment is already in a bad state and a single pod is enough to validate recovery, delete one failing pod and let it recreate with the fixed image or secret.

```bash
kubectl -n <namespace> delete pod <pod-name>
```

Do not switch a deployment to `:latest` as a shortcut. That bypasses the release traceability we need, and it creates cache hit ratio problems for debugging because the pulled image may not match the intended build.

## Escalation

Escalate to `#platform` if the pull secret exists, the image tag is correct, and the registry is still returning failures from multiple namespaces. If the event stream shows auth failures right after a known rotation, page the platform owner on call and check whether `regcred` rotation completed everywhere it should have.

If the registry is down or returning intermittent pull failures across the cluster, open a `PLAT-` ticket and include:

- namespace and deployment name
- exact image reference
- the `Events` section from `kubectl describe pod`
- whether `regcred` exists in the namespace
- whether the problem is isolated or cluster-wide

If the issue persists after rollout restart and the registry health is unclear, ask in `#platform` for a second look, then hand off to the platform rotation if it needs live action.

## History

- 2025-04-15, version 1: Initial runbook for registry image pull failures, with checks for missing tags, rotated `regcred`, and registry outages.
- 2025-04-15, version 1: Added the `kubectl describe pod` event workflow and the warning not to use `:latest` as a recovery shortcut.
