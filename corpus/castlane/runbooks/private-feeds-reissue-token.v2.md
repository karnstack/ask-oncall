---
id: runbooks/private-feeds-reissue-token.md@v2
source: runbooks
type: runbook
title: "Private feeds: reissue a subscriber's token"
url: https://runbooks.castlane.internal/private-feeds-reissue-token/v2
service: [private-feeds]
allowed_groups: [eng, contractors]
author: ay
version: 2
effective_at: 2025-05-20
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-05-20T12:09:00Z
generated: true
---
# Private feeds: reissue a subscriber's token

Private feeds in Castlane use a per-subscriber token with the prefix `pft_` because podcast apps cannot send headers, per ADR-0033. This runbook covers reissuing one subscription token in the `private-feeds` service in the `feeds` namespace. The owner team is `ay` in private-feeds.

Use this when creator support asks for a token reset because a private feed link was shared publicly, forwarded outside the intended audience, or appears in a place it should not. Treat the subscription id as the only safe identifier in Slack, tickets, and incident channels.

## Diagnosis

1. Confirm that this is a private feed issue, not a generic feed outage.

```bash
kubectl -n feeds get pods
kubectl -n feeds logs deploy/private-feeds --since=30m | tail -n 80
```

2. Get the subscription id from the support request. Do not ask for or paste the token. If the request only includes a feed URL, strip it down to the subscription id before moving forward.

```bash
private-feeds lookup --url "https://feeds.castlane.example/private/..."
```

If lookup is unavailable, ask the requester for the subscription id directly and continue from that.

3. Check whether the subscriber is active and whether the token format is the expected private-feed token.

```bash
private-feeds inspect --subscription <sub_id>
```

Look for:
- an active subscription state
- a current token beginning with `pft_`
- a recent last-access timestamp if you are validating a report of public sharing

4. If you need to confirm there is a valid current token without exposing it, use the service view only.

```bash
private-feeds token-status --subscription <sub_id>
```

Do not copy token output into Slack or a ticket. Do not screenshot it. Do not ask the creator to paste it back.

## Mitigation

1. Reissue the token for exactly one subscription.

```bash
private-feeds reissue-token --subscription <sub_id> --notify
```

The `--notify` flag sends the replacement link through the normal subscriber notification path. This is the preferred path because it avoids manual handling of the token.

2. Verify that the old token no longer works and that the new one is active.

```bash
private-feeds inspect --subscription <sub_id>
private-feeds test-link --subscription <sub_id>
```

3. Tell support only that the subscription token was reissued. Use the subscription id, not the token.

Suggested Slack update:

```text
Reissued private feed token for subscription <sub_id>. Do not share the old link. New access was sent through the normal notification path.
```

Do:
- use the subscription id in all human communication
- keep the action limited to one subscription
- confirm the old token is no longer accepted

Do not:
- paste any `pft_` token in Slack, tickets, or incident notes
- include the full private feed URL in a public channel
- reissue more than one subscription unless support explicitly provides the additional ids
- change unrelated feed settings while doing this work

## Escalation

Escalate to `ay` in `#oncall` or `#private-feeds` if:
- `private-feeds reissue-token` fails
- the subscription cannot be found
- the account state looks inconsistent
- you suspect the token was exposed in a wider privacy incident

If the issue might involve a broader leak pattern, page `sec-ir` and open a `SEC-` ticket. If you need service health context, check `feed-builder` and `private-feeds` pods, but keep the reissue scoped to the one subscription.

```bash
kubectl -n feeds get deploy private-feeds
kubectl -n feeds describe pod -l app=private-feeds
```

If the service is degraded, capture the failure and escalate without trying to work around the privacy controls manually.

## History

- 2025-04-03, version 1: initial private-feeds token reissue steps added for subscriber support cases.
- 2025-05-12, version 2: clarified that podcast apps cannot send headers and that reissue must use the subscription id only.
- 2025-05-20, version 2: added explicit `private-feeds reissue-token --subscription <sub_id> --notify` command and privacy handling guidance.
