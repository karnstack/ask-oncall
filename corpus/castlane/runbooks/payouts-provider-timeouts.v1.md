---
id: runbooks/payouts-provider-timeouts.md@v1
source: runbooks
type: runbook
title: "Payment provider timeouts"
url: https://runbooks.castlane.internal/payouts-provider-timeouts/v1
service: [payouts-worker]
alerts: [KubeJobFailed]
scope: payouts
allowed_groups: [eng]
author: nd
version: 1
effective_at: 2026-07-21
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2026-07-21T10:55:00Z
generated: true
---
# Payment provider timeouts

This runbook covers slow or failing payout batches in the `payouts` namespace, with focus on `payouts-worker`. The owner team is `payouts-eng`. The batch calls the payment provider during the monthly payout run. When calls take longer than 10 seconds, the batch gets slow. When more than 5 percent of calls fail, the batch stops itself.

## Alerts that link here

- `KubeJobFailed`

## Diagnosis

1. Confirm the alert and the failing job.

```bash
kubectl --context prod-us-east -n payouts get jobs
kubectl --context prod-us-east -n payouts get pods -l app=payouts-worker
kubectl --context prod-us-east -n payouts describe job payouts-worker
kubectl --context prod-us-east -n payouts logs job/payouts-worker --since=30m
```

Look for retries, request timeout messages, and the point where the batch stopped. If the job is still running, check whether it is making progress or sitting on repeated provider calls.

2. Check whether the provider is degraded.

Use the on-call tool to open the provider status page. If the page shows an active incident or partial outage, treat this as an external dependency problem.

```bash
ask-oncall "Open the payment provider status page and check for any current incident or degraded service"
```

If the provider is down or slow, do not change the batch timeout. The batch is designed to tolerate retryable failure and it is idempotent.

3. Confirm that the failure rate crossed the stop threshold.

```bash
kubectl --context prod-us-east -n payouts logs job/payouts-worker --since=30m | grep -E "timeout|failed|provider"
kubectl --context prod-us-east -n payouts get events --sort-by=.lastTimestamp | tail -n 20
```

You are looking for repeated timeouts above 10 seconds per call, or a failure rate over 5 percent. If only a small number of calls failed, the batch may still complete after a retry. If the batch stopped itself, the logs usually show the stop condition near the end.

4. Check whether the job is blocked on retries or stuck on one payout item.

```bash
kubectl --context prod-us-east -n payouts exec deploy/payouts-worker -- sh -c 'ps auxww'
kubectl --context prod-us-east -n payouts exec deploy/payouts-worker -- sh -c 'env | sort | grep -E "PAY|PAYOUT"'
```

Only use this if the pod is still running. The goal is to see whether the worker is active, retrying, or waiting on a single slow request. Do not lower the request timeout to force the batch through.

## Mitigation

If the provider is unhealthy, wait for recovery and rerun the batch. The run is idempotent, so rerunning is safe.

```bash
kubectl --context prod-us-east -n payouts delete job payouts-worker
kubectl --context prod-us-east -n payouts apply -f /tmp/payouts-worker-job.yaml
```

If the job is managed by a scheduled runner, use the normal trigger path instead of hand-editing the workload. The important part is to rerun after the provider has recovered.

If the provider is healthy but the job still fails due to a transient timeout spike, rerun once after a short wait.

```bash
sleep 600
kubectl --context prod-us-east -n payouts delete job payouts-worker
```

Do not raise the timeout limit or reduce the failure stop threshold. Those settings protect the batch from hanging too long on a bad dependency.

## Escalation

Escalate to `payouts-eng` if any of these are true:

- The provider status page shows a sustained outage longer than 15 minutes.
- Two reruns fail with the same timeout pattern after the provider reports recovery.
- The job stops itself again after passing the 5 percent failure threshold.
- You see unrelated worker crashes, pod restarts, or cluster issues in `payouts`.

Use `#oncall-payouts` for coordination and link the job name, start time, and the provider status page. If needed, open a ticket with prefix `PAY-` and include the command output from the failed run.

## Batch rules

| Rule | Expected value |
| --- | --- |
| Per-call timeout | 10 seconds or less |
| Stop condition | More than 5 percent failed calls |
| Recovery action | Wait, then rerun |
| Data safety | Idempotent rerun is safe |
| Timeout tuning | Do not lower it |

## History

- 2026-07-21, v1, first version for provider timeouts in `payouts-worker`.
- 2026-07-19, v0.2, added stop condition guidance and rerun steps after provider recovery.
- 2026-07-16, v0.1, drafted the initial timeout diagnosis flow.
