// The assistant over HTTP, with node:http and nothing else.
//   POST /ask           {"question": "..."}
//   npm run serve       (PORT, default 8787)
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ask } from "./ask.ts";

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
    const { question } = JSON.parse(await readBody(req));
    if (typeof question !== "string") return send(res, 400, { error: "question is required" });
    const r = await ask(question);
    const body = {
      answer: r.text,
      sources: r.sources.map((s, i) => ({ n: i + 1, id: s.id, title: s.title, url: s.url, breadcrumb: s.breadcrumb })),
      ms: r.ms,
    };
    return send(res, 200, body);
  }

  send(res, 404, { error: "not found" });
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8787);
  createServer((req, res) => route(req, res).catch((e) => send(res, 500, { error: String(e?.message ?? e) }))).listen(port, () =>
    console.log(`ask-oncall on http://127.0.0.1:${port} (POST /ask)`),
  );
}
