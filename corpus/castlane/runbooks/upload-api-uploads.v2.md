---
id: runbooks/upload-api-uploads.md@v2
source: runbooks
type: runbook
title: "upload-api: large uploads and 413 errors"
url: https://runbooks.castlane.internal/upload-api-uploads/v2
service: [upload-api]
allowed_groups: [eng, contractors]
author: lm
version: 2
effective_at: 2025-01-28
superseded_by: null
is_current: true
deleted_at: null
updated_at: 2025-01-28T11:06:00Z
generated: true
---
# upload-api: large uploads and 413 errors

`upload-api` handles creator media uploads in the `media` namespace. It accepts direct uploads up to 2 GiB, supports resumable multipart uploads using upload ids like `up_<id>`, and is owned by the media team. This runbook is for cases where uploads fail with HTTP 413, or where large uploads get stuck partway through and need to be resumed.

## Diagnosis

1. Confirm the error source and the response body. The ingress and the app both use HTTP 413, but they fail differently.

```bash
curl -i -X POST \
  "https://upload-api.castlane.internal/uploads" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @large-file.mp3
```

Look for these patterns:

- Ingress limit issue, body is usually plain text or the default ingress page, for example:
  ```text
  HTTP/1.1 413 Request Entity Too Large
  server: nginx
  content-type: text/html
  ```
- App limit issue, body is JSON from `upload-api`, for example:
  ```json
  {"error":"upload too large","max_bytes":2147483648}
  ```

2. Check whether the request is a multipart upload and whether the client is using resumable chunks of 64 MiB.

```bash
kubectl -n media get pods -l app=upload-api
kubectl -n media logs deploy/upload-api --since=30m | grep -E 'up_[a-zA-Z0-9]+' | tail -n 20
```

Expected multipart pattern:

- upload id looks like `up_7f3c2a91`
- chunks are 64 MiB each
- failed chunk retries should continue with the same upload id

3. Inspect the ingress annotation that controls request body size. If this is too small, the request can be rejected before it reaches the app.

```bash
kubectl -n media get ingress upload-api -o yaml | grep -n "proxy-body-size\|body-size"
```

You are looking for an annotation like:

```yaml
nginx.ingress.kubernetes.io/proxy-body-size: "2g"
```

If this is smaller than 2 GiB, the ingress can reject valid uploads.

4. Verify the app is not rejecting correctly sized uploads due to a rollout or config issue.

```bash
kubectl -n media rollout status deploy/upload-api
kubectl -n media describe deploy/upload-api | sed -n '1,220p'
kubectl -n media logs deploy/upload-api --since=15m | grep -E '413|upload too large|payload'
```

5. If the issue only affects resumed uploads, inspect the upload id state. A resumable upload should remain associated with the same `up_<id>` until completion or expiry.

```bash
upload-id="up_7f3c2a91"
kubectl -n media logs deploy/upload-api --since=1h | grep "$upload-id"
```

If the logs show missing chunk references, the client may be resuming with the wrong id or the upload state may have expired.

## Mitigation

1. If the ingress body size is too small, raise it to match the app limit of 2 GiB.

```bash
kubectl -n media annotate ingress upload-api \
  nginx.ingress.kubernetes.io/proxy-body-size=2g \
  --overwrite
```

Then recheck the ingress object and retry one known-good upload.

2. If the app is rejecting uploads larger than 2 GiB, confirm the client is not sending a single oversized request instead of multipart chunks. The correct client behavior is to split the file into 64 MiB chunks and continue the upload with the same `up_<id>`.

3. If only one tenant or one client version is failing, ask them to retry with a fresh resumable upload id. A bad local retry state can produce repeated 413s even when the server is healthy.

4. If the change was just deployed and the failures started immediately after, roll back `upload-api` with deploy-bot.

```text
/deploy rollback upload-api
```

Use this only if the ingress annotation is already correct and the app started rejecting valid requests after the rollout.

## FAQ

**Why do I sometimes see 413 from the ingress and sometimes from the app?**  
Because both layers can reject a request. Ingress rejects it before it reaches `upload-api`, and the response usually looks like the ingress controller's default error page. The app rejects it after the request gets through, and the body is JSON with an app error message.

**What is the maximum upload size?**  
2 GiB per upload.

**What chunk size should resumable uploads use?**  
64 MiB chunks. If a client uses larger chunks, it may trigger body limits or time out during retries.

**What does a valid resumable upload id look like?**  
It looks like `up_<id>`, for example `up_7f3c2a91`. The same id should be used for retries until the upload finishes.

## Escalation

If the ingress annotation is correct, the app is healthy, and valid 64 MiB chunked uploads still fail with app-level 413s, escalate to `#media` and open a `MEDIA-` ticket. Include:

- one example upload id
- the exact 413 response body
- the ingress annotation value
- the time window in UTC
- whether the client used resumable chunks

If you suspect a platform or cluster issue, notify `#platform` and mention the `media` namespace, then page the current media oncall through the normal rotation.

## History

- 2024-10-14, version 1. Documented the 2 GiB upload limit, resumable uploads with `up_<id>`, and the initial ingress body size check.
- 2024-12-03, version 1.1. Added the 64 MiB multipart chunk guidance and examples of ingress versus app 413 responses.
- 2025-01-28, version 2. Added the FAQ section and clarified the ingress annotation workflow for large uploads.
