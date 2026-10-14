/**
 * A fake ChatGPT/Codex backend (`POST <base>/codex/responses`, SSE) so the
 * real `openai-codex` provider code in Pi runs end to end with no login and
 * no network: it records every request (headers + decoded body) and answers
 * with scripted Responses-API events.
 *
 * Script steps: `{ text }` streams a message; `{ call: name, args }` asks for
 * one function call; `{ hangMs }` streams one delta then stalls (for cancel).
 */
import http from "node:http";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";

export type Step =
  | { text: string; cached?: number }
  | { call: string; args: Record<string, unknown>; cached?: number }
  | { hangMs: number };

export interface Recorded {
  headers: http.IncomingHttpHeaders;
  body: {
    model: string;
    instructions: string;
    input: unknown[];
    tools?: { name: string }[];
    prompt_cache_key?: string;
    [k: string]: unknown;
  };
}

export interface FakeCodex {
  baseUrl: string;
  requests: Recorded[];
  script: Step[];
  close(): Promise<void>;
}

/** A JWT-shaped token carrying the claim Pi reads the ChatGPT account id from. */
export function fakeChatGptToken(): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return [
    b64({ alg: "none" }),
    b64({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-fake" }, exp: 4102444800 }),
    "sig",
  ].join(".");
}

export async function startFakeCodex(): Promise<FakeCodex> {
  const requests: Recorded[] = [];
  const script: Step[] = [];
  let n = 0;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      let raw = Buffer.concat(chunks);
      if (req.headers["content-encoding"] === "zstd") raw = zlib.zstdDecompressSync(raw);
      const body = JSON.parse(raw.toString("utf8")) as Recorded["body"];
      requests.push({ headers: req.headers, body });
      const step = script.shift() ?? { text: "ok" };
      const inputTokens = Math.ceil(raw.length / 4);
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
      const id = `resp_${++n}`;
      send({ type: "response.created", response: { id } });
      const complete = (cached: number) =>
        send({
          type: "response.completed",
          response: {
            id,
            status: "completed",
            usage: {
              input_tokens: inputTokens,
              input_tokens_details: { cached_tokens: Math.min(cached, inputTokens) },
              output_tokens: 7,
              output_tokens_details: { reasoning_tokens: 2 },
              total_tokens: inputTokens + 7,
            },
          },
        });
      if ("hangMs" in step) {
        send({ type: "response.output_item.added", output_index: 0, item: { type: "message", id: "m1", content: [] } });
        send({ type: "response.output_text.delta", output_index: 0, delta: "partial " });
        const t = setTimeout(() => res.end(), step.hangMs);
        res.on("close", () => clearTimeout(t));
        return;
      }
      if ("call" in step) {
        const item = { type: "function_call", id: `fc_${n}`, call_id: `call_${n}`, name: step.call, arguments: JSON.stringify(step.args) };
        send({ type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "" } });
        send({ type: "response.output_item.done", output_index: 0, item });
        complete(step.cached ?? 0);
        res.end();
        return;
      }
      const msg = { type: "message", id: `msg_${n}`, role: "assistant", content: [{ type: "output_text", text: step.text }] };
      send({ type: "response.output_item.added", output_index: 0, item: { ...msg, content: [] } });
      for (const part of step.text.match(/.{1,8}/gs) ?? []) {
        send({ type: "response.output_text.delta", output_index: 0, delta: part });
      }
      send({ type: "response.output_item.done", output_index: 0, item: msg });
      complete(step.cached ?? 0);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/backend-api`,
    requests,
    script,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
