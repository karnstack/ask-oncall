// Loaders: every source becomes a Doc (id, title, url, the text we index, and
// the front matter the index filters on). Nothing here calls a model.
//   corpus/k8s-docs        Kubernetes docs, Hugo Markdown (CC BY 4.0)
//   corpus/prom-runbooks   prometheus-operator alert runbooks (Apache-2.0)
//   corpus/castlane        Castlane's own documents and Slack channel days
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";

export const CORPUS = join(import.meta.dirname, "..", "corpus");

export type Meta = {
  type: string;
  service: string[];
  scope: string | null;
  allowedGroups: string[]; // principals: groups, or user:<handle> for a restricted channel's members
  author: string | null;
  version: number | null;
  effectiveAt: string | null;
  supersededBy: string | null;
  isCurrent: boolean;
  deletedAt: string | null;
  updatedAt: string | null;
};

export type Msg = { ts: string; user: string; text: string; replies?: Msg[] };

export type Doc = {
  id: string;
  source: string; // k8s-docs, prom-runbooks, runbooks, postmortems, adr, slack, wiki-export-2024, ...
  title: string;
  url: string;
  text: string; // what gets chunked: cleaned Markdown, or a flattened Slack day
  meta: Meta;
  createdAt?: string; // Castlane: when the document first existed (for replays)
  messages?: Msg[]; // Slack channel days
};

const PUBLIC_META: Meta = {
  type: "doc", service: [], scope: null, allowedGroups: ["everyone"], author: null,
  version: null, effectiveAt: null, supersededBy: null, isCurrent: true, deletedAt: null, updatedAt: null,
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n?/;

// ---- Kubernetes docs --------------------------------------------------------

// The docs site fills {{< skew currentVersion >}} and friends from hugo.toml.
const SKEW: Record<string, string> = {
  currentVersion: "1.37",
  latestVersion: "1.37",
  currentPatchVersion: "1.37.0",
  currentVersionAddMinor: "1.38",
  nextMinorVersion: "1.38",
  prevMinorVersion: "1.36",
};
const HEADINGS: Record<string, string> = {
  prerequisites: "Before you begin",
  whatsnext: "What's next",
  cleanup: "Cleaning up",
  objectives: "Objectives",
  examples: "Examples",
  options: "Options",
  parentoptions: "Options inherited from parent commands",
  seealso: "See also",
  synopsis: "Synopsis",
  envvars: "Environment variables",
};

// Render Hugo shortcodes to the text a reader of kubernetes.io would see.
// One form, feature-state with only a gate name, reads its version from a data
// file at site build time; without the build it renders "Kubernetes []".
export function cleanHugo(md: string): string {
  return md
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\{\{<\s*glossary_tooltip([^>]*)>\}\}/g, (_, args: string) => {
      const text = /text="([^"]*)"/.exec(args)?.[1];
      const term = /term_id="([^"]*)"/.exec(args)?.[1] ?? "";
      return text ?? term.replace(/-/g, " ");
    })
    .replace(/\{\{<\s*feature-state([^>]*)>\}\}/g, (_, args: string) => {
      const v = /for_k8s_version="([^"]*)"/.exec(args)?.[1];
      const s = /state="([^"]*)"/.exec(args)?.[1];
      const gate = /feature_gate_name="([^"]*)"/.exec(args)?.[1];
      return `FEATURE STATE: Kubernetes ${v ?? ""} [${s ?? ""}]${gate ? ` (feature gate ${gate})` : ""}`;
    })
    .replace(/\{\{%\s*heading\s+"([a-z]+)"\s*%\}\}/g, (_, h: string) => HEADINGS[h] ?? h)
    .replace(/\{\{<\s*skew\s+([a-zA-Z]+)[^>]*>\}\}/g, (_, k: string) => SKEW[k] ?? "1.37")
    .replace(/\{\{[<%]\s*(?:ref|relref)\s+"([^"]*)"\s*[>%]\}\}/g, "$1")
    .replace(/\{\{[<%]\s*code_sample[^}]*file="([^"]*)"[^}]*[>%]\}\}/g, "(example manifest: $1)")
    .replace(/\{\{[<%]\s*param\s+"([^"]*)"\s*[>%]\}\}/g, "$1")
    .replace(/\{\{[<%][^}]*[>%]\}\}/g, "") // any other shortcode: drop the tag, keep its inner text
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// A feature gate's lifecycle lives only in its front matter. Write it out as
// text, or "is X GA?" has no answer in the index.
type Stage = { stage: string; defaultValue?: boolean; fromVersion?: string; toVersion?: string; locked?: boolean };
function featureGateText(title: string, fm: Record<string, any>): string {
  const stages: Stage[] = fm.stages ?? [];
  const lines = stages.map(
    (s) =>
      `- ${s.stage}: default ${s.defaultValue ? "true" : "false"}, from ${s.fromVersion ?? "?"}` +
      `${s.toVersion ? ` to ${s.toVersion}` : " onwards"}${s.locked ? " (locked)" : ""}`,
  );
  const removed = fm.removed ? `\nThis feature gate was removed.` : "";
  return `Feature gate \`${title}\`.\n\nStages:\n${lines.join("\n")}${removed}\n\n`;
}

export function loadKubernetesDocs(root = join(CORPUS, "k8s-docs")): Doc[] {
  const docs: Doc[] = [];
  for (const file of walk(root).filter((f) => f.endsWith(".md"))) {
    let id = relative(root, file).replace(/\.md$/, "").replace(/(^|\/)_?index$/, "");
    if (id === "") id = "home";
    const raw = readFileSync(file, "utf8");
    const m = FRONT_MATTER.exec(raw);
    let fm: Record<string, any> = {};
    try {
      fm = m ? (parseYaml(m[1]) ?? {}) : {};
    } catch {
      fm = {};
    }
    const title = String(fm.title ?? fm.linktitle ?? id.split("/").pop());
    let body = cleanHugo(m ? raw.slice(m[0].length) : raw);
    if (fm.content_type === "feature_gate") body = featureGateText(title, fm) + body;
    // glossary entries keep their definition in front matter
    if (fm.short_description && !body.includes(String(fm.short_description).slice(0, 30)))
      body = String(fm.short_description).trim() + "\n\n" + body;
    const text = `# ${title}\n\n${body}`.trim();
    if (text.length < 40) continue; // empty section index pages
    docs.push({ id, source: "k8s-docs", title, url: `https://kubernetes.io/docs/${id}/`, text, meta: PUBLIC_META });
  }
  return docs;
}

// ---- prometheus-operator alert runbooks -------------------------------------

export function loadAlertRunbooks(root = join(CORPUS, "prom-runbooks")): Doc[] {
  return walk(root)
    .filter((f) => f.endsWith(".md") && !f.endsWith("_index.md"))
    .map((file) => {
      const rel = relative(root, file).replace(/\.md$/, ""); // kubernetes/KubePodCrashLooping
      const raw = readFileSync(file, "utf8");
      const m = FRONT_MATTER.exec(raw);
      const body = cleanHugo(m ? raw.slice(m[0].length) : raw);
      const alert = rel.split("/").pop()!;
      const text = body.startsWith("# ") ? body : `# ${alert}\n\n${body}`;
      return {
        id: `runbooks/${rel}`,
        source: "prom-runbooks",
        title: alert,
        url: `https://runbooks.prometheus-operator.dev/runbooks/${rel.toLowerCase()}/`,
        text,
        meta: { ...PUBLIC_META, type: "alert-runbook" },
      };
    });
}

// ---- Castlane ---------------------------------------------------------------

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);
const hhmmss = (ts: string) => new Date(Number(ts.split(".")[0]) * 1000).toISOString().slice(11, 19);
const tsIso = (ts: string) => new Date(Number(ts.split(".")[0]) * 1000).toISOString();

// Front matter becomes columns: the deletes, versions and permissions code
// filters on these, so a loader that drops them loses more than text.
function metaOf(fm: Record<string, any>): Meta {
  return {
    type: String(fm.type),
    service: list(fm.service),
    scope: fm.scope ?? null,
    allowedGroups: list(fm.allowed_groups),
    author: fm.author ?? null,
    version: fm.version == null ? null : Number(fm.version),
    effectiveAt: fm.effective_at == null ? null : String(fm.effective_at),
    supersededBy: fm.superseded_by ?? null,
    isCurrent: fm.is_current === true,
    deletedAt: fm.deleted_at ? String(fm.deleted_at) : null,
    updatedAt: fm.updated_at ? String(fm.updated_at) : null,
  };
}

// A Slack channel day as text: one "HH:MM:SS user: text" line per message,
// replies indented under their parent.
export function flattenSlack(title: string, messages: Msg[]): string {
  const lines = [`# ${title}`];
  for (const m of messages) {
    lines.push(`${hhmmss(m.ts)} ${m.user}: ${m.text}`);
    for (const r of m.replies ?? []) lines.push(`  ${hhmmss(r.ts)} ${r.user}: ${r.text}`);
  }
  return lines.join("\n");
}

export type TimelineEvent = { at: string; event: string; doc?: string; [k: string]: unknown };
export const loadTimeline = (): TimelineEvent[] =>
  readFileSync(join(import.meta.dirname, "..", "events", "timeline.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

// Every Castlane file. The folder is the union of everything that ever
// existed, so deleted documents are here too, with deletedAt set.
export function loadCastlane(root = join(CORPUS, "castlane")): Doc[] {
  const created = new Map<string, string>();
  for (const e of loadTimeline()) if (e.doc && e.event === "doc_created" && !created.has(e.doc)) created.set(e.doc, e.at);
  return walk(root)
    .filter((f) => f.endsWith(".md") || f.endsWith(".json"))
    .map((file) => {
      const raw = readFileSync(file, "utf8");
      if (file.endsWith(".json")) {
        const { messages, ...fm } = JSON.parse(raw);
        return {
          id: fm.id, source: fm.source, title: fm.title, url: fm.url,
          text: flattenSlack(fm.title, messages), meta: metaOf(fm), messages, createdAt: tsIso(messages[0].ts),
        };
      }
      const m = FRONT_MATTER.exec(raw)!;
      const fm = parseYaml(m[1]);
      const meta = metaOf(fm);
      return {
        id: fm.id, source: fm.source, title: fm.title, url: fm.url,
        text: raw.slice(m[0].length).trim(), meta, createdAt: created.get(fm.id) ?? `${meta.effectiveAt}T00:00:00Z`,
      };
    });
}

// Castlane as it stood at time `at`: created by then and not yet deleted,
// Slack days cut to the messages posted by then, and "current" recomputed
// from the supersede events that had happened (events/timeline.jsonl).
export function castlaneAsOf(at: string): Doc[] {
  const t = Date.parse(at);
  const superseded = new Map<string, string>();
  for (const e of loadTimeline()) if (e.event === "doc_superseded" && e.doc) superseded.set(e.doc, e.at);
  const out: Doc[] = [];
  for (const d of loadCastlane()) {
    if (Date.parse(d.createdAt!) > t) continue;
    if (d.meta.deletedAt && Date.parse(d.meta.deletedAt) <= t) continue;
    const supAt = superseded.get(d.id);
    const wasSuperseded = !!supAt && Date.parse(supAt) <= t;
    const meta = { ...d.meta, deletedAt: null, isCurrent: !wasSuperseded, supersededBy: wasSuperseded ? d.meta.supersededBy : null };
    if (d.messages) {
      const kept = d.messages
        .filter((m) => Number(m.ts) * 1000 <= t)
        .map((m) => ({ ...m, replies: (m.replies ?? []).filter((r) => Number(r.ts) * 1000 <= t) }));
      if (!kept.length) continue;
      out.push({ ...d, meta, messages: kept, text: flattenSlack(d.title, kept) });
    } else out.push({ ...d, meta });
  }
  return out;
}

// Today's documents: the public docs and every Castlane document not deleted.
export function loadCorpus(): Doc[] {
  return [...loadKubernetesDocs(), ...loadAlertRunbooks(), ...loadCastlane().filter((d) => !d.meta.deletedAt)];
}
