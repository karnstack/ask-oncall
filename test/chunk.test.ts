import { test } from "node:test";
import assert from "node:assert/strict";
import { decode, encode } from "gpt-tokenizer/encoding/cl100k_base";
import { chunkFixed, countTokens, sectionsOf, slugify } from "../src/chunk.ts";

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

test("sections ignore headings inside code fences and use GitHub anchors", () => {
  const text = "# T\n\n## Rolling back a `Deployment`\n\n```\n# not a heading\n```\n\n## Next {#custom}\n";
  const s = sectionsOf({ text });
  assert.deepEqual(s.map((x) => x.slug), ["", "rolling-back-a-deployment", "custom"]);
  assert.equal(slugify("4. Pause writes"), "4-pause-writes");
});
