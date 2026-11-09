---
id: runbooks/ask-oncall-indexer.md@v1
source: runbooks
type: runbook
title: "ask-oncall-indexer"
url: https://runbooks.castlane.internal/ask-oncall-indexer/v1
service: [ask-oncall]
alerts: [KubeJobFailed]
allowed_groups: [eng, contractors]
author: dara
version: 1
effective_at: 2026-05-04
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2026-05-04T11:06:00Z
generated: true
---
# ask-oncall-indexer

`ask-oncall-indexer` is the CronJob that refreshes the knowledge index used by `#ask-oncall`. It runs in the `platform` namespace, is owned by the platform team, and should finish every day at 02:00 UTC so the bot sees the latest operational sources. If it fails, `ask-oncall` keeps answering from the previous night’s index, which can make it miss newly filed runbooks or postmortems.

## Alerts that link here

- `KubeJobFailed`

## Diagnosis

1. Confirm the CronJob schedule and recent job status. This tells you whether the failure was a one-off job run or a broader scheduling problem.

   ```bash
   kubectl -n platform get cronjob ask-oncall-indexer -o wide
   kubectl -n platform get jobs --sort-by=.metadata.creationTimestamp | tail -n 10
   kubectl -n platform describe cronjob ask-oncall-indexer
   ```

2. Check the failed Job and its Pod events. The indexer usually fails for source fetch problems, API timeouts, or a bad input file, and the Pod events usually show which part stopped first.

   ```bash
   kubectl -n platform get pods -l job-name=<job-name>
   kubectl -n platform describe job <job-name>
   kubectl -n platform describe pod <pod-name>
   kubectl -n platform logs <pod-name> --all-containers=true
   ```

3. Verify whether the upstream sources are reachable and present. The indexer re-reads the runbooks registry, postmortems, ADRs, the handbook, Slack incident channels, wiki-export-2024, and the vendored Kubernetes, prometheus-operator runbook, and Postgres docs, so missing inputs or auth problems can stop the rebuild.

   ```bash
   kubectl -n platform exec deploy/ask-oncall -- sh -lc 'ls -lah /data/indexer && env | sort | grep -E "INDEX|WIKI|SLACK|POSTMORTEM|RUNBOOK"'
   kubectl -n platform exec deploy/ask-oncall -- sh -lc 'curl -fsS https://wiki.castlane.internal/export/wiki-export-2024 >/tmp/wiki-export-2024.json && test -s /tmp/wiki-export-2024.json'
   kubectl -n platform exec deploy/ask-oncall -- sh -lc 'test -d /opt/vendor/kubernetes && test -d /opt/vendor/prometheus-operator && test -d /opt/vendor/postgres'
   ```

4. Check the bot’s read path after the last successful run. If the index files did not update, `#ask-oncall` will still answer from the previous snapshot even when the bot itself is healthy.

   ```bash
   kubectl -n platform exec deploy/ask-oncall -- sh -lc 'stat -c "%y %n" /data/indexer/current /data/indexer/last-successful 2>/dev/null || true'
   kubectl -n platform logs deploy/ask-oncall --since=24h | grep -i indexer
   ```

5. If you need more detail on the Job failure reason, pull the Kubernetes events around the failure window. This is useful when the Pod log is empty or the container exits too early.

   ```bash
   kubectl -n platform get events --sort-by=.lastTimestamp | tail -n 30
   ```

## Mitigation

If the indexer failed and the cause is not a cluster-wide issue, rerun it manually. Use a one-off Job from the CronJob template, then wait about 6 minutes for the rebuild to complete.

```bash
kubectl -n platform create job ask-oncall-indexer-manual-$(date +%s) --from=cronjob/ask-oncall-indexer
```

Watch the Job until it completes, then confirm that the bot picked up the new index snapshot.

```bash
kubectl -n platform get jobs --watch
kubectl -n platform logs job/<manual-job-name> --all-containers=true --follow
```

If the manual run succeeds, no further action is usually needed. If the failure repeats, pause and investigate the source that failed, because repeated reruns without a fixed input usually just recreate the same broken index.

## Escalation

Escalate to `#platform` if the CronJob is failing due to permissions, image pull, or a missing mounted input path. Escalate to the source-owning team if the failure is isolated to one content source, for example the runbooks registry, postmortems, or the handbook export. If the Pod will not schedule or the node itself looks unhealthy, involve the on-call platform engineer first, then raise a broader infrastructure ticket.

Useful handoff details:

- the failed Job name and Pod name
- the time of the failed run
- the last successful indexer run
- the first error line from the Pod logs
- whether a manual rerun completed

## Settings

| Item | Value |
| --- | --- |
| Namespace | `platform` |
| Cron schedule | `0 2 * * *` |
| Owner | `dara` |
| Typical runtime | about 6 minutes |
| Purpose | re-read every source for `#ask-oncall` and refresh the bot index |

## History

- 2026-05-04, version 1, initial runbook for `ask-oncall-indexer`, including schedule, source list, rerun command, and escalation path.
