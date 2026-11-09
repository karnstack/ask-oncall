// Does the corpus fit in the answer model's window? Count it with the answer
// model's own tokenizer (o200k) before you pay to find out.
//   node tools/count-tokens.ts
import { countTokens } from "gpt-tokenizer/encoding/o200k_base";
import { loadCorpus } from "../src/corpus.ts";

const docs = loadCorpus();
const tokens = docs.reduce((sum, d) => sum + countTokens(d.text), 0);
const castlane = docs.filter((d) => !["k8s-docs", "prom-runbooks"].includes(d.source)).reduce((sum, d) => sum + countTokens(d.text), 0);
console.log(`${docs.length} documents, ${tokens.toLocaleString()} tokens (Castlane ${castlane.toLocaleString()}); a 400,000-token window holds ${(400_000 / tokens).toFixed(2)} of it`);
