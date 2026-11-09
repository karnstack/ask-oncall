// Drop the index and create it again from sql/001_schema.sql. Run it when a
// lesson changes the schema, then npm run ingest (about five cents to embed).
//   npm run db:reset
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pool } from "../src/db.ts";

await pool.query(`drop table if exists chunks cascade`);
await pool.query(readFileSync(join(import.meta.dirname, "..", "sql", "001_schema.sql"), "utf8"));
console.log("index reset: run npm run ingest");
await pool.end();
