// The answer: numbered sources with title, version and age, streamed, never
// stored by the provider.
import { ANSWER_MODEL } from "./config.ts";
import { respondStream } from "./openai.ts";

export type Source = { title: string; url: string; body: string; version: number | null; updatedAt: string | null };

export const daysAgo = (iso: string, now: Date) => Math.round((now.getTime() - Date.parse(iso.slice(0, 10))) / 86_400_000);

// "[2] PgBouncer (pgbouncer-feeds, pgbouncer-payouts) (v4, updated 6 days ago) https://..."
export function sourceLine(s: Source, i: number, now = new Date()) {
  const version = s.version != null ? `v${s.version}, ` : "";
  const age = s.updatedAt ? `updated ${daysAgo(s.updatedAt, now)} days ago` : "public docs";
  return `[${i + 1}] ${s.title} (${version}${age}) ${s.url}`;
}

export function answerPrompt(question: string, sources: Source[], now = new Date()) {
  const excerpts = sources.map((s, i) => `${sourceLine(s, i, now)}\n${s.body}`).join("\n\n");
  return `Answer the on-call engineer's question using the numbered sources. Cite sources like [2].

${excerpts}

Question: ${question}`;
}

export async function answer(question: string, sources: Source[], opts: { now?: Date; onDelta?: (s: string) => void } = {}) {
  return respondStream("answer", ANSWER_MODEL, answerPrompt(question, sources, opts.now), opts.onDelta);
}
