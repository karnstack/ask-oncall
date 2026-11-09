// The question path: search both legs, fuse, and answer from the top five.
//   npm run ask -- "How do I fail over Postgres?"
import { parseArgs } from "node:util";
import { answer, sourceLine } from "./answer.ts";
import { TOP_K } from "./config.ts";
import { pool } from "./db.ts";
import { hybridSearch } from "./search.ts";

export type AskOptions = {
  onDelta?: (text: string) => void;
};

export async function ask(question: string, opts: AskOptions = {}) {
  const t0 = performance.now();
  const ms: Record<string, number> = {};
  let usd = 0;

  // 1. both legs, fused
  const first = await hybridSearch(question);
  Object.assign(ms, first.ms);

  // 2. answer from the top five
  const sources = first.fused.slice(0, TOP_K);
  const a = await answer(question, sources, { onDelta: opts.onDelta });
  const text = a.text;
  ms.firstToken = performance.now() - t0 - a.ms + a.firstTokenMs;
  ms.answer = a.ms;
  usd += a.usd;
  ms.total = performance.now() - t0;

  return { question, text, sources, ms, usd };
}

// ---- the command line ---------------------------------------------------------

if (import.meta.main) {
  const { positionals } = parseArgs({ allowPositionals: true });
  const question = positionals.join(" ");
  if (!question) throw new Error(`usage: npm run ask -- "your question"`);
  const r = await ask(question, { onDelta: (s) => process.stdout.write(s) });
  console.log("\n");
  console.log(`sources:`);
  r.sources.forEach((s, i) => console.log(`  ${sourceLine(s, i)}`));
  console.log(`time: ${Object.entries(r.ms).map(([k, v]) => `${k} ${Math.round(v)} ms`).join(", ")}`);
  console.log(`cost: $${r.usd.toFixed(5)}`);
  await pool.end();
}
