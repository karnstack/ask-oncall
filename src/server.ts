// The assistant over HTTP, with node:http and nothing else.
//   POST /ask           {"question": "...", "asker": "tw", "thread": ["..."], "scope": "payouts"}
//   POST /slack/events  Slack's Events API: message events become index updates
//   npm run serve       (PORT, default 8787; SLACK_SIGNING_SECRET for /slack/events)
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { cacheKey, principalsOf, userByHandle } from "./access.ts";
import { ask } from "./ask.ts";
import { handleSlackMessage, type SlackMessageEvent } from "./events.ts";
import { indexVersion } from "./sync.ts";

// Slack signs every request: v0=hmac_sha256(secret, "v0:{timestamp}:{body}").
// Reject a bad signature, and anything older than five minutes (a replay).
export function verifySlackSignature(secret: string, timestamp: string, body: string, signature: string, nowSec = Date.now() / 1000) {
  if (!timestamp || Math.abs(nowSec - Number(timestamp)) > 300) return false;
  const expected = "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex");
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// An answer cache is the riskiest cache: it holds document text. Its key
// carries the asker's principals and the index version (access.ts).
const ANSWER_TTL_MS = 10 * 60_000;
const answers = new Map<string, { at: number; body: unknown }>();

async function readBody(req: IncomingMessage) {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(part as Buffer);
  return Buffer.concat(parts).toString("utf8");
}

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

async function route(req: IncomingMessage, res: ServerResponse) {
  if (req.method === "GET" && req.url === "/healthz") return send(res, 200, { ok: true });

  if (req.method === "POST" && req.url === "/ask") {
    const { question, asker, thread, scope } = JSON.parse(await readBody(req));
    if (typeof question !== "string" || typeof asker !== "string") return send(res, 400, { error: "question and asker are required" });
    const key = cacheKey([...(thread ?? []), question].join("\n"), principalsOf(userByHandle(asker)), await indexVersion());
    const hit = answers.get(key);
    if (hit && Date.now() - hit.at < ANSWER_TTL_MS) return send(res, 200, { ...(hit.body as object), cached: true });
    const r = await ask(question, { asker, thread, scope });
    const body = {
      answer: r.text,
      searched: r.searched,
      sources: r.sources.map((s, i) => ({ n: i + 1, id: s.id, title: s.title, version: s.version, updatedAt: s.updatedAt, url: s.url, breadcrumb: s.breadcrumb })),
      checks: r.checks,
      ms: r.ms,
    };
    answers.set(key, { at: Date.now(), body });
    return send(res, 200, body);
  }

  if (req.method === "POST" && req.url === "/slack/events") {
    const body = await readBody(req);
    const secret = process.env.SLACK_SIGNING_SECRET;
    if (!secret) return send(res, 503, { error: "SLACK_SIGNING_SECRET is not set" });
    const ok = verifySlackSignature(secret, String(req.headers["x-slack-request-timestamp"] ?? ""), body, String(req.headers["x-slack-signature"] ?? ""));
    if (!ok) return send(res, 401, { error: "bad signature" });
    const payload = JSON.parse(body);
    if (payload.type === "url_verification") return send(res, 200, { challenge: payload.challenge });
    const event = payload.event as SlackMessageEvent & { subtype?: string; username?: string };
    if (payload.type === "event_callback" && event?.type === "message" && (!event.subtype || event.subtype === "bot_message"))
      await handleSlackMessage({ ...event, user: event.user ?? event.username ?? "bot" });
    return send(res, 200, { ok: true }); // answer within three seconds; indexing happens after the debounce
  }

  send(res, 404, { error: "not found" });
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8787);
  createServer((req, res) => route(req, res).catch((e) => send(res, 500, { error: String(e?.message ?? e) }))).listen(port, () =>
    console.log(`ask-oncall on http://127.0.0.1:${port} (POST /ask, POST /slack/events)`),
  );
}
