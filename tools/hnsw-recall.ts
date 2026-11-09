// How much of the true top 10 does HNSW return? For each ef_search, run every
// question through the index and compare its top 10 with exact search (the
// same query with index scans off, so Postgres reads every row and sorts).
// The questions are the lab's 256: the 56 public questions (48 written, 8 with
// no answer) and the 200 generated ones.
//   node tools/hnsw-recall.ts
//
// It vacuums chunks first. A deleted or replaced row stays in the HNSW graph
// until a vacuum (tools/replay.ts rewrites Castlane's rows on every night it
// replays), and each dead entry uses up one of the ef_search slots without
// coming back as a row. With 13,794 dead entries left by two replays,
// ef_search 10 found 0.884 of the true top 10; after a vacuum, 0.918.
//
// HNSW builds are random, so recall at a small ef_search moves by a point or
// two between builds of the same rows.
import { pool, toPg } from "../src/db.ts";
import { embed } from "../src/embed.ts";
import { loadQuestions } from "./score.ts";

const EF_SEARCH = [10, 20, 40, 64, 100, 200, 400];
const questions = [...loadQuestions("written"), ...loadQuestions("unanswerable"), ...loadQuestions("generated")];
const vectors = await embed(questions.map((q) => q.q), { stage: "embed:question" });

const dead = (await pool.query(`select n_dead_tup::int as n from pg_stat_user_tables where relname = 'chunks'`)).rows[0]?.n ?? 0;
await pool.query(`vacuum (analyze) chunks`);
const client = await pool.connect();

async function top10(vec: Float32Array, settings: string[]) {
  await client.query("begin");
  for (const s of settings) await client.query(`set local ${s}`);
  const t0 = performance.now();
  const { rows } = await client.query(`select id from chunks order by embedding <=> $1::vector limit 10`, [toPg(vec)]);
  const ms = performance.now() - t0;
  await client.query("commit");
  return { ids: rows.map((r) => r.id as string), ms };
}

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];
const ms = (xs: number[]) => `${pct(xs, 0.5).toFixed(1).padStart(6)}  ${pct(xs, 0.95).toFixed(1).padStart(6)}`;

const exact: string[][] = [];
const exactMs: number[] = [];
for (const v of vectors) {
  const r = await top10(v, ["enable_indexscan = off"]);
  exact.push(r.ids);
  exactMs.push(r.ms);
}
const rows = (await client.query(`select count(*)::int as n from chunks`)).rows[0].n;
const size = (await client.query(`select pg_size_pretty(pg_relation_size('chunks_embedding_hnsw')) as s`)).rows[0].s;
console.log(`${rows} chunks, HNSW index ${size}, ${questions.length} questions; vacuumed first (${dead} dead row versions)`);
console.log(`ef_search  recall@10 vs exact  p50 ms  p95 ms`);
for (const ef of EF_SEARCH) {
  let found = 0;
  const times: number[] = [];
  for (const [i, v] of vectors.entries()) {
    const r = await top10(v, [`hnsw.ef_search = ${ef}`, "enable_seqscan = off"]);
    found += r.ids.filter((id) => exact[i].includes(id)).length;
    times.push(r.ms);
  }
  const label = ef === 40 ? "40 (default)" : String(ef);
  console.log(`${label.padStart(12)}  ${(found / (10 * vectors.length)).toFixed(3).padStart(15)}  ${ms(times)}`);
}
console.log(`${"exact".padStart(12)}  ${"1.000".padStart(15)}  ${ms(exactMs)}`);
client.release();
await pool.end();
