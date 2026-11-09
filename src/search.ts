// The first stage: two legs, each one SQL statement you can run in psql, and
// reciprocal rank fusion to merge them. sql/hybrid.sql is the same fusion as a
// single statement.
import { CANDIDATES, EMBED_COLUMN, HNSW_EF_SEARCH, RRF_K } from "./config.ts";
import { pool, toPg } from "./db.ts";
import { embedQuestion } from "./embed.ts";

export type Hit = {
  id: string;
  docId: string;
  n: number;
  source: string;
  title: string;
  url: string;
  breadcrumb: string;
  body: string;
  version: number | null;
  updatedAt: string | null;
  start: number;
  end: number;
  score: number;
};

export const HIT_COLUMNS = `c.id, c.doc_id as "docId", c.n, c.source, c.title, c.url, c.breadcrumb, c.body,
  c.version, c.updated_at::text as "updatedAt", c.start_char as start, c.end_char as "end"`;

// Who is asking and what they asked for. Every filter runs inside both legs,
// never after them: the model must never see a chunk the asker could not open.
export type Filter = {
  principals?: string[]; // the asker's principals (access.ts)
  currentOnly?: boolean; // only documents in effect now
  scope?: string; // narrow the search, e.g. 'payouts'
  service?: string; // a service the question names
};

// The WHERE clause for a filter, with its parameters numbered from `first`.
// The flags live on the chunk row (copied from documents by sync.ts): a join
// is applied after an HNSW scan just like a WHERE, and loses the same rows.
// Chunks of a tombstoned document are deleted, so no "deleted" flag is needed.
export function whereSql(filter: Filter, first: number): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  const param = (v: unknown) => `$${first + params.push(v) - 1}`;
  if (filter.currentOnly) parts.push(`c.is_current`);
  if (filter.principals) parts.push(`c.allowed_groups && ${param(filter.principals)}::text[]`);
  if (filter.scope) parts.push(`c.scope = ${param(filter.scope)}`);
  if (filter.service) parts.push(`${param(filter.service)} = any(c.service)`);
  return { sql: parts.length ? parts.join(" and ") : "true", params };
}

// The vector leg. With filters on an HNSW index, the filter runs after the
// index scan; an iterative scan keeps walking the graph until k rows pass.
// relaxed_order can return rows slightly out of order, so re-sort them.
export async function vectorSearch(vec: Float32Array, filter: Filter = {}, k = CANDIDATES, column = EMBED_COLUMN): Promise<Hit[]> {
  const w = whereSql(filter, 2);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local hnsw.ef_search = ${HNSW_EF_SEARCH}`);
    await client.query(`set local hnsw.iterative_scan = relaxed_order`);
    const { rows } = await client.query(
      `with ranked as materialized (
         select ${HIT_COLUMNS}, c.${column} <=> $1::vector as distance
           from chunks c
          where ${w.sql}
          order by distance
          limit ${k}
       )
       select *, 1 - distance as score from ranked order by distance + 0`,
      [toPg(vec), ...w.params],
    );
    await client.query("commit");
    return rows;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

// The word leg: Postgres full-text search with an OR query. plainto_tsquery
// and websearch_to_tsquery AND every word, and returned nothing for 22 of the
// 48 written questions; the OR query lets ts_rank order any chunk that shares
// a word. ts_rank's flag 1 divides by 1 + log(length).
export const OR_QUERY = `(select to_tsquery('simple', coalesce(string_agg(quote_literal(lexeme), ' | '), ''))
     from unnest(to_tsvector('english', $1)))`;

export async function wordSearch(question: string, filter: Filter = {}, k = CANDIDATES): Promise<Hit[]> {
  const w = whereSql(filter, 2);
  const { rows } = await pool.query(
    `with q as (select ${OR_QUERY} as q)
     select ${HIT_COLUMNS}, ts_rank(c.tsv, q.q, 1) as score
       from chunks c, q
      where c.tsv @@ q.q and ${w.sql}
      order by score desc, c.id
      limit ${k}`,
    [question, ...w.params],
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

// Both legs, fused. The word leg needs no embedding, so it runs while the
// question is embedded and the vector leg searches: the critical path is the
// slower of the two. (At Castlane's size the word leg takes about 11 ms and
// hides behind a 218 ms embedding call, so this saves about 1 ms; it matters
// when the word leg is slow.)
export async function hybridSearch(question: string, filter: Filter = {}) {
  const ms = { embed: 0, vector: 0, word: 0 };
  const timed = async <T>(stage: keyof typeof ms, fn: () => Promise<T>) => {
    const t0 = performance.now();
    const result = await fn();
    ms[stage] = performance.now() - t0;
    return result;
  };
  const [vector, word] = await Promise.all([
    timed("embed", () => embedQuestion(question)).then((vec) => timed("vector", () => vectorSearch(vec, filter))),
    timed("word", () => wordSearch(question, filter)),
  ]);
  return { vector, word, fused: rrf([vector, word]), ms };
}
