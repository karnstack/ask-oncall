// Replay Castlane's history into the index: build it as it stood at the first
// index (2026-05-04 02:00), then run the nightly job every night until --until,
// with events/timeline.jsonl deciding what existed when. The public docs are
// left alone. `npm run ingest` puts today back.
//   node tools/replay.ts --until 2026-10-21T02:00:00Z           (the fixed job: sync)
//   node tools/replay.ts --until 2026-10-21T02:00:00Z --naive   (the first job: upsert by position, never delete)
import { parseArgs } from "node:util";
import { chunkByHeadings } from "../src/chunk.ts";
import { castlaneAsOf, type Doc } from "../src/corpus.ts";
import { pool, toPg } from "../src/db.ts";
import { embed } from "../src/embed.ts";
import { bumpIndexVersion, documentHash, emptyStats, syncSources } from "../src/sync.ts";

const { values } = parseArgs({ options: { until: { type: "string", default: "2026-10-21T02:00:00Z" }, naive: { type: "boolean", default: false } } });
const FIRST = "2026-05-04T02:00:00Z";
const PUBLIC = `('k8s-docs', 'prom-runbooks')`;

// The job Castlane ran until INC-2276: re-read every source, upsert each
// chunk by its position, delete nothing. A deleted document makes no chunks,
// so nothing ever removes its rows.
async function naiveNight(docs: Doc[]) {
  const chunks = docs.flatMap((d) => chunkByHeadings(d).map((c) => ({ d, c })));
  const vectors = await embed(chunks.map(({ c }) => c.body), { stage: "embed:replay" });
  for (const [i, { d, c }] of chunks.entries()) {
    await pool.query(
      `insert into chunks (id, doc_id, n, title, url, body, embedding, start_char, end_char, source, type, version, is_current,
                           superseded_by, allowed_groups, scope, service, effective_at, updated_at, breadcrumb)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       on conflict (id) do update set body = excluded.body, embedding = excluded.embedding, is_current = excluded.is_current,
         superseded_by = excluded.superseded_by, updated_at = excluded.updated_at`,
      [c.id, c.docId, c.n, d.title, d.url, c.body, toPg(vectors[i]), c.start, c.end, d.source, d.meta.type, d.meta.version, d.meta.isCurrent,
       d.meta.supersededBy, d.meta.allowedGroups, d.meta.scope, d.meta.service, d.meta.effectiveAt, d.meta.updatedAt, c.breadcrumb],
    );
  }
  for (const d of docs)
    await pool.query(
      `insert into documents (id, source, title, url, content_hash, version, is_current, allowed_groups, scope, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (id) do update set is_current = excluded.is_current`,
      [d.id, d.source, d.title, d.url, documentHash(d), d.meta.version, d.meta.isCurrent, d.meta.allowedGroups, d.meta.scope, d.meta.updatedAt],
    );
}

const night = values.naive ? naiveNight : async (docs: Doc[]) => void (await syncSources(docs, emptyStats()));

await pool.query(`delete from chunks where source not in ${PUBLIC}`);
await pool.query(`delete from documents where source not in ${PUBLIC}`);
await night(castlaneAsOf(FIRST));
let last = castlaneAsOf(FIRST).map(documentHash).sort().join();
let nights = 0, changed = 0;
for (let t = Date.parse(FIRST) + 86_400_000; t <= Date.parse(values.until!); t += 86_400_000) {
  nights++;
  const docs = castlaneAsOf(new Date(t).toISOString());
  const signature = docs.map(documentHash).sort().join();
  if (signature === last) continue; // nothing changed in any source: the job would write the same rows
  last = signature;
  changed++;
  await night(docs);
}
await bumpIndexVersion();

const row = async (doc: string) => Number((await pool.query(`select count(*) n from chunks where doc_id = $1`, [doc])).rows[0].n);
const live = new Set(castlaneAsOf(values.until!).map((d) => d.id));
const all = (await pool.query(`select distinct doc_id from chunks where source not in ${PUBLIC}`)).rows.map((r) => r.doc_id as string);
console.log(`${values.naive ? "naive" : "sync"} job: replayed ${nights} nights to ${values.until} (${changed} with a change)`);
console.log(`Castlane rows ${Number((await pool.query(`select count(*) n from chunks where source not in ${PUBLIC}`)).rows[0].n)}; ` +
  `failover v2 rows ${await row("runbooks/postgres-failover.md@v2")}, wiki copy rows ${await row("wiki-export-2024/Postgres_Failover.md")}, ` +
  `failover v3 rows ${await row("runbooks/postgres-failover.md@v3")}; documents with rows that no longer exist ${all.filter((d) => !live.has(d)).length}`);
await pool.end();
