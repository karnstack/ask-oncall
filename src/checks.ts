// Checks in code, run on every answer. They prove presence, not meaning: a
// true quote from the right page can still be the wrong answer.
//   citation  every [n] points at a source that was sent
//   quote     every quoted span appears verbatim in the sources that were sent
//   link      every URL in the answer is a sent source's URL
//   not found the fixed sentence, detected, never treated as an error
import { NOT_FOUND } from "./answer.ts";

type Sent = { title: string; url: string; body: string };

const norm = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

// Quoted spans: each line of a code block, each `inline code`, and each
// "double-quoted" phrase of 12 characters or more.
export function quotedSpans(text: string): string[] {
  const spans: string[] = [];
  for (const m of text.matchAll(/```[a-z]*\n?([\s\S]*?)```/g))
    spans.push(...m[1].split("\n").map((l) => l.trim()).filter((l) => l.length > 3));
  const noFence = text.replace(/```[\s\S]*?```/g, " ");
  for (const m of noFence.matchAll(/`([^`\n]+)`/g)) spans.push(m[1]);
  const prose = noFence.replace(/`[^`\n]*`/g, " ");
  for (const m of prose.matchAll(/["“]([^"”\n]{12,})["”]/g)) spans.push(m[1]);
  return spans;
}

export function checkAnswer(text: string, sources: Sent[]) {
  const citations = [...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const badCitations = citations.filter((n) => n < 1 || n > sources.length);
  const spans = quotedSpans(text);
  const sent = sources.map((s) => norm(s.body)).join("\n");
  const unverifiedQuotes = spans.filter((s) => !sent.includes(norm(s)));
  const links = [...text.matchAll(/https?:\/\/[^\s)\]>`"]+/g)].map((m) => m[0].replace(/[.,;]$/, ""));
  const strip = (u: string) => u.replace(/\/$/, "");
  const foreignLinks = links.filter((u) => !sources.some((s) => strip(s.url) === strip(u)));
  return { citations: citations.length, badCitations, quotes: spans.length, unverifiedQuotes, foreignLinks, notFound: isNotFound(text) };
}

export type Checks = ReturnType<typeof checkAnswer>;
export const passed = (c: Checks) => !c.badCitations.length && !c.unverifiedQuotes.length && !c.foreignLinks.length;

// What the engineer sees under a claim: the sentence in the source that holds
// the quoted span, so "Until 2026-10-28 this runbook said ..." is visible.
export function citedSentence(body: string, span: string): string | null {
  const flat = norm(body);
  const at = flat.indexOf(norm(span));
  if (at < 0) return null;
  const before = flat.lastIndexOf(". ", at);
  const start = before < 0 ? 0 : before + 2;
  const stop = flat.indexOf(". ", at + span.length);
  return flat.slice(start, stop < 0 ? undefined : stop + 1).trim();
}

// ---- not found ----------------------------------------------------------------

export const isNotFound = (text: string) => text.includes(NOT_FOUND);

// The cheap guard: when the reranker keeps nothing, skip the answer model.
// The nearest titles come from the asker's own filtered candidates, never an
// unfiltered list, or "not found" names documents the asker may not read.
export const notFoundAnswer = (nearest: { title: string }[]) =>
  `${NOT_FOUND}. Nearest: ${[...new Set(nearest.map((s) => s.title))].slice(0, 3).join("; ")}.`;
