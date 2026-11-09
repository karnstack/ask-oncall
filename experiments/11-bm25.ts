// Is Postgres word search BM25? ts_rank counts matches with no global
// information: a word in 3 chunks weighs the same as a word in 3,000. Here is
// textbook BM25 (k1 1.2, b 0.75) computed in memory over the lexemes Postgres
// already made, beside the course's ts_rank leg, on the written questions.
//   node experiments/11-bm25.ts
import { pool } from "../src/db.ts";
import { wordSearch } from "../src/search.ts";
import { Labels, loadQuestions, scoreQuestion, summarize } from "../tools/score.ts";

type Row = { id: string; docId: string; start: number; end: number };
const { rows } = await pool.query(
  `select id, doc_id as "docId", start_char as start, end_char as "end",
          (select coalesce(array_agg(lexeme || ' ' || coalesce(array_length(positions, 1), 1)), '{}') from unnest(tsv)) as lex
     from chunks`,
);
const postings = new Map<string, { i: number; tf: number }[]>();
const length: number[] = [];
rows.forEach((r: Row & { lex: string[] }, i: number) => {
  let n = 0;
  for (const e of r.lex) {
    const sp = e.lastIndexOf(" ");
    const tf = Number(e.slice(sp + 1));
    n += tf;
    const term = e.slice(0, sp);
    if (!postings.has(term)) postings.set(term, []);
    postings.get(term)!.push({ i, tf });
  }
  length.push(n);
});
const avg = length.reduce((a, b) => a + b, 0) / length.length;

async function bm25(question: string, k = 50, k1 = 1.2, b = 0.75): Promise<Row[]> {
  const terms = (await pool.query(`select distinct lexeme from unnest(to_tsvector('english', $1))`, [question])).rows.map((r) => r.lexeme as string);
  const scores = new Map<number, number>();
  for (const term of terms) {
    const p = postings.get(term);
    if (!p) continue;
    const idf = Math.log(1 + (rows.length - p.length + 0.5) / (p.length + 0.5)); // rare words count more
    for (const { i, tf } of p) scores.set(i, (scores.get(i) ?? 0) + (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * length[i]) / avg)));
  }
  return [...scores].sort((x, y) => y[1] - x[1]).slice(0, k).map(([i]) => rows[i]);
}

const labels = Labels.fromCorpus();
const questions = loadQuestions("written");
const tsRank = [], okapi = [];
for (const q of questions) {
  tsRank.push(scoreQuestion(labels, q, await wordSearch(q.q)));
  okapi.push(scoreQuestion(labels, q, await bm25(q.q)));
}
const fmt = (r: Record<string, number>) => Object.entries(r).map(([k, v]) => `${k} ${v.toFixed(3)}`).join("  ");
console.log(`${rows.length} chunks, ${questions.length} written questions`);
console.log(`ts_rank (the course's word leg): ${fmt(summarize(tsRank))}`);
console.log(`BM25 in memory:                  ${fmt(summarize(okapi))}`);
const idf = (df: number) => Math.log(1 + (rows.length - df + 0.5) / (df + 0.5));
console.log(`BM25's weight for a word in 3 chunks: ${idf(3).toFixed(1)}; in 3,000 chunks: ${idf(3000).toFixed(1)}`);
await pool.end();
