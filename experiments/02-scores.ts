// What a similarity score can and cannot tell you. The top score of every
// written question beside the top score of every question with no answer,
// and what a "skip sources under x" rule would do.
//   node experiments/02-scores.ts
import { pool } from "../src/db.ts";
import { embed } from "../src/embed.ts";
import { vectorSearch } from "../src/search.ts";
import { loadQuestions } from "../tools/score.ts";

// Multiply matching numbers and add them up; divide by the lengths. These
// vectors come back at length 1, so the dot product alone is the cosine, and
// pgvector's `1 - (a <=> b)` is the same number.
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / Math.sqrt(na * nb);
}

const top1 = async (qs: { q: string }[]) => {
  const vecs = await embed(qs.map((q) => q.q), { stage: "embed:question" });
  return Promise.all(vecs.map(async (v) => (await vectorSearch(v, {}, 1))[0].score));
};
const real = await top1(loadQuestions("written"));
const none = await top1([...loadQuestions("unanswerable"), ...loadQuestions("near-miss")]);
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return `min ${s[0].toFixed(3)}, median ${s[Math.floor(s.length / 2)].toFixed(3)}, max ${s.at(-1)!.toFixed(3)}`;
};
console.log(`top-1 score, ${real.length} written questions: ${stats(real)}`);
console.log(`top-1 score, ${none.length} questions with no answer: ${stats(none)}`);
console.log(`cut   real questions left with no source   no-answer questions let through`);
for (const cut of [0.5, 0.55, 0.6, 0.65, 0.7])
  console.log(`${cut.toFixed(2)}  ${String(real.filter((s) => s < cut).length).padStart(16)} of ${real.length}   ${String(none.filter((s) => s >= cut).length).padStart(18)} of ${none.length}`);
await pool.end();
