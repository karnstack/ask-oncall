// Smaller vectors before smaller recall. pgvector will not HNSW-index a
// vector over 2,000 dimensions; halfvec goes to 4,000; binary vectors are 32
// times smaller and need a rescore by the full vectors.
//   node tools/smaller-vectors.ts
import { pool, toPg } from "../src/db.ts";
import { embed } from "../src/embed.ts";
import { loadQuestions } from "./score.ts";

const size = async (name: string) => (await pool.query(`select pg_size_pretty(pg_relation_size($1::regclass)) s`, [name])).rows[0].s;

// 1. the 3,072-dimension shadow column, if a model trial added it
const shadow = (await pool.query(`select 1 from information_schema.columns where table_name = 'chunks' and column_name = 'embedding_v2'`)).rowCount;
if (shadow) {
  try {
    await pool.query(`create index chunks_v2_vector on chunks using hnsw (embedding_v2 vector_cosine_ops)`);
  } catch (e) {
    console.log(`hnsw on embedding_v2 as vector(3072): ERROR ${(e as Error).message}`);
  }
  await pool.query(`create index if not exists chunks_v2_half on chunks using hnsw ((embedding_v2::halfvec(3072)) halfvec_cosine_ops)`);
  console.log(`hnsw on embedding_v2::halfvec(3072): built, ${await size("chunks_v2_half")}`);
}

// 2. binary quantization: one bit per number in the index, full vectors for the rescore
await pool.query(`create index if not exists chunks_embedding_bq on chunks using hnsw ((binary_quantize(embedding)::bit(1536)) bit_hamming_ops)`);
console.log(`float index ${await size("chunks_embedding_hnsw")}, binary index ${await size("chunks_embedding_bq")}`);

const questions = loadQuestions("written");
const vectors = await embed(questions.map((q) => q.q), { stage: "embed:question" });
const client = await pool.connect();
await client.query(`set hnsw.ef_search = 200`); // at least the inner LIMIT of 100
let same = 0, overlap = 0;
for (const v of vectors) {
  await client.query(`set enable_indexscan = off`);
  const exact = (await client.query(`select id from chunks order by embedding <=> $1::vector limit 10`, [toPg(v)])).rows.map((r) => r.id);
  await client.query(`set enable_indexscan = on`);
  // binary_quantize($1) needs the ::vector cast, or Postgres cannot pick the function
  const binary = (await client.query(
    `select id from (
       select id, embedding from chunks
        order by binary_quantize(embedding)::bit(1536) <~> binary_quantize($1::vector)
        limit 100) s
     order by s.embedding <=> $1::vector
     limit 10`,
    [toPg(v)],
  )).rows.map((r) => r.id);
  overlap += binary.filter((id) => exact.includes(id)).length;
  if (binary.join() === exact.join()) same++;
}
client.release();
console.log(`binary + rescore of the top 100: the same top 10 for ${same} of ${questions.length} questions; recall@10 vs exact ${(overlap / (10 * questions.length)).toFixed(3)}`);
await pool.end();
