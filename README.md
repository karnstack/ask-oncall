# ask-oncall

Castlane's `#ask-oncall`: an assistant that answers the on-call rotation's
questions from runbooks, postmortems, incident Slack threads, a frozen wiki
export, and vendored Kubernetes docs and alert runbooks. It always cites its
sources, says "Not found in Castlane's docs" when the sources do not answer,
and never runs a command.

Castlane is a fictional podcast-hosting company. Its 120 documents are
invented; the rest of the corpus is real, open-licensed documentation. The
corpus changes the way real ones do: a runbook is deleted while a copy
survives in the wiki export, a fix lands in Slack before anyone updates the
runbook, two versions of one runbook are both published, and some
postmortems are for the security team only.

This is the companion code for the course "RAG That Holds Up in Production"
on karnstack.com. Every lesson is a tag: `lesson-01` is the whole pipeline
built once, the naive way, and each later tag is the previous one plus that
lesson's change, so `git diff lesson-15 lesson-16` is exactly what lesson 16
builds.

TypeScript on Node 24 (it runs `.ts` files directly; there is no build step),
Postgres 18 with pgvector 0.8.7 in Docker, the official `openai` SDK, and
`pg`. No framework.

## Quick start

You need Node 24.14 or later, Docker, and an OpenAI API key.

```sh
git checkout lesson-29          # or any lesson-NN
npm install
cp .env.example .env            # put your OPENAI_API_KEY in it
npm run db:up                   # Postgres 18 + pgvector, on 127.0.0.1:55434
npm run ingest                  # about 5 cents the first time
npm run ask -- "KubePodCrashLooping fired for transcoder. What do I check first?" --as tw
npm run ask -- "why were creator payouts late on Tuesday?" --as ext-rb
npm run ask -- "What is the default value of the kubelet --max-pod-burst flag?" --as tw
```

`--as` takes a handle from `identity.json` (`tw` is an engineer, `ext-rb` a
contractor, `jh` a payouts engineer, `sec-lead` the security lead); it
arrives at `lesson-23`, so drop it on earlier tags. `npm run serve` starts
the same pipeline over HTTP (`POST /ask`, and from `lesson-19` the Slack
events webhook).

When you move to a tag that changes `sql/001_schema.sql`, rebuild the index:

```sh
npm run db:reset && npm run ingest
```

From `lesson-16` on, embeddings are cached by a hash of their text in
`.cache/`, so a rebuild only pays for text it has never embedded.

Other commands, each from the lesson that adds it:

```sh
npm run score -- --set written --leg hybrid --save hybrid     # lesson-03 on: recall at k, MRR
npm run score -- --set written,generated --leg rerank --against hybrid
npm run score -- --set castlane --leg rerank                  # the Castlane row, under each asker
npm run story-checks                                          # lesson-16 on: pass or fail
node tools/replay.ts --until 2026-10-21T02:00:00Z --naive     # lesson-16 on: replay Castlane's history
npm run migrate -- add | backfill | score | drop              # lesson-20 on: a model trial
npm test && npm run typecheck                                 # no network, no database
```

## What it costs

Measured in November 2026 with the prices in `src/config.ts` (checked
2026-11-08; check them again before you trust a bill). Every API call is
priced and appended to `.cache/ledger.jsonl`, and a step that would take the
total past `BUDGET_USD` (5 dollars by default, in `.env`) refuses to start.

| What | Tokens | Cost |
|---|---|---|
| Full ingest, fixed 512/64 chunks (`lesson-01` to `lesson-06`): 1,735 documents, 6,177 chunks | 2,638,641 | $0.053 |
| Full ingest, heading-aware chunks (`lesson-07` on): 9,664 chunks | 2,492,284 | $0.050 |
| One question at `lesson-01` (top 5, one answer) | about 2,300 in, 150 out | about a quarter of a cent |
| One question at `lesson-29` (rerank 25 candidates, answer from 5) | about 4,300 + 2,000 in | about half a cent |
| Scoring the written and Castlane questions with the reranker | 59 rerank calls | about 20 cents |
| Model context for Castlane's 553 chunks (`tools/contextualize.ts`, optional) | | about 4 cents |

## Lessons

| Tag | Lesson | What the tag adds |
|---|---|---|
| `lesson-01` | One question, answered with sources | the whole pipeline once: fixed 512/64 chunks, embeddings in Postgres, top 5 by cosine, an answer with numbered sources, every call priced |
| `lesson-02` | What a vector holds | experiments/02-scores.ts: cosine by hand, and why no score cut separates real questions from unanswerable ones |
| `lesson-03` | A question set you can rerun | tools/score.ts: the 56 public questions and the Castlane row, recall at k, MRR, moved up and moved down |
| `lesson-04` | When the question set lies | the 200 generated questions and the two-set rule |
| `lesson-05` | Does it fit in the prompt? | tools/count-tokens.ts: the corpus against the answer model's window |
| `lesson-06` | Do you still need an index? | experiments/06-grep.ts: plain grep scored on the same questions |
| `lesson-07` | Where the cut falls | heading-aware chunks with breadcrumbs, and recall within a 2,000-token budget |
| `lesson-08` | What the parser kept | Castlane's front matter kept as columns on every chunk |
| `lesson-09` | The words that must match | word search: a generated tsvector, a GIN index, the OR query ranked by ts_rank |
| `lesson-10` | Two rankings, one list | reciprocal rank fusion (k = 60) of the two legs; sql/hybrid.sql as one statement |
| `lesson-11` | Is Postgres word search BM25? | experiments/11-bm25.ts: textbook BM25 in memory beside ts_rank |
| `lesson-12` | A second, slower look | the listwise reranker over the fused top 50 |
| `lesson-13` | A reranker that made it worse | RERANK_CANDIDATES = 25 |
| `lesson-14` | Context the chunk lost | a breadcrumb column for citations; optional model-written context on the word leg only (the split design) |
| `lesson-15` | What the engineer actually typed | rewrite a follow-up in a thread into one standalone question; a service named in the question as a filter |
| `lesson-16` | Deleted, but still answering | a documents table, per-document hashes, replace in one transaction, tombstones, an embedding cache keyed by text hash, tools/replay.ts, story checks |
| `lesson-17` | The copy the delete missed | near-copies of deleted documents tombstoned too (word 5-grams, Jaccard); a reconcile bound that refuses empty or half-empty listings |
| `lesson-18` | Two versions, one right answer | is_current as a filter, version and age in every citation, the Castlane row scored current only |
| `lesson-19` | The fix is in Slack | Slack events into the index with a 60-second debounce per channel day; a signed webhook |
| `lesson-20` | Changing the embedding model | src/migrate.ts: a shadow column, a backfill, both question sets scored side by side |
| `lesson-21` | Inside the vector index | an HNSW index, ef_search, and tools/hnsw-recall.ts against exact search |
| `lesson-22` | What the index costs in memory | tools/smaller-vectors.ts: the 2,000-dimension limit, halfvec, binary vectors with a rescore |
| `lesson-23` | Who may read this chunk | principals, allowed_groups on every chunk, the permission filter inside both legs |
| `lesson-24` | A cache that knows who asked | a cache key with the asker's principals and the index version; an index version bumped by every sync |
| `lesson-25` | The filter that left one source | flags on the chunk row, iterative HNSW scans, a B-tree on scope, the smallest user's story check |
| `lesson-26` | An answer that shows its work | the house prompt, and citation, quote and link checks in code |
| `lesson-27` | Saying "not found" | the fixed not-found sentence, detected in code, and the guard for a reranker that keeps nothing |
| `lesson-28` | Fast enough at 3 a.m. | the two legs in parallel with Promise.all |
| `lesson-29` | One log line per question | one log line per question, and index age per source |

## Layout

```text
corpus/              the documents (see "Corpus and licences")
questions/           public.json (56), near-miss.json (9), castlane.json (14), generated.json (200)
events/timeline.jsonl  Castlane's history, replayable (lesson-16 on)
identity.json        handles and groups, the identity source (lesson-23 on)
sql/001_schema.sql   the index; sql/hybrid.sql is hybrid search as one statement
src/                 the pipeline: ingest.ts (index path), ask.ts (question path), server.ts
tools/               score.ts, story-checks.ts, replay.ts and the other measurement tools
experiments/         one script per comparison a lesson shows
test/                node --test, pure logic only
```

## Corpus and licences

| Folder | What | Licence |
|---|---|---|
| `corpus/k8s-docs/` | Kubernetes documentation, `content/en/docs` at kubernetes/website commit 0449ba43 (the v1.37 docs), Markdown only, without the two generated reference folders | CC BY 4.0, copyright The Kubernetes Authors |
| `corpus/k8s-release-1.33/` | 11 pages from the release-1.33 branch, for showing a stale index | CC BY 4.0, copyright The Kubernetes Authors |
| `corpus/prom-runbooks/` | prometheus-operator alert runbooks at commit a685d14, 108 runbooks | Apache-2.0 (licence kept in the folder) |
| `corpus/castlane/` | Castlane's 120 invented documents | CC BY 4.0 |

Kubernetes Documentation, copyright The Kubernetes Authors, licensed CC BY
4.0, from kubernetes/website at commit 0449ba43. The vendored files are
unmodified; the loader strips front matter and renders Hugo shortcodes at
load time. `NOTICE` has the full attributions. The code is MIT (`LICENSE`).
