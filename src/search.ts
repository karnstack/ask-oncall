// Search is one SQL statement you can run in psql.
import { TOP_K } from "./config.ts";
import { pool, toPg } from "./db.ts";

export type Hit = {
  id: string;
  docId: string;
  n: number;
  title: string;
  url: string;
  body: string;
  start: number;
  end: number;
  score: number;
};

export const HIT_COLUMNS = `c.id, c.doc_id as "docId", c.n, c.title, c.url, c.body,
  c.start_char as start, c.end_char as "end"`;

// Cosine distance, nearest first. With no vector index this is exact search:
// every row is compared.
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
