import { test } from "node:test";
import assert from "node:assert/strict";
import { documentHash, reconcilePlan, tombstone } from "../src/sync.ts";
import { pool } from "../src/db.ts";
import type { Doc } from "../src/corpus.ts";

const doc = (text: string, groups = ["eng"]): Doc => ({
  id: "runbooks/pgbouncer.md@v4", source: "runbooks", title: "PgBouncer", url: "u", text,
  meta: { type: "runbook", service: [], scope: null, allowedGroups: groups, author: null, version: 4, effectiveAt: null, supersededBy: null, isCurrent: true, deletedAt: null, updatedAt: null },
});

test("the document hash changes with the text and with the front matter", () => {
  assert.equal(documentHash(doc("a")), documentHash(doc("a")));
  assert.notEqual(documentHash(doc("a")), documentHash(doc("b")));
  assert.notEqual(documentHash(doc("a")), documentHash(doc("a", ["eng", "contractors"])), "a permission change is a change");
});

test("reconcile tombstones what the listing no longer has", () => {
  const plan = reconcilePlan(["a", "b", "c", "d"], ["a", "b", "c"]);
  assert.deepEqual(plan.toTombstone, ["d"]);
});

// The database is never reached: pool.connect hands back a client that writes
// down what it was sent.
function fakeClient(failOn?: string) {
  const sent: string[] = [];
  const client = {
    sent,
    query: async (sql: string) => {
      sent.push(sql.split(" ").slice(0, 2).join(" "));
      if (failOn && sql.startsWith(failOn)) throw new Error("connection lost");
      return { rows: [] };
    },
    release: () => {},
  };
  return client;
}

test("a tombstone marks the document and deletes its chunks in one transaction", async (t) => {
  const client = fakeClient();
  t.mock.method(pool, "connect", async () => client);
  await tombstone("runbooks/pgbouncer.md@v3");
  assert.deepEqual(client.sent, ["begin", "update documents", "delete from", "commit"]);
});

test("a tombstone that fails half way rolls back", async (t) => {
  const client = fakeClient("delete");
  t.mock.method(pool, "connect", async () => client);
  await assert.rejects(tombstone("runbooks/pgbouncer.md@v3"), /connection lost/);
  assert.deepEqual(client.sent, ["begin", "update documents", "delete from", "rollback"]);
});
