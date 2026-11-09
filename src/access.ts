// Who may read what. A document lists the principals allowed to read it
// (allowed_groups, copied onto every chunk); an asker is expanded into their
// principals; search keeps a chunk only when the two lists share one.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type User = { handle: string; groups: string[] };

// identity.json stands in for the identity source (Okta, Google, Slack).
export function loadUsers(): Map<string, User> {
  const identity = JSON.parse(readFileSync(join(import.meta.dirname, "..", "identity.json"), "utf8"));
  return new Map(identity.users.map((u: User) => [u.handle, { handle: u.handle, groups: u.groups }]));
}

export function userByHandle(handle: string): User {
  const user = loadUsers().get(handle);
  if (!user) throw new Error(`unknown handle ${handle}: see identity.json`);
  return user;
}

export function principalsOf(user: User): string[] {
  return ["everyone", `user:${user.handle}`, ...user.groups]; // groups from the identity source
}

// Every cache that holds document text is a permission boundary. Its key
// carries the asker's scope (a hash of the sorted principals) and the index
// version, so one user's answer is never served to another, and a delete or
// a permission change makes every older entry miss.
export const normalizeQuestion = (q: string) => q.toLowerCase().replace(/\s+/g, " ").trim();
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const principalsHash = (principals: string[]) => sha256([...principals].sort().join("\n")).slice(0, 16);

export function cacheKey(question: string, principals: string[], indexVersion: number): string {
  return sha256(`${principalsHash(principals)}\n${indexVersion}\n${normalizeQuestion(question)}`);
}
