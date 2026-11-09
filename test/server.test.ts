import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySlackSignature } from "../src/server.ts";

const sign = (secret: string, ts: string, body: string) => "v0=" + createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex");

test("a Slack request signed with the secret passes", () => {
  const body = '{"type":"event_callback"}';
  assert.ok(verifySlackSignature("s3cret", "1792985464", body, sign("s3cret", "1792985464", body), 1792985470));
});

test("a wrong secret, a changed body or an old timestamp fails", () => {
  const body = '{"type":"event_callback"}';
  const sig = sign("s3cret", "1792985464", body);
  assert.ok(!verifySlackSignature("other", "1792985464", body, sig, 1792985470));
  assert.ok(!verifySlackSignature("s3cret", "1792985464", body + " ", sig, 1792985470));
  assert.ok(!verifySlackSignature("s3cret", "1792985464", body, sig, 1792985464 + 301), "older than five minutes is a replay");
});
