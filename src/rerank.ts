// A second, slower look: one model call reads the question and every
// candidate together, and returns the ids of the few that best answer it.
// A listwise reranker returns no score; unpicked candidates keep their
// first-stage order behind the picks.
import { encode, decode } from "gpt-tokenizer/encoding/cl100k_base";
import { RERANK_CLIP_TOKENS, RERANK_KEEP, RERANK_MODEL } from "./config.ts";
import { respond } from "./openai.ts";

const clip = (s: string, n: number) => {
  const tokens = encode(s);
  return tokens.length > n ? decode(tokens.slice(0, n)) : s;
};

export function rerankPrompt(question: string, candidates: { body: string }[]) {
  const passages = candidates.map((c, i) => `[${i}] ${clip(c.body, RERANK_CLIP_TOKENS)}`).join("\n\n");
  return `You rank search results for an on-call engineer's question.
Question: ${question}

Passages:
${passages}

Return the numbers of the passages that best help answer the question, most useful first, at most ${RERANK_KEEP}, as JSON like {"ids":[3,0,17]}. Return {"ids":[]} if none help. Output only the JSON.`;
}

// The model's answer, parsed defensively: anything that is not a valid
// candidate number is dropped.
export function parsePicks(text: string, count: number): number[] {
  let ids: unknown = [];
  try {
    ids = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}").ids ?? [];
  } catch {
    ids = [];
  }
  const picks = Array.isArray(ids) ? ids.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < count) : [];
  return [...new Set(picks)].slice(0, RERANK_KEEP);
}

export async function rerank<T extends { body: string }>(question: string, candidates: T[]) {
  const r = await respond("rerank", RERANK_MODEL, rerankPrompt(question, candidates));
  const picks = parsePicks(r.text, candidates.length);
  const kept = picks.map((i) => candidates[i]);
  const ranked = [...kept, ...candidates.filter((_, i) => !picks.includes(i))];
  return { kept, ranked, usage: r.usage, usd: r.usd, ms: r.ms };
}
