import { test } from "node:test";
import assert from "node:assert/strict";
import { decode, encode } from "gpt-tokenizer/encoding/cl100k_base";
import { chunkByHeadings, chunkFixed, countTokens, sectionsOf, slugify } from "../src/chunk.ts";

const words = (n: number, w = "word") => Array.from({ length: n }, (_, i) => `${w}${i}`).join(" ");

test("fixed chunks overlap and cover the whole text", () => {
  const doc = { id: "d", title: "D", text: words(1200) };
  const chunks = chunkFixed(doc, 512, 64);
  assert.ok(chunks.length >= 3);
  assert.deepEqual(chunks.map((c) => c.id), chunks.map((_, n) => `d::${n}`));
  assert.ok(chunks.every((c) => countTokens(c.body) <= 512));
  // the next window starts 64 tokens before this one ends
  const tokens = encode(doc.text);
  assert.equal(chunks[1].body, decode(tokens.slice(448, 960)));
});

test("heading chunks start with their breadcrumb and cut at headings", () => {
  const text = `# Postgres failover\n\nIntro ${words(90)}\n\n## Procedure\n\n### 3. Check lag\n\n${words(90)}\n\n### 4. Pause writes\n\nRun flagctl set feeds.writes_paused true. ${words(90)}\n\n### 5. Switch over\n\n${words(90)}`;
  const chunks = chunkByHeadings({ id: "rb", title: "Postgres failover", text });
  const step4 = chunks.find((c) => c.body.includes("Pause writes"))!;
  assert.equal(step4.breadcrumb, "Postgres failover > Procedure > 4. Pause writes");
  assert.ok(step4.body.startsWith(`${step4.breadcrumb}\n\n`));
  assert.ok(!step4.body.includes("Switch over"), "a section stops at the next heading");
  assert.equal(text.slice(step4.start, step4.end).trim(), step4.body.slice(step4.breadcrumb.length + 2));
});

test("small leaf sections merge forward, keeping the shallower breadcrumb", () => {
  const text = `# T\n\n## A\n\nshort.\n\n## B\n\n${words(120)}`;
  const chunks = chunkByHeadings({ id: "t", title: "T", text });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].breadcrumb, "T");
});

test("a long section splits at blank lines, never inside a code fence", () => {
  const fence = "```\n" + Array.from({ length: 25 }, (_, i) => `kubectl get pods # ${words(6, "c" + i)}`).join("\n\n") + "\n```";
  const text = `# T\n\n## Steps\n\n${words(200)}\n\n${fence}\n\n${words(200)}`;
  const chunks = chunkByHeadings({ id: "t", title: "T", text });
  assert.ok(chunks.length > 1, "the section was split");
  for (const c of chunks) assert.equal((c.body.match(/```/g) ?? []).length % 2, 0, "every chunk opens and closes its fences");
});

test("sections ignore headings inside code fences and use GitHub anchors", () => {
  const text = "# T\n\n## Rolling back a `Deployment`\n\n```\n# not a heading\n```\n\n## Next {#custom}\n";
  const s = sectionsOf({ text });
  assert.deepEqual(s.map((x) => x.slug), ["", "rolling-back-a-deployment", "custom"]);
  assert.equal(slugify("4. Pause writes"), "4-pause-writes");
});
