---
id: wiki-export-2024/Redis_Notes.md
source: wiki-export-2024
type: wiki
title: "Redis Notes"
url: https://wiki.castlane.internal/display/ENG/Redis+Notes
service: [redis-feeds]
allowed_groups: [eng]
author: gf
version: 1
effective_at: 2024-06-18
superseded_by: null
is_current: true   # frozen on 2024-09-30 with the rest of the export
deleted_at: null
exported_at: 2024-09-30T12:00:00Z
updated_at: 2024-06-18T12:17:00Z
generated: true
---
# Redis Notes

Engineering / Feeds / Redis Notes

Created by gf, last modified on Jun 18, 2024 (version 7)

Redis for feeds is simple, which is nice. One pod. No ceremony. No drama, unless it is down, in which case the drama is already happening elsewhere.

The instance is `redis-feeds`. It backs the `transcode` and `feed-rebuild` queues.

To check queue lengths:

```bash
redis-cli -h redis-feeds -p 6379 LLEN transcode
redis-cli -h redis-feeds -p 6379 LLEN feed-rebuild
```

If you want both at once, use `redis-cli` and do not get clever. This is not the place for a script that prints colours.

Useful checks:

```bash
kubectl -n media get pod -l app=redis-feeds
kubectl -n media logs deploy/redis-feeds
```

There should be exactly one Redis pod. If there are two, somebody has already made the situation worse.

`maxmemory` is 8gb. Do not increase it because the graphs look sad. That way lies confidence, then eviction, then questions in Slack at 02:00.

If it falls over, just restart it.

Seriously.

Do not spend half an hour trying to negotiate with Redis. If it is wedged, bounce the pod and move on. The queues will drain again once the workers notice the world is real.

If queue length is climbing and the pod is healthy, check the transcoders first. Redis is usually just the messenger with unfortunate timing.

Do not flush keys. Do not delete random lists. Do not "test" recovery on prod because you are curious. Curiosity belongs in staging and coffee.

Notes:

- `transcode` is the noisy queue.
- `feed-rebuild` is the patient queue.
- Pod restarts are normal enough to be boring.

Labels: redis, feeds, queues, ops

Comments (2)

- ok: "This has aged well in the worst possible way."
- tw: "Confirmed, restarting still fixes most feelings."
