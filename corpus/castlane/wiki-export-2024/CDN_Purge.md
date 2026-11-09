---
id: wiki-export-2024/CDN_Purge.md
source: wiki-export-2024
type: wiki
title: "CDN Purge"
url: https://wiki.castlane.internal/display/ENG/CDN+Purge
service: [cdn-edge]
allowed_groups: [eng]
author: bo
version: 1
effective_at: 2024-02-12
superseded_by: null
is_current: true   # frozen on 2024-09-30 with the rest of the export
deleted_at: null
exported_at: 2024-09-30T12:00:00Z
updated_at: 2024-02-12T10:03:00Z
generated: true
---
# CDN Purge

Engineering / Edge / CDN Purge

Created by bo, last modified on Feb 12, 2024 (version 7)

Use this when a feed or audio object needs to be removed from the CDN cache before normal expiry. The purge path is handled by `cdn-edge`, and we usually only need this for bad feed generations, bad encodes, or metadata fixes that must show up faster than the cache TTL.

## Current cache targets

| Path type | Cache TTL |
| --- | --- |
| Feed XML | 300 s |
| Audio files | 86400 s |
| Images | 3600 s |

Feed cache hit ratio is normally high enough that we do not want to lower TTL just for convenience. Purge the specific URL instead.

## Purge procedure

1. Get the purge API key from the `cdn-purge-api-key` Secret in namespace edge.
   - Secret path: `kv/cdn-edge/purge-api-key`
2. Identify the exact URL that needs to be cleared.
   - For feeds, use the canonical RSS URL.
   - For audio, use the full object URL behind the CDN.
3. Run the purge request from a shell in a trusted network location.

Example:

```bash
API_KEY="$(kubectl -n edge get secret cdn-purge-api-key -o jsonpath='{.data.key}' | base64 -d)"

curl -sS -X POST "https://cdn-edge.internal/purge" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://cdn.castlane.com/shows/123/feed.xml"
    ]
  }'
```

For multiple objects, pass a JSON array of URLs. Keep the request narrow. Broad purges are expensive and can drop the hit ratio for a large slice of traffic.

## After the purge

- Confirm the object is returning the new version.
- Check Grafana for the edge cache hit ratio on the purge window.
- If the feed still serves stale content after a few minutes, check whether the origin changed and whether the object was re-cached correctly.

## Notes

- Purges are not a substitute for fixing bad publish logic.
- If the bad content is in a feed, also verify the upstream feed builder output before closing the loop.
- For repeated issues on the same path, collect the URL pattern and send it to #edge.

Labels: edge, cdn, purge, cache

Comments (2)

- ay: This should stay on the shortest path possible, broad invalidations hurt us more than people expect.
- lm: We should add an example for feed XML with queryless canonical URLs.
