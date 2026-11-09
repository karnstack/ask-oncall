// One connection pool to Postgres 18 with pgvector (docker-compose.yml).
import pg from "pg";

export const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:ask-oncall@127.0.0.1:55434/ask_oncall";
export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 8 });

// pgvector reads a vector as the text '[0.1,0.2,...]'.
export const toPg = (v: Float32Array | number[]) => `[${Array.from(v).join(",")}]`;
