---
id: runbooks/deploy-rollback.md@v1
source: runbooks
type: runbook
title: "Rolling back a deploy"
url: https://runbooks.castlane.internal/deploy-rollback/v1
service: [platform]
alerts: [KubeDeploymentGenerationMismatch]
allowed_groups: [eng, contractors]
author: ok
version: 1
effective_at: 2025-08-26
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-08-26T16:45:00Z
generated: true
---
# Rolling back a deploy

This runbook covers how to roll back a bad deployment in Castlane when a service starts misbehaving after a release. Most of the time this is a platform-owned service in the `platform` namespace, but the same flow works for other namespaces when you know the target service name. The happy path is to use `deploy-bot` in Slack, which rolls back to the previous release and posts the result in `#deploys`.

## Alerts that link here

- `KubeDeploymentGenerationMismatch`

## Diagnosis

1. Confirm the deployment is actually stuck or unhealthy, and that the alert points at the right service.

```bash
kubectl --context prod-us-east -n platform get deploy
kubectl --context prod-us-east -n platform describe deploy/<service>
kubectl --context prod-us-east -n platform rollout status deploy/<service>
```

Look for a mismatch between the desired and observed generation, repeated pod restarts, or a rollout that is not making progress. If the service is in another namespace, swap `platform` for the right one.

2. Check whether the new ReplicaSet is the one causing trouble.

```bash
kubectl --context prod-us-east -n platform get rs --sort-by=.metadata.creationTimestamp
kubectl --context prod-us-east -n platform get pods -l app=<service> -o wide
kubectl --context prod-us-east -n platform describe pod <pod-name>
```

If new pods are failing readiness, crashing, or sitting Pending, the deploy is a likely cause. If the problem is unrelated to the new ReplicaSet, pause here and investigate the underlying issue before rolling back.

3. Verify whether there was a recent config or image change, and whether a database migration shipped with it.

```bash
kubectl --context prod-us-east -n platform get deploy <service> -o yaml | sed -n '/image:/p;/args:/p;/env:/p'
kubectl --context prod-us-east -n platform get rs --show-labels
kubectl --context prod-us-east -n platform logs deploy/<service> --tail=100
```

If the deploy includes a database migration, treat it as forward-only. A rollback may require the owning team to ship a follow-up migration or code change, because reverting the app alone can leave the schema and code out of sync.

4. If you need a fast rollback, use `deploy-bot` first.

```text
/deploy rollback <service>
```

This rolls the deployment back to the previous release and posts status in `#deploys`. Use this when the change is clearly deploy-related and you want the standard path with the least manual editing.

5. If Slack rollback is unavailable, use Kubernetes directly.

```bash
kubectl --context prod-us-east -n platform rollout undo deploy/<service>
kubectl --context prod-us-east -n platform rollout status deploy/<service>
kubectl --context prod-us-east -n platform get rs
```

This is the fallback. It reverts the deployment to the last ReplicaSet template that Kubernetes still has available.

## Mitigation

1. Roll back the service using `deploy-bot` if possible.

```text
/deploy rollback <service>
```

2. If Slack rollback fails or is not available, do the same thing with `kubectl`.

```bash
kubectl --context prod-us-east -n platform rollout undo deploy/<service>
```

3. Watch the rollout until the old version is stable again.

```bash
kubectl --context prod-us-east -n platform rollout status deploy/<service>
kubectl --context prod-us-east -n platform get pods -l app=<service>
```

4. If the deploy included a migration, page or message the owning team right away. They need to confirm whether the rollback is safe, or whether a compensating migration is required. In practice, this means you should not keep retrying deploys until the schema story is understood.

5. If the bad release already reached other namespaces, repeat the same rollback there, but keep the rollout order sensible. For a service with separate prod write and feed-serving environments, roll back the write path first if it is the one serving user traffic.

## Extra note: what to keep in mind before retrying

- A rollback fixes the deployed code, not the root cause.
- If the deployment is failing because of an environment variable, bad secret, or broken config map, the previous release may still fail if that dependency changed too.
- If `kubectl rollout undo` succeeds but the service still looks unhealthy, check pod logs and readiness probes before doing another deploy.

## Escalation

- If the rollback fails, or the deployment keeps flipping back to a broken state, escalate in `#platform` and mention `@dara` or `@ne`.
- If a migration is involved, include the owning team and ask for confirmation before making further changes.
- If you suspect a cluster or control plane problem rather than a bad deploy, open a ticket with the platform team and attach the output from `kubectl describe deploy/<service>` and `kubectl rollout status deploy/<service>`.
- If the service is customer-facing and the rollback does not restore health within 10 minutes, escalate in `#incidents` and start an incident if needed.

## History

- 2025-08-26, version 1, initial runbook published for rolling back deploys in response to `KubeDeploymentGenerationMismatch`.
- 2025-08-26, version 1, added the Slack rollback path with `/deploy rollback <service>` and the `kubectl rollout undo` fallback.
- 2025-08-26, version 1, clarified that database migrations are forward-only and need the owning team if rollback touches schema changes.
