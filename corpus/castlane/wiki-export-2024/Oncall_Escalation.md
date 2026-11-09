---
id: wiki-export-2024/Oncall_Escalation.md
source: wiki-export-2024
type: wiki
title: "Oncall Escalation"
url: https://wiki.castlane.internal/display/ENG/Oncall+Escalation
service: [platform]
allowed_groups: [eng]
author: rs
version: 1
effective_at: 2024-03-05
superseded_by: null
is_current: true   # frozen on 2024-09-30 with the rest of the export
deleted_at: null
exported_at: 2024-09-30T12:00:00Z
updated_at: 2024-03-05T10:59:00Z
generated: true
---
# Oncall Escalation

Engineering / Platform / Oncall Escalation

Created by rs, last modified on Mar 05, 2024 (version 7)

Use this page when an alert fires and you need a human fast. Start with the dashboard, then check the owning team, then page the next escalation if the first responder does not ack within 10 minutes.

Dashboard: https://grafana.castlane.internal/d/platform-oncall

## Triage checklist

1. Open the alert in Alertmanager.
2. Check current service health on the dashboard above.
3. Confirm whether the problem is one of the Castlane alerts or a kube alert.
4. If the alert is noisy, add context in `#oncall` and keep investigating.
5. If there is customer impact, page the listed primary directly in Slack.

Useful PromQL:
- `sum by (service) (rate(http_requests_total{status=~"5.."}[5m]))`
- `max_over_time(kube_pod_container_status_restarts_total[15m])`
- `sum(redis_queue_depth{queue=~"transcode|feed-rebuild"})`

## 2024 escalation list

### Platform
Primary: dara  
Secondary: ne  
Escalate to: ext-rb

### Media
Primary: lm  
Secondary: vi  
Escalate to: pk

### Feeds
Primary: zi  
Secondary: tw  
Escalate to: hq

### Edge
Primary: yu  
Secondary: bo  
Escalate to: gf

### Payouts
Primary: jh  
Secondary: nd  
Escalate to: main rotation in `#oncall-payouts`

### Security
Primary: sec-lead  
Secondary: sec-ir  
Escalate to: security group

## Database ownership

For Postgres incidents, page the db VMs owner first. If the issue touches feed serving or payouts data paths, include mbe in the thread so the right cluster can be checked quickly.

## Notes

- If a pod crash loops on a single node, check `KubePodCrashLooping` and `KubeNodeNotReady`.
- If a queue backs up, watch `TranscodeQueueBacklog` or `FeedBuildLagHigh`.
- If a payout batch is late, use `PayoutBatchLate` and page the main rotation right away.

Labels: oncall, escalation, platform, alerting

Comments (2)

- tw: keeping this handy for feed rebuilds, the dashboard link is the fastest way in.
- jh: for payout pages, please go straight to `#oncall-payouts` and tag the main rotation.
