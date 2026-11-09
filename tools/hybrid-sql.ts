// Run sql/hybrid.sql for one question next to the code path (two legs + rrf
// in TypeScript), and show that the fused lists agree.
//   node tools/hybrid-sql.ts "How do I take a backup of etcd?" --as tw
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { principalsOf, userByHandle } from "../src/access.ts";
import { pool, toPg } from "../src/db.ts";
import { embedQuestion } from "../src/embed.ts";
import { hybridSearch } from "../src/search.ts";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { as: { type: "string", default: "tw" } } });
const question = positionals.join(" ");
const principals = principalsOf(userByHandle(values.as!));
const client = await pool.connect();
await client.query("set enable_indexscan = off"); // exact search on the vector leg
await client.query(readFileSync(join(import.meta.dirname, "..", "sql", "hybrid.sql"), "utf8"));
const sql = (await client.query(`execute hybrid($1, $2, $3)`, [toPg(await embedQuestion(question)), question, principals])).rows;
client.release();
const code = (await hybridSearch(question, { principals, currentOnly: true })).fused;
console.log(`rank  sql.hybrid                                          code (rrf)`);
for (let i = 0; i < 10; i++) console.log(`${String(i + 1).padStart(4)}  ${(sql[i]?.id ?? "").padEnd(50)}  ${code[i]?.id ?? ""}`);
const same = sql.slice(0, 10).filter((r, i) => r.id === code[i]?.id).length;
console.log(`same chunk at the same rank in the top 10: ${same} of 10`);
await pool.end();
