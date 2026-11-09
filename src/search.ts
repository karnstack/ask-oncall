// Search is one SQL statement you can run in psql.
import { TOP_K } from "./config.ts";
import { pool, toPg } from "./db.ts";

export type Hit = { id: string; docId: string; title: string; url: string; body: string; score: number };

export const HIT_COLUMNS = `c.id, c.doc_id as "docId", c.title, c.url, c.body`;

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
