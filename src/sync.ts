// The index path that keeps up with its sources.
//   hash       one content hash per document; an unchanged document is skipped
//   replace    a changed document's chunks are deleted and re-inserted in one
//              transaction, so a search never sees half a document
//   tombstone  a document the source no longer lists keeps its row with
//              deleted_at set, and its chunks are deleted in the same
//              transaction
import { createHash } from "node:crypto";
import type pg from "pg";
import { chunkByHeadings, type Chunk } from "./chunk.ts";
import { cachedContext } from "./context.ts";
import type { Doc } from "./corpus.ts";
import { pool, toPg } from "./db.ts";
import { embed, type EmbedStats } from "./embed.ts";

// Text and front matter: a permission or version change is a change too.
export const documentHash = (d: Doc) =>
  createHash("sha256").update(d.text + "\n" + JSON.stringify(d.meta)).digest("hex");

export type SyncStats = { listed: number; unchanged: number; replaced: number; chunks: number; tombstoned: number; embed: EmbedStats };
export const emptyStats = (): SyncStats => ({
  listed: 0, unchanged: 0, replaced: 0, chunks: 0, tombstoned: 0,
  embed: { texts: 0, embedded: 0, tokens: 0, usd: 0, ms: 0 },
});

const CHUNK_COLUMNS = `id, doc_id, n, title, url, body, embedding, start_char, end_char, source, type, version,
  is_current, superseded_by, allowed_groups, scope, service, effective_at, updated_at, breadcrumb, context`;

function chunkRow(d: Doc, c: Chunk, v: Float32Array): unknown[] {
  const m = d.meta;
  return [
    c.id, c.docId, c.n, d.title, d.url, c.body, toPg(v), c.start, c.end, d.source, m.type, m.version,
    m.isCurrent, m.supersededBy, m.allowedGroups, m.scope, m.service, m.effectiveAt, m.updatedAt, c.breadcrumb,
    cachedContext(d.text, c.body),
  ];
}

async function insertChunks(client: pg.PoolClient, rows: unknown[][]) {
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const width = batch[0].length;
    const values = batch.map((_, j) => `(${Array.from({ length: width }, (_, k) => `$${j * width + k + 1}`).join(",")})`);
    await client.query(`insert into chunks (${CHUNK_COLUMNS}) values ${values.join(",")}`, batch.flat());
  }
}

// Replace every changed document: chunk, embed (only new text costs), then
// one transaction per document.
export async function syncDocuments(docs: Doc[], stats = emptyStats()): Promise<SyncStats> {
  stats.listed += docs.length;
  const known = new Map<string, { hash: string; deletedAt: Date | null }>(
    (await pool.query(`select id, content_hash, deleted_at from documents where id = any($1::text[])`, [docs.map((d) => d.id)])).rows.map(
      (r) => [r.id, { hash: r.content_hash, deletedAt: r.deleted_at }],
    ),
  );
  const changed = docs.filter((d) => {
    const k = known.get(d.id);
    return !k || k.hash !== documentHash(d) || k.deletedAt != null; // new, changed, or back after a delete
  });
  stats.unchanged += docs.length - changed.length;
  if (!changed.length) return stats;

  const chunks = changed.map((d) => chunkByHeadings(d));
  const vectors = await embed(chunks.flat().map((c) => c.body), { stage: "embed:chunks", stats: stats.embed });
  let v = 0;
  const client = await pool.connect();
  try {
    for (const [i, d] of changed.entries()) {
      const m = d.meta;
      const rows = chunks[i].map((c) => chunkRow(d, c, vectors[v++]));
      await client.query("begin");
      await client.query(`delete from chunks where doc_id = $1`, [d.id]);
      if (rows.length) await insertChunks(client, rows);
      await client.query(
        `insert into documents (id, source, title, url, content_hash, version, effective_at, superseded_by, is_current,
                                allowed_groups, scope, deleted_at, updated_at, indexed_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, null, $12, now())
         on conflict (id) do update set source = excluded.source, title = excluded.title, url = excluded.url,
           content_hash = excluded.content_hash, version = excluded.version, effective_at = excluded.effective_at,
           superseded_by = excluded.superseded_by, is_current = excluded.is_current, allowed_groups = excluded.allowed_groups,
           scope = excluded.scope, deleted_at = null, updated_at = excluded.updated_at, indexed_at = now()`,
        [d.id, d.source, d.title, d.url, documentHash(d), m.version, m.effectiveAt, m.supersededBy, m.isCurrent, m.allowedGroups, m.scope, m.updatedAt],
      );
      await client.query("commit");
      stats.replaced++;
      stats.chunks += rows.length;
    }
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
  return stats;
}

// One transaction: the document is marked deleted and its chunks are gone
// together, or neither happens. No deleted document's chunks are left behind
// to answer a question.
export async function tombstone(id: string) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`update documents set deleted_at = now() where id = $1`, [id]);
    await client.query(`delete from chunks where doc_id = $1`, [id]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

// Reconcile: what the index holds for a source and the source no longer lists.
export function reconcilePlan(known: string[], listed: string[]) {
  const keep = new Set(listed);
  return { toTombstone: known.filter((id) => !keep.has(id)) };
}

export async function reconcile(source: string, listed: string[]) {
  const known = (await pool.query(`select id from documents where source = $1 and deleted_at is null`, [source])).rows.map((r) => r.id as string);
  const plan = reconcilePlan(known, listed);
  for (const id of plan.toTombstone) await tombstone(id);
  return plan;
}

// The nightly job, per source: replace what changed, tombstone what is gone.
export async function syncSources(docs: Doc[], stats = emptyStats()): Promise<SyncStats> {
  const bySource = Map.groupBy(docs, (d) => d.source);
  for (const [source, listed] of bySource) {
    await syncDocuments(listed, stats);
    const plan = await reconcile(source, listed.map((d) => d.id));
    stats.tombstoned += plan.toTombstone.length;
  }
  return stats;
}
