/**
 * The bundled demo (fixtures/urllib3-5020) as the service would present it
 * to an agent: the real L0 instructions, the real base pack, an Ask/Explain
 * prompt from the real template, and the real `McpRegistry` review tools
 * served over loopback HTTP on a random port.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { McpRegistry } from "../../../packages/service/src/mcp/registry.ts";
import { StoreReviewReader } from "../../../packages/service/src/mcp/reviewReader.ts";
import { toPromptSnapshot } from "../../../packages/service/src/routes/prompts.ts";
import { buildBasePack } from "../../../packages/service/src/context/index.ts";
import { loadTemplatesDirSync, renderTemplate } from "../../../packages/service/src/prompts/index.ts";
import type { ReviewStore } from "../../../packages/service/src/state/store.ts";
import type { CommandRunner } from "../../../packages/service/src/exec/runner.ts";
import type { McpServerConfig } from "../../../packages/shared/src/agent.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURE = path.join(ROOT, "fixtures", "urllib3-5020");

export interface Demo {
  reviewId: string;
  systemPrompt: string;
  /** The base pack message, as `ensureBase` sends it. */
  pack: string;
  /** An Explain on the first guide card's first paragraph. */
  explain: string;
  /** A free-form Ask that needs a review tool. */
  ask: string;
  /** Issue one MCP server (one secret) for a session, like the pipeline does. */
  mcpFor(sessionLabel: string): McpServerConfig[];
  toolCalls(): number;
  close(): Promise<void>;
}

export async function startDemo(): Promise<Demo> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = JSON.parse(fs.readFileSync(path.join(FIXTURE, "snapshot.json"), "utf8")) as any;
  const reviewId: string = snap.review.id;
  const reader = new StoreReviewReader({
    reviews: { getSnapshot: () => snap } as unknown as ReviewStore,
    dataDir: path.join(ROOT, "spikes", "pi-runner", "scratch", "data"),
  });
  const commands: CommandRunner = {
    run: async () => ({ code: 1, stdout: "", stderr: "no git in the spike harness" }) as never,
  };
  const registry = new McpRegistry({ reader, commands });

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const secret = (req.url ?? "").split("/").pop() ?? "";
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? (JSON.parse(raw) as unknown) : undefined;
      registry.handleRequest(secret, req, res, body).catch((err: unknown) => {
        res.statusCode = 500;
        res.end(String(err));
      });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  const issued: string[] = [];

  const lib = loadTemplatesDirSync(path.join(ROOT, "prompts"));
  const systemPrompt = renderTemplate(lib.get("instructions")!, {});
  const promptSnap = toPromptSnapshot(snap, { model: "gpt-6.1-sol" });
  const base = buildBasePack(promptSnap, systemPrompt);
  const pack = `Read the base context below and reply with exactly \`ready\` and nothing else.\n\n${base.user}`;

  const card = snap.pages.find((p: { kind: string }) => p.kind === "root").cards[0];
  const para = card.blocks.find((b: { type: string }) => b.type === "paragraph");
  const quote: string = para.text.standard.replace(/<[^>]+>/g, "").slice(0, 120);
  const askValues = (message: string) => ({
    anchor: { quote, block: para.text.standard },
    card: `${card.id}: ${card.title ?? ""}`,
    thread: "(none)",
    change_list: "(none)",
    message,
  });
  const explain = renderTemplate(lib.get("ask")!, askValues("Explain this."));
  const ask = renderTemplate(
    lib.get("ask")!,
    askValues("Which test hunk exercises this? Fetch it with get_hunk and cite it."),
  );

  return {
    reviewId,
    systemPrompt,
    pack,
    explain,
    ask,
    mcpFor(label) {
      const s = registry.issueSession(reviewId, label, "session");
      issued.push(s.secret);
      return [{ name: "unvibe", url: `http://127.0.0.1:${port}${s.path}` }];
    },
    toolCalls: () => registry.activitySnapshot(reviewId).toolCalls,
    close: () =>
      new Promise<void>((r) => {
        for (const s of issued) registry.revokeSession(s);
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
