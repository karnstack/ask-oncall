// The question path: search both legs, fuse, rerank, and answer from what the
// reranker kept.
//   npm run ask -- "How do I fail over Postgres?"
import { parseArgs } from "node:util";
import { answer, sourceLine } from "./answer.ts";
import { RERANK_CANDIDATES, RERANK_KEEP } from "./config.ts";
import { pool } from "./db.ts";
import { rerank } from "./rerank.ts";
import { hybridSearch, type Hit } from "./search.ts";

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

  // 2. the reranker reads the top candidates and keeps at most five
  const candidates = first.fused.slice(0, RERANK_CANDIDATES);
  let kept: Hit[] = [];
  if (candidates.length) {
    const rr = await rerank(question, candidates);
    kept = rr.kept;
    ms.rerank = rr.ms;
    usd += rr.usd;
  }

  // 3. answer from what was kept (the first five, if the reranker kept none)
  if (!kept.length) kept = candidates.slice(0, RERANK_KEEP);
  const a = await answer(question, kept, { onDelta: opts.onDelta });
  const text = a.text;
  ms.firstToken = performance.now() - t0 - a.ms + a.firstTokenMs;
  ms.answer = a.ms;
  usd += a.usd;
  ms.total = performance.now() - t0;

  return { question, text, sources: kept, candidates, ms, usd };
}

// ---- the command line ---------------------------------------------------------

if (import.meta.main) {
  const { positionals } = parseArgs({ allowPositionals: true });
  const question = positionals.join(" ");
  if (!question) throw new Error(`usage: npm run ask -- "your question"`);
  const r = await ask(question, { onDelta: (s) => process.stdout.write(s) });
  console.log("\n");
  console.log(`sources:`);
  r.sources.forEach((s, i) => console.log(`  ${sourceLine(s, i)}${s.breadcrumb ? `\n      ${s.breadcrumb}` : ""}`));
  console.log(`time: ${Object.entries(r.ms).map(([k, v]) => `${k} ${Math.round(v)} ms`).join(", ")}`);
  console.log(`cost: $${r.usd.toFixed(5)}`);
  await pool.end();
}
