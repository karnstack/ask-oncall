---
id: runbooks/upload-api-crashloop.md@v1
source: runbooks
type: runbook
title: "upload-api crash loops after a deploy"
url: https://runbooks.castlane.internal/upload-api-crashloop/v1
service: [upload-api]
alerts: [KubePodCrashLooping, KubeDeploymentReplicasMismatch]
allowed_groups: [eng, contractors]
author: lm
version: 1
effective_at: 2026-05-28
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2026-05-28T13:20:00Z
generated: true
---
# upload-api crash loops after a deploy

`upload-api` is the service in `media` that accepts creator uploads, validates requests, and hands work off to the rest of the media pipeline. It runs in the `media` namespace and is owned by the media team, with `lm` usually taking first pass on deploy-related issues. Most crash loops right after a deploy are config problems, especially a renamed Secret key or a missing env var, so start there before chasing anything deeper.

## Alerts that link here

- KubePodCrashLooping
- KubeDeploymentReplicasMismatch

## Diagnosis

1. Confirm that the crash loop started after the most recent rollout.

```bash
kubectl -n media rollout status deploy/upload-api
kubectl -n media get deploy upload-api -o wide
kubectl -n media get pods -l app=upload-api
```

Look for a recent generation change and pods that are restarting repeatedly. If the rollout is still progressing, watch whether replicas briefly come up and then fail.

2. Check the previous container logs first. For deploy-related crash loops, this usually shows the real error before Kubernetes restarts the pod.

```bash
kubectl -n media logs deploy/upload-api --previous
```

Common examples include:

```text
Error: missing required env var UPLOAD_MAX_SIZE_BYTES
panic: config key AUDIO_BUCKET_REGION not found
failed to load secret: key SIGNING_KEY was not present
```

If the pod dies very early, `--previous` is often the only place the useful message appears.

3. Inspect the pod spec for env vars, Secret references, and the readiness probe. The probe should hit `/healthz` on port `8080`.

```bash
kubectl -n media describe pod -l app=upload-api
kubectl -n media get deploy upload-api -o yaml
```

Check for:
- a renamed Secret key in `envFrom` or `valueFrom`
- a missing ConfigMap entry
- probe changes that point at the wrong path or port
- image tag changes that shipped a config expectation the deployment does not satisfy

4. Compare the current deployment with the last known good version. If the crash began immediately after a rollout, diff the manifest changes and look for environment or probe edits.

```bash
kubectl -n media rollout history deploy/upload-api
kubectl -n media describe deploy upload-api
```

If the app is failing before it can serve traffic, you may see readiness failing with messages like:

```text
Readiness probe failed: Get "http://10.42.3.18:8080/healthz": connection refused
```

That can be normal during startup for a short time, but if it repeats with restarts, treat it as part of the failure, not the cause by itself.

5. If logs and spec inspection do not explain the loop, check whether the pods are failing only in one zone or on one node class. This is rare for `upload-api`, but useful when the same manifest behaved earlier.

```bash
kubectl -n media get pods -l app=upload-api -o wide
kubectl -n media describe node <node-name>
```

A node issue is less likely if the crash started immediately after a deploy and the log shows a config error.

## Mitigation

The fastest safe mitigation is usually to roll back the deployment to the previous working revision.

```bash
# in #deploys or wherever you are coordinating the change
/deploy rollback upload-api
```

After rollback, verify that pods become ready and the service stops restarting.

```bash
kubectl -n media rollout status deploy/upload-api
kubectl -n media get pods -l app=upload-api
kubectl -n media logs deploy/upload-api
```

If rollback does not help, do not keep restarting pods manually. That tends to hide the real failure and makes the timeline harder to read. Instead, compare the current Secret and ConfigMap data with the expected keys, then patch the missing entry or restore the old key name through the normal config workflow.

If the issue is a readiness probe mistake, fix the probe to use `/healthz` on port `8080`, then redeploy. A bad probe can make a healthy process look broken, but it will not usually cause the process itself to crash.

## Escalation

Escalate to `lm` and the media on-call if:
- rollback does not restore healthy pods
- the logs show a new panic or startup failure that is not obviously config-related
- the deployment succeeds but readiness never passes after several minutes
- there is any sign that upload traffic is being dropped in prod

If the root cause is a Secret or ConfigMap change and you cannot quickly identify the missing key, ask for help in `#media` and include:
- the deploy time
- the exact log line from `kubectl -n media logs deploy/upload-api --previous`
- the output of `kubectl -n media describe pod <pod-name>`

## FAQ

**Why do I check `--previous` logs first?**  
Because in a crash loop, the current container often dies before you can attach to it, while the previous logs usually contain the startup exception.

**What if the pod is restarting but logs are empty?**  
Check the deployment spec and the probe configuration. An empty log plus instant restarts often means the container never got far enough to emit application logs.

**Should I scale the deployment down to stop the alert?**  
No. That only reduces capacity and does not solve the underlying deploy problem.

## History

- 2026-05-28, version 1, initial runbook for `upload-api` crash loops after deploys.
- 2026-05-28, version 1, added the standard rollback path and the `/healthz` readiness probe check.
- 2026-05-28, version 1, documented common startup errors from missing env vars and renamed Secret keys.
