import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAnswer, citedSentence, isNotFound, notFoundAnswer, quotedSpans } from "../src/checks.ts";

const v4 = {
  title: "PgBouncer", url: "https://runbooks.castlane.internal/pgbouncer/v4",
  body: "## Why 25 and not 40\n\n3 pods x 40 x 4 users = 480 server connections. Until 2026-10-28 this runbook said `default_pool_size = 40`. Set `default_pool_size = 25`.",
};

test("a good answer passes every check", () => {
  const c = checkAnswer("Set `default_pool_size = 25` [1].", [v4]);
  assert.deepEqual([c.badCitations, c.unverifiedQuotes, c.foreignLinks, c.notFound], [[], [], [], false]);
});

test("a citation must point at a source that was sent", () => {
  assert.deepEqual(checkAnswer("See [1] and [3].", [v4]).badCitations, [3]);
});

test("a quoted span must appear in a sent source", () => {
  const c = checkAnswer("Use `amtool silence add alertname=PayoutBatchEarly` [1].", [v4]);
  assert.deepEqual(c.unverifiedQuotes, ["amtool silence add alertname=PayoutBatchEarly"]);
});

test("a true quote from the right page passes, even in a wrong answer", () => {
  // written by hand to test the check: v4 really says 40, as history
  const c = checkAnswer("Set `default_pool_size = 40` [1].", [v4]);
  assert.deepEqual(c.unverifiedQuotes, []);
  assert.equal(citedSentence(v4.body, "default_pool_size = 40"), "Until 2026-10-28 this runbook said `default_pool_size = 40`.");
});

test("every link must be a sent source's URL", () => {
  const c = checkAnswer("Open https://alertmanager.castlane.internal and see https://runbooks.castlane.internal/pgbouncer/v4/.", [v4]);
  assert.deepEqual(c.foreignLinks, ["https://alertmanager.castlane.internal"]);
});

test("quoted spans: code lines, inline code, long double-quoted phrases", () => {
  assert.deepEqual(quotedSpans('Run:\n```\nkubectl -n media get pods\n```\nthen `RECONNECT feeds;` as "do NOT raise it back" says.'), [
    "kubectl -n media get pods", "RECONNECT feeds;", "do NOT raise it back",
  ]);
});

test("not found: the fixed sentence, and nearest titles from the asker's own sources", () => {
  const a = notFoundAnswer([{ title: "DB password rotation" }, { title: "DB password rotation" }, { title: "PgBouncer" }, { title: "Patroni" }]);
  assert.equal(a, "Not found in Castlane's docs. Nearest: DB password rotation; PgBouncer; Patroni.");
  assert.ok(isNotFound(a));
  assert.ok(!isNotFound("Set it to 25 [1]."));
});
