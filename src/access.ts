// Who may read what. A document lists the principals allowed to read it
// (allowed_groups, copied onto every chunk); an asker is expanded into their
// principals; search keeps a chunk only when the two lists share one.
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
