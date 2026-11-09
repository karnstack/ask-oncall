// The answer: numbered sources, streamed, never stored by the provider.
import { ANSWER_MODEL } from "./config.ts";
import { respondStream } from "./openai.ts";

export type Source = { title: string; url: string; body: string };

// "[2] PgBouncer (pgbouncer-feeds, pgbouncer-payouts) https://..."
export function sourceLine(s: Source, i: number) {
  return `[${i + 1}] ${s.title} ${s.url}`;
}

export function answerPrompt(question: string, sources: Source[]) {
  const excerpts = sources.map((s, i) => `${sourceLine(s, i)}\n${s.body}`).join("\n\n");
  return `Answer the on-call engineer's question using the numbered sources. Cite sources like [2].

${excerpts}

Question: ${question}`;
}

export async function answer(question: string, sources: Source[], opts: { onDelta?: (s: string) => void } = {}) {
  return respondStream("answer", ANSWER_MODEL, answerPrompt(question, sources), opts.onDelta);
}
