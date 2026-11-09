---
id: adr/ADR-0022-redis-sentinel.md
source: adr
type: adr
title: "ADR-0022: Redis Sentinel for redis-feeds"
url: https://git.castlane.internal/platform/adr/blob/main/ADR-0022-redis-sentinel.md
service: [redis-feeds]
allowed_groups: [eng]
author: gf
version: 1
effective_at: 2024-08-20
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2024-08-20T16:41:00Z
generated: true
---
# ADR-0022: Redis Sentinel for redis-feeds

Status: Accepted, Date 2024-08-20, Deciders: gf, mbe, zi

## Context

`redis-feeds` backs the transcode and feed-rebuild queues. It is not decorative. When it falls over, jobs stop moving and everybody learns new words in Slack.

Before this change we ran a single Redis instance. That was simple in the same way a chair with one leg is simple. It was also a single point of failure for both queues. A restart, node issue, or bad deploy meant queue traffic stopped. Recovery was manual and slow, which is a charming way to burn an on-call shift.

We need a setup that tolerates one Redis pod failing without making the queue layer disappear. We also need clients to find the current writer without hardcoding pod names or teaching every service how to play detective.

## Decision

Run `redis-feeds` as three Redis pods with three Sentinel pods.

Use Sentinel for leader discovery. Clients connect through Sentinel, ask for the current master, and then use that address for writes. Reads for the queue path follow the same pattern for simplicity. Services must not connect to a fixed pod IP or service endpoint for writes.

Operate the Redis pods with one master and two replicas. Sentinel quorum is set so that failover requires agreement from a majority of Sentinel instances. The goal is to prefer correctness over speed, because promoting the wrong node is just downtime with extra steps.

Operational settings:

- Three Redis pods in the `feeds` namespace
- Three Sentinel pods in the `feeds` namespace
- Client discovery through Sentinel only
- Automatic failover enabled
- No application code may assume a static Redis address
- Queue consumers and producers must reconnect on Sentinel role changes

This is deliberately boring. Boring infrastructure is good infrastructure.

## Consequences

Good:

- A single Redis pod failure no longer takes down `redis-feeds`
- Clients can follow failover without redeploying every service
- Queue availability improves without changing queue semantics
- Operational recovery is mostly automatic instead of deeply artisanal

Bad:

- More pods, more moving parts, more things to page humans about
- Failover is not instant, so brief queue disruption is still possible
- Sentinel adds another control plane to understand, which is unfortunate but still better than pretending one Redis pod is a strategy
- Client libraries need to handle reconnects properly, and some of them will do this badly on the first try

## Alternatives considered

### Single Redis instance

Rejected. It is the thing we already had, and it made the queue layer a hostage to one pod. Simplicity is not a virtue when it is standing on a fault line.

### Redis Cluster

Rejected. The queue workload needs multi-key operations, and Redis Cluster makes that awkward at best. We do not want to redesign queue semantics just to satisfy the topology. That is an excellent way to trade a solved problem for a new one.

### Primary with manual failover

Rejected. Manual failover is not a high availability plan, it is a wish written down for on-call. It also guarantees that the worst possible moment for a Redis failure will be the moment nobody wants to be the adult in the room.
