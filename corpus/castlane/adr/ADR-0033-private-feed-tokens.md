---
id: adr/ADR-0033-private-feed-tokens.md
source: adr
type: adr
title: "ADR-0033: Private feed tokens in the URL"
url: https://git.castlane.internal/platform/adr/blob/main/ADR-0033-private-feed-tokens.md
service: [private-feeds]
allowed_groups: [eng]
author: ay
version: 1
effective_at: 2025-05-13
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-05-13T13:16:00Z
generated: true
---
# ADR-0033: Private feed tokens in the URL

Status: Accepted, Date 2025-05-13, Deciders: ay, tw, sec-lead

## Context

Castlane private feeds are consumed by podcast apps that make plain GET requests to fetch RSS. In practice, most apps cannot send custom headers, cannot complete OAuth flows, and do not reliably support interactive login for feed refreshes.

That leaves us with a simple delivery constraint, the subscriber credentials must travel in the feed URL itself if we want private feeds to work across the long tail of podcast apps.

This raises privacy and security concerns:

- URLs are frequently copied into chat, email, and support tickets.
- URLs can appear in reverse proxy, application, and CDN logs.
- A leaked URL can expose a subscriber’s private feed until it is revoked.

We want a design that is compatible with common podcast apps, but still gives us a reasonable security posture.

## Decision

We will encode a subscriber-specific token in each private feed URL served by `private-feeds`.

Concrete settings:

- Token prefix is `pft_`.
- Token body is 32 random characters generated with a CSPRNG.
- Each subscription gets its own token.
- Tokens are revocable per subscription, without affecting other subscribers on the same show.
- Token lookup happens server side, and the token is treated as a bearer secret.
- Token use is tied to the subscription record, not to a device or app.

Operational rules:

- Do redact `pft_` tokens from application logs, access logs, and error output.
- Do alert on suspicious token use patterns, especially one token seeing requests from many IPs in a short window.
- Do revoke and reissue the token if we confirm exposure or suspicious reuse.
- Do keep the token out of page bodies, RSS item content, and support replies unless explicitly needed for troubleshooting.

Do not:

- Do not place the token in query parameters that are echoed back by downstream systems without redaction.
- Do not rely on headers, cookies, or OAuth for private feed access.
- Do not treat token possession as proof of identity outside the feed service.

## Consequences

Good:

- Works with the widest range of podcast apps.
- Keeps the subscription model simple for users and support.
- Allows per-subscriber revocation if a token is shared or exposed.
- Gives us a clear control point for privacy enforcement in `private-feeds`.

Bad:

- URLs are still bearer secrets, so accidental sharing remains a real risk.
- Redaction must be correct everywhere, including logs, traces, and support tooling.
- Anomaly detection is heuristic, so it can miss slow abuse or flag legitimate travel patterns.
- Some users will paste their feed URL into places they should not, and we cannot prevent that fully.

## Alternatives considered

1. **HTTP headers for auth**
   - Why not: most podcast apps cannot set custom headers for RSS polling, so this would break compatibility for too many subscribers.

2. **OAuth or interactive login**
   - Why not: podcast apps generally do not support it well for feed refresh, and it adds support burden without improving compatibility enough.

3. **Short-lived signed URLs without per-subscriber revocation**
   - Why not: this makes sharing slightly less durable, but it complicates normal app behavior and does not give us a good recovery path when a single subscription leaks.
