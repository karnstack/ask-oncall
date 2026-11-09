// Text in, vectors out: counted before the call, sent in batches, priced, and
// cached by a hash of the exact text, so an unchanged chunk is never paid
// for twice. The cache is keyed by the text, never by the chunk id: two
// documents may hold the same text, and one id may hold new text.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { encode } from "gpt-tokenizer/encoding/cl100k_base";
import { EMBED_DIMS, EMBED_MODEL, PRICES } from "./config.ts";
import { assertBudget, record } from "./ledger.ts";
import { openai } from "./openai.ts";

export const textHash = (text: string) => createHash("sha256").update(text).digest("hex");

const CACHE_DIR = ".cache/embeddings";
const caches = new Map<string, Map<string, Float32Array>>();
const cacheFile = (model: string, dims: number) => `${CACHE_DIR}/${model}-${dims}.jsonl`;

function cacheFor(model: string, dims: number) {
  const file = cacheFile(model, dims);
  let cache = caches.get(file);
  if (cache) return cache;
  cache = new Map();
  if (existsSync(file))
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      const { hash, vector } = JSON.parse(line);
      const bytes = Buffer.from(vector, "base64");
      cache.set(hash, new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4));
    }
  caches.set(file, cache);
  return cache;
}

export type EmbedStats = { texts: number; embedded: number; tokens: number; usd: number; ms: number };

export async function embed(texts: string[], opts: { stage?: string; stats?: EmbedStats } = {}) {
  const model = EMBED_MODEL;
  const dims = EMBED_DIMS;
  const cache = cacheFor(model, dims);
  const missing = [...new Set(texts)].filter((t) => !cache.has(textHash(t)));
  const stats = opts.stats ?? { texts: 0, embedded: 0, tokens: 0, usd: 0, ms: 0 };
  stats.texts += texts.length;
  if (missing.length) {
    // count first: the local count matches what the API bills
    const planned = missing.reduce((sum, t) => sum + encode(t).length, 0);
    assertBudget((planned * PRICES[model].input) / 1_000_000);
    const t0 = performance.now();
    const batches: string[][] = [];
    for (let i = 0; i < missing.length; i += 256) batches.push(missing.slice(i, i + 256));
    let tokens = 0;
    let next = 0;
    const lines: string[] = [];
    const worker = async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        const res = await openai().embeddings.create({ model, input: batch, dimensions: dims });
        tokens += res.usage.prompt_tokens;
        res.data.forEach((d, j) => {
          const v = Float32Array.from(d.embedding);
          cache.set(textHash(batch[j]), v);
          lines.push(JSON.stringify({ hash: textHash(batch[j]), vector: Buffer.from(v.buffer).toString("base64") }));
        });
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker)); // 4 batches in flight
    mkdirSync(CACHE_DIR, { recursive: true });
    appendFileSync(cacheFile(model, dims), lines.join("\n") + "\n");
    stats.embedded += missing.length;
    stats.tokens += tokens;
    stats.usd += record(opts.stage ?? "embed", model, { input: tokens, cached: 0, output: 0 });
    stats.ms += performance.now() - t0;
  }
  return texts.map((t) => cache.get(textHash(t))!);
}

// A question is embedded the same way; the cache makes a repeated question
// free, and it is safe to share across users: it holds no document text.
export async function embedQuestion(question: string) {
  const [v] = await embed([question], { stage: "embed:question" });
  return v;
}
