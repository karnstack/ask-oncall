// The first stage: two legs, each one SQL statement you can run in psql, and
// reciprocal rank fusion to merge them. sql/hybrid.sql is the same fusion as a
// single statement.
import { CANDIDATES, RRF_K } from "./config.ts";
import { pool, toPg } from "./db.ts";
import { embedQuestion } from "./embed.ts";

export type Hit = {
  id: string;
  docId: string;
  n: number;
  source: string;
  title: string;
  url: string;
  body: string;
  start: number;
  end: number;
  score: number;
};

export const HIT_COLUMNS = `c.id, c.doc_id as "docId", c.n, c.source, c.title, c.url, c.body,
  c.start_char as start, c.end_char as "end"`;

// The vector leg: cosine distance, nearest first. With no vector index this
// is exact search: every row is compared.
export async function vectorSearch(vec: Float32Array, k = CANDIDATES): Promise<Hit[]> {
  const { rows } = await pool.query(
    `select ${HIT_COLUMNS}, 1 - (c.embedding <=> $1::vector) as score
       from chunks c
      order by c.embedding <=> $1::vector
      limit ${k}`,
    [toPg(vec)],
  );
  return rows;
}

// The word leg: Postgres full-text search with an OR query. plainto_tsquery
// and websearch_to_tsquery AND every word, and returned nothing for 22 of the
// 48 written questions; the OR query lets ts_rank order any chunk that shares
// a word. ts_rank's flag 1 divides by 1 + log(length).
export const OR_QUERY = `(select to_tsquery('simple', coalesce(string_agg(quote_literal(lexeme), ' | '), ''))
     from unnest(to_tsvector('english', $1)))`;

export async function wordSearch(question: string, k = CANDIDATES): Promise<Hit[]> {
  const { rows } = await pool.query(
    `with q as (select ${OR_QUERY} as q)
     select ${HIT_COLUMNS}, ts_rank(c.tsv, q.q, 1) as score
       from chunks c, q
      where c.tsv @@ q.q
      order by score desc, c.id
      limit ${k}`,
    [question],
  );
  return rows;
}

// Reciprocal rank fusion (Cormack, Clarke and Buettcher, 2009): each list adds
// 1 / (k + rank) for every chunk it holds. Scores are never compared, only
// ranks, so a cosine and a ts_rank can be merged.
export function rrf<T extends { id: string }>(lists: T[][], k = RRF_K, limit = CANDIDATES): (T & { score: number })[] {
  const acc = new Map<string, { hit: T; score: number }>();
  for (const list of lists)
    list.forEach((hit, i) => {
      const e = acc.get(hit.id) ?? { hit, score: 0 };
      e.score += 1 / (k + i + 1);
      acc.set(hit.id, e);
    });
  return [...acc.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e) => ({ ...e.hit, score: e.score }));
}

// Both legs, fused, one after the other: embed the question, search by
// vector, then search by words.
export async function hybridSearch(question: string) {
  const ms = { embed: 0, vector: 0, word: 0 };
  const timed = async <T>(stage: keyof typeof ms, fn: () => Promise<T>) => {
    const t0 = performance.now();
    const result = await fn();
    ms[stage] = performance.now() - t0;
    return result;
  };
  const vec = await timed("embed", () => embedQuestion(question));
  const vector = await timed("vector", () => vectorSearch(vec));
  const word = await timed("word", () => wordSearch(question));
  return { vector, word, fused: rrf([vector, word]), ms };
}
