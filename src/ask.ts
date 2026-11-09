// The question path: embed the question, find the five closest chunks, and
// answer from them with numbered sources.
//   npm run ask -- "KubePodCrashLooping fired for transcoder. What do I check first?"
import { parseArgs } from "node:util";
import { answer, sourceLine } from "./answer.ts";
import { TOP_K } from "./config.ts";
import { pool } from "./db.ts";
import { embedQuestion } from "./embed.ts";
import { vectorSearch } from "./search.ts";

export type AskOptions = {
  onDelta?: (text: string) => void;
};

export async function ask(question: string, opts: AskOptions = {}) {
  const t0 = performance.now();
  const ms: Record<string, number> = {};

  // 1. embed the question, and take the five closest chunks
  let t = performance.now();
  const vec = await embedQuestion(question);
  ms.embed = performance.now() - t;
  t = performance.now();
  const sources = await vectorSearch(vec, TOP_K);
  ms.search = performance.now() - t;

  // 2. answer from them, streamed
  const a = await answer(question, sources, { onDelta: opts.onDelta });
  ms.firstToken = performance.now() - t0 - a.ms + a.firstTokenMs;
  ms.answer = a.ms;
  ms.total = performance.now() - t0;
  return { question, text: a.text, sources, ms, usage: a.usage, usd: a.usd };
}

// ---- the command line ---------------------------------------------------------

if (import.meta.main) {
  const { positionals } = parseArgs({ allowPositionals: true });
  const question = positionals.join(" ");
  if (!question) throw new Error(`usage: npm run ask -- "your question"`);
  const r = await ask(question, { onDelta: (s) => process.stdout.write(s) });
  console.log("\n");
  console.log(`sources (cosine similarity):`);
  r.sources.forEach((s, i) => console.log(`  ${s.score.toFixed(3)}  ${sourceLine(s, i)}`));
  console.log(`time: ${Object.entries(r.ms).map(([k, v]) => `${k} ${Math.round(v)} ms`).join(", ")}`);
  console.log(`answer: ${r.usage.input} input tokens (${r.usage.cached} cached), ${r.usage.output} output: $${r.usd.toFixed(5)}`);
  await pool.end();
}
