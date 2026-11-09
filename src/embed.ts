// Text in, vectors out: counted before the call, sent in batches, priced.
import { encode } from "gpt-tokenizer/encoding/cl100k_base";
import { EMBED_DIMS, EMBED_MODEL, PRICES } from "./config.ts";
import { assertBudget, record } from "./ledger.ts";
import { openai } from "./openai.ts";

export type EmbedStats = { texts: number; tokens: number; usd: number; ms: number };

export async function embed(texts: string[], opts: { stage?: string; stats?: EmbedStats } = {}) {
  const stats = opts.stats ?? { texts: 0, tokens: 0, usd: 0, ms: 0 };
  // count first: the local count matches what the API bills
  const planned = texts.reduce((sum, t) => sum + encode(t).length, 0);
  assertBudget((planned * PRICES[EMBED_MODEL].input) / 1_000_000);
  const t0 = performance.now();
  const vectors: Float32Array[] = new Array(texts.length);
  const starts: number[] = [];
  for (let i = 0; i < texts.length; i += 256) starts.push(i);
  let tokens = 0;
  let next = 0;
  const worker = async () => {
    while (next < starts.length) {
      const i = starts[next++];
      const res = await openai().embeddings.create({ model: EMBED_MODEL, input: texts.slice(i, i + 256), dimensions: EMBED_DIMS });
      tokens += res.usage.prompt_tokens;
      res.data.forEach((d, j) => (vectors[i + j] = Float32Array.from(d.embedding)));
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker)); // 4 batches in flight
  stats.texts += texts.length;
  stats.tokens += tokens;
  stats.usd += record(opts.stage ?? "embed", EMBED_MODEL, { input: tokens, cached: 0, output: 0 });
  stats.ms += performance.now() - t0;
  return vectors;
}

export async function embedQuestion(question: string) {
  const [v] = await embed([question], { stage: "embed:question" });
  return v;
}
