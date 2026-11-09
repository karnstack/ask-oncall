// Run sql/hybrid.sql for one question next to the code path (two legs + rrf
// in TypeScript), and show that the fused lists agree.
//   node tools/hybrid-sql.ts "How do I take a backup of etcd?"
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pool, toPg } from "../src/db.ts";
import { embedQuestion } from "../src/embed.ts";
import { hybridSearch } from "../src/search.ts";

const { positionals } = parseArgs({ allowPositionals: true });
const question = positionals.join(" ");
const client = await pool.connect();
await client.query("set enable_indexscan = off"); // exact search on the vector leg
await client.query(readFileSync(join(import.meta.dirname, "..", "sql", "hybrid.sql"), "utf8"));
const sql = (await client.query(`execute hybrid($1, $2)`, [toPg(await embedQuestion(question)), question])).rows;
client.release();
const code = (await hybridSearch(question, { currentOnly: true })).fused;
console.log(`rank  sql.hybrid                                          code (rrf)`);
for (let i = 0; i < 10; i++) console.log(`${String(i + 1).padStart(4)}  ${(sql[i]?.id ?? "").padEnd(50)}  ${code[i]?.id ?? ""}`);
const same = sql.slice(0, 10).filter((r, i) => r.id === code[i]?.id).length;
console.log(`same chunk at the same rank in the top 10: ${same} of 10`);
await pool.end();
