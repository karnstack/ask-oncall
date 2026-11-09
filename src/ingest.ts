// The index path, the job that runs every night at 02:00:
//   npm run ingest
// Read every source, cut every document into chunks, embed them, and upsert
// each chunk by its position (doc_id::n).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chunkFixed, type Chunk } from "./chunk.ts";
import { loadCorpus, type Doc } from "./corpus.ts";
import { pool, toPg } from "./db.ts";
import { embed, type EmbedStats } from "./embed.ts";
import { spentSoFar } from "./ledger.ts";

const t0 = performance.now();
await pool.query(readFileSync(join(import.meta.dirname, "..", "sql", "001_schema.sql"), "utf8"));

const docs = loadCorpus();
const chunks = docs.flatMap((d) => chunkFixed(d).map((c) => ({ d, c })));
console.log(`${docs.length} documents, ${chunks.length} chunks`);
const stats: EmbedStats = { texts: 0, tokens: 0, usd: 0, ms: 0 };
const vectors = await embed(chunks.map(({ c }) => c.body), { stage: "embed:chunks", stats });
console.log(`embedded ${stats.tokens} tokens in ${(stats.ms / 1000).toFixed(1)} s, $${stats.usd.toFixed(5)}`);

const columns = ["id", "doc_id", "n", "title", "url", "body", "embedding", "start_char", "end_char"];
const rowOf = (d: Doc, c: Chunk, v: Float32Array) => [c.id, c.docId, c.n, d.title, d.url, c.body, toPg(v), c.start, c.end];
const updates = columns.slice(1).map((c) => `${c} = excluded.${c}`).join(", ");
for (let i = 0; i < chunks.length; i += 100) {
  const rows = chunks.slice(i, i + 100).map(({ d, c }, j) => rowOf(d, c, vectors[i + j]));
  const values = rows.map((_, r) => `(${columns.map((_, k) => `$${r * columns.length + k + 1}`).join(",")})`);
  await pool.query(`insert into chunks (${columns}) values ${values.join(",")} on conflict (id) do update set ${updates}`, rows.flat());
}

const { rows } = await pool.query(`select count(*)::int as chunks, pg_size_pretty(pg_total_relation_size('chunks')) as size from chunks`);
console.log(`index: ${rows[0].chunks} chunks, ${rows[0].size}; ${((performance.now() - t0) / 1000).toFixed(1)} s; ledger total $${spentSoFar().toFixed(4)}`);
await pool.end();
