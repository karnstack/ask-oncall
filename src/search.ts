// Search, one SQL statement each, every one runnable in psql: the vector leg
// and the word leg.
import { CANDIDATES, TOP_K } from "./config.ts";
import { pool, toPg } from "./db.ts";

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
export async function vectorSearch(vec: Float32Array, k = TOP_K): Promise<Hit[]> {
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
