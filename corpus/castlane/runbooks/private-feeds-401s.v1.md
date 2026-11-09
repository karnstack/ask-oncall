---
id: runbooks/private-feeds-401s.md@v1
source: runbooks
type: runbook
title: "private-feeds 401 spike"
url: https://runbooks.castlane.internal/private-feeds-401s/v1
service: [private-feeds, cdn-edge]
allowed_groups: [eng, contractors]
author: ay
version: 1
effective_at: 2025-06-24
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-06-24T11:06:00Z
generated: true
---
# private-feeds 401 spike

This runbook covers a sudden rise in HTTP 401s on private feed URLs. It applies to the `private-feeds` service in the `feeds` namespace, with `cdn-edge` sometimes involved when cached responses or token checks are stale at the edge. The owner team is `feeds`, and the goal is to restore access without weakening auth or exposing subscriber privacy.

## Diagnosis

1. Confirm the spike is real and identify the failing reason.

   Check the `private_feeds_auth_failures_total` metric by reason in Grafana, then compare it with request volume and 401s over the same window.

   ```bash
   kubectl --context prod-eu-west -n feeds get deploy private-feeds
   ```

   In Grafana, look for these reasons first:
   - `subscription_inactive`
   - `allowlist_cache_stale`
   - `token_invalid`

   A sharp rise in `subscription_inactive` usually means the subscription sync job is behind, so renewals have not been applied yet. A rise in `allowlist_cache_stale` points to cached authorization data expiring or lagging. A mixed spike can happen when a creator revokes many subscriptions at once, which is normal and should not be treated as a security incident by itself.

2. Check whether the subscription sync path is lagging.

   ```bash
   kubectl --context prod-us-east -n feeds get pods -l app=private-feeds
   kubectl --context prod-us-east -n feeds logs deploy/private-feeds --since=30m | grep -E 'sync|renewal|allowlist|401'
   ```

   If logs show delayed renewal application or repeated sync retries, this is likely the cause. Do not disable auth. Do not bypass subscriber checks.

3. Verify whether the allow-list cache is stale.

   The allow-list cache TTL is 5 minutes, so brief inconsistencies can happen after a burst of subscription changes.

   ```bash
   kubectl --context prod-us-east -n feeds logs deploy/private-feeds --since=15m | grep -E 'cache|ttl|allowlist'
   ```

   If the spike lasts longer than one TTL window and the cache has not refreshed, treat it as a stale cache issue, not a customer data loss issue. Privacy is still preserved because the service should fail closed.

4. Check for a creator-driven mass revocation pattern.

   A creator revoking many subscriptions at once is expected behavior. This can produce a short-lived burst of 401s as revoked tokens are rejected.

   ```bash
   psql "postgresql://pg-feeds/feeds" -c "
   select date_trunc('minute', created_at) as minute,
          count(*) as revocations
   from subscription_events
   where event_type = 'revoked'
     and created_at > now() - interval '2 hours'
   group by 1
   order by 1 desc
   limit 20;"
   ```

   If revocations line up with the 401 spike, the service is working as intended.

5. Check edge behaviour if the 401s are concentrated on one region or path.

   ```bash
   kubectl --context prod-eu-west -n edge logs deploy/cdn-edge --since=20m | grep -E '401|private-feeds|auth'
   ```

   If `cdn-edge` is serving stale authorization-related responses, the problem may be edge cache propagation rather than core auth.

## Mitigation

1. If the subscription sync job is behind, clear the backlog first and let renewal state catch up.

   - Confirm the job is running.
   - Watch `private_feeds_auth_failures_total{reason="subscription_inactive"}` for a downward trend.
   - Do not change auth rules to suppress the symptom.

2. If the allow-list cache is stale, let it expire or refresh it through the normal service path.

   - Wait at least 5 minutes before assuming the cache is stuck.
   - If the issue persists beyond one TTL window, restart only the `private-feeds` deployment after confirming the sync path is healthy.

   ```bash
   kubectl --context prod-us-east -n feeds rollout restart deploy/private-feeds
   kubectl --context prod-us-east -n feeds rollout status deploy/private-feeds
   ```

3. If the spike matches a creator revoking many subscriptions, do not intervene unless there is a separate customer support request.

   This is normal, and the expected response is a higher 401 rate for those revoked URLs. Keep monitoring to confirm the spike tails off.

4. If the edge is caching bad state, purge only the affected private feed URLs or paths.

   ```bash
   edgectl purge --path "/private-feeds/*" --reason "401 spike investigation, stale auth-related edge cache"
   ```

   Be careful to scope purges narrowly. Do not purge broadly without confirmation, because that creates unnecessary load and can impact unrelated feeds.

## Escalation

- Escalate to `feeds` if `private_feeds_auth_failures_total{reason="subscription_inactive"}` stays elevated for more than 15 minutes after sync recovers.
- Escalate to `edge` if only `prod-eu-west` is affected and logs show repeated stale auth decisions at `cdn-edge`.
- Escalate to `platform` if the subscription sync job is not running or the service shows repeated pod restarts.
- If there is any sign of unauthorized access or unexpected token acceptance, page `sec-ir` and open a `SEC-` ticket immediately.

When escalating, include:
- the metric breakdown by reason,
- the start time of the spike,
- whether it matches a renewal batch or a mass revocation,
- whether the issue is isolated to one region.

## Do and do not

**Do**
- Keep auth enabled.
- Prefer closed failures over temporary access broadening.
- Use short, scoped purges and restarts.
- Treat subscriber data as private unless a revocation event clearly explains the spike.

**Do not**
- Do not disable authorization checks.
- Do not widen allow-lists to reduce 401s.
- Do not assume every 401 spike is an outage.
- Do not expose token values in tickets, logs, or Slack.

## History

- 2025-06-24, v1: Initial runbook for 401 spikes on private feed URLs, with sync lag, cache staleness, and mass revocation cases.
- 2025-06-24, v1: Added metric guidance for `private_feeds_auth_failures_total` by reason and scoped edge mitigation.
- 2025-06-24, v1: Clarified that auth must remain enabled and that privacy-preserving fail-closed behaviour is expected.
