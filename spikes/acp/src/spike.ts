/**
 * M0 ACP spike runner — one script for BOTH adapters.
 *
 * Usage:
 *   npx tsx src/spike.ts claude   # @agentclientprotocol/claude-agent-acp
 *   npx tsx src/spike.ts codex    # @agentclientprotocol/codex-acp
 *
 * Runs all 8 checks in one adapter process + one local HTTP MCP server,
 * writes results JSON to results/<adapter>-<ts>.json and prints a log.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SpikeClient, fmtUsage, cacheShare } from "./acp-client.js";
import { startMcpServer } from "./mcp-server.js";
import { buildPack, basePackMessage } from "./pack.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPIKE_ROOT = join(HERE, "..");
const RESULTS = join(SPIKE_ROOT, "results");

const ADAPTERS = {
  claude: {
    pkg: "@agentclientprotocol/claude-agent-acp",
    version: "0.89.0",
    supportsSystemPromptMeta: true, // _meta.systemPrompt (string|preset-object)
  },
  codex: {
    pkg: "@agentclientprotocol/codex-acp",
    version: "2.2.2",
    supportsSystemPromptMeta: false, // unknown; we send it anyway and observe
  },
} as const;

type AdapterName = keyof typeof ADAPTERS;

const CODENAME = "QUOKKA-7";
const SYSTEM_PROMPT = [
  `Your codename for this session is ${CODENAME}.`,
  "You are a read-only code reviewer. Never edit files, never run shell commands.",
  "You may only read the provided context and call the provided MCP tools.",
  "When asked for your codename, reply with just the codename and nothing else.",
].join(" ");

interface CheckResult {
  check: string;
  pass: boolean;
  evidence: string;
}

const results: CheckResult[] = [];
const logLines: string[] = [];
function log(s = ""): void {
  logLines.push(s);
  console.log(s);
}
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ check: name, pass, evidence });
  log(`${pass ? "PASS" : "FAIL"}  ${name}\n      -> ${evidence}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function usageLine(prefix: string, resp: any, usageUpdates: unknown[]): string {
  const u = resp?.usage;
  return (
    `${prefix} stop=${resp?.stopReason} usage=[${fmtUsage(u)}] ` +
    `cacheShare=${cacheShare(u)} ` +
    `_metaKeys=${resp?._meta ? Object.keys(resp._meta).join(",") : "-"} ` +
    `usage_updates=${usageUpdates.length}` +
    (usageUpdates.length > 0
      ? ` first=${JSON.stringify(usageUpdates[0]).slice(0, 300)}`
      : "")
  );
}

async function main(): Promise<void> {
  const adapter = (process.argv[2] ?? "claude") as AdapterName;
  if (!(adapter in ADAPTERS)) throw new Error(`unknown adapter: ${adapter}`);
  const info = ADAPTERS[adapter];
  const startedAt = new Date().toISOString();

  log(`M0 ACP spike: adapter=${adapter} pkg=${info.pkg}@${info.version} at=${startedAt}`);

  const pack = buildPack();
  log(
    `pack: lines=${pack.lines} approxTokens=${pack.approxTokens} bytes=${pack.bytes}`,
  );
  for (const f of pack.facts) {
    log(`  fact ${f.id} at line ${f.line}: q=${f.question}`);
  }

  const mcp = await startMcpServer();
  log(`mcp server: ${mcp.url}`);

  // Allow get_hunk, deny everything else. Record decisions.
  const allowedTools: string[] = [];
  const client = new SpikeClient(async (req) => {
    const title = `${req.title}`;
    if (/get_hunk/i.test(title)) {
      const allow = req.options.find((o) => /allow/i.test(o.kind + " " + o.name));
      allowedTools.push(title);
      if (allow) return { optionId: allow.optionId };
      return { cancelled: true };
    }
    const reject = req.options.find((o) => /reject|deny/i.test(o.kind + " " + o.name));
    if (reject) return { optionId: reject.optionId };
    return { cancelled: true };
  });

  const extraPath = [
    "/home/venky/.local/share/mise/installs/claude-code/latest",
    "/home/venky/.local/share/mise/installs/codex/latest/bin",
    "/home/venky/.local/bin",
  ].join(":");

  const summary: Record<string, unknown> = {
    adapter,
    pkg: info.pkg,
    version: info.version,
    startedAt,
    pack: {
      lines: pack.lines,
      approxTokens: pack.approxTokens,
      bytes: pack.bytes,
      facts: pack.facts,
    },
    mcpUrl: mcp.url,
    checks: results,
  };

  const finish = () => {
    mkdirSync(RESULTS, { recursive: true });
    const out = join(RESULTS, `${adapter}-${Date.now()}.json`);
    (summary as any).checks = results;
    (summary as any).mcpCalls = mcp.calls;
    writeFileSync(out, JSON.stringify(summary, null, 1));
    log(`results written to ${out}`);
  };

  const adapterStderr: string[] = [];

  try {
    await client.run(
      process.execPath,
      [`node_modules/${info.pkg}/dist/index.js`],
      { PATH: `${extraPath}:${process.env.PATH}`, NO_BROWSER: "1" },
      async (ctx: any) => {
        // ---- initialize ----
        const init = await ctx.request("initialize", {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        });
        (summary as any).initialize = init;
        log(`capabilities: ${JSON.stringify(init.agentCapabilities?.sessionCapabilities)} loadSession=${init.agentCapabilities?.loadSession} mcp=${JSON.stringify(init.agentCapabilities?.mcpCapabilities)}`);
        log(`authMethods: ${JSON.stringify((init.authMethods ?? []).map((m: any) => m.id))}`);

        const mcpServers = [{ type: "http", name: "unvibe-spike", url: mcp.url, headers: [] }];
        const cwd = SPIKE_ROOT;

        // ---- step 0: auth check with a tiny turn ----
        const tiny = await ctx.request("session/new", {
          cwd,
          mcpServers,
          _meta: { systemPrompt: SYSTEM_PROMPT },
        });
        const tinySession = tiny.sessionId as string;
        (summary as any).newSessionResponses = { tiny };
        log(`newSession modes=${JSON.stringify(tiny.modes)?.slice(0, 500)}`);
        log(`newSession configOptions=${JSON.stringify(tiny.configOptions)?.slice(0, 2000)}`);
        const pong = await client.prompt(ctx, tinySession, "Reply with exactly the word PONG and nothing else.");
        log(`tiny turn: text=${JSON.stringify(pong.text.slice(0, 200))} stop=${pong.response.stopReason}`);
        if (!/PONG/i.test(pong.text)) {
          check("0-auth-smoke", false, `expected PONG, got: ${pong.text.slice(0, 300)}`);
          throw new Error("auth smoke test failed; aborting before burning pack tokens");
        }
        check("0-auth-smoke", true, `tiny turn ok, stop=${pong.response.stopReason}, usage=[${fmtUsage(pong.response.usage)}]`);

        // ---- check 1a: system prompt ----
        const codeTurn = await client.prompt(
          ctx,
          tinySession,
          "What is your codename? Reply with just the codename and nothing else.",
        );
        const codeOk = codeTurn.text.includes(CODENAME);
        check(
          "1a-system-prompt",
          codeOk,
          `reply=${JSON.stringify(codeTurn.text.slice(0, 200))} (via ${adapter === "claude" ? "_meta.systemPrompt" : "_meta.systemPrompt (unsupported?, observing)"})`,
        );
        (summary as any).systemPromptTurn = {
          text: codeTurn.text.slice(0, 500),
          usage: codeTurn.response.usage,
        };

        // ---- check 1b: MCP tool ----
        const mcpTurn = await client.prompt(
          ctx,
          tinySession,
          "Call the get_hunk tool with id 'h:sp:abc123' and then reply with the exact string it returned, and nothing else.",
        );
        const sawCall = mcp.calls.some((c) => c.id === "h:sp:abc123");
        const echoed = mcpTurn.text.includes("alpha-bravo-42");
        check(
          "1b-mcp-tool",
          sawCall && echoed,
          `serverCalls=${JSON.stringify(mcp.calls)} reply=${JSON.stringify(mcpTurn.text.slice(0, 200))} toolCallsSeen=${JSON.stringify(mcpTurn.toolCalls).slice(0, 400)} perms=${mcpTurn.permissionRequests.length}`,
        );
        (summary as any).mcpTurn = {
          text: mcpTurn.text.slice(0, 500),
          toolCalls: mcpTurn.toolCalls,
          permissionRequests: mcpTurn.permissionRequests,
          usage: mcpTurn.response.usage,
        };
        await ctx.request("session/close", { sessionId: tinySession }).catch(() => {});

        // ---- check 2: base pack turn ----
        const base = await ctx.request("session/new", {
          cwd,
          mcpServers,
          _meta: { systemPrompt: SYSTEM_PROMPT },
        });
        const baseId = base.sessionId as string;
        log(`base session: ${baseId}`);
        const packMsg = basePackMessage(pack);
        const baseTurn = await client.prompt(ctx, baseId, packMsg, { timeoutMs: 900_000 });
        const readyOk = /^\W*READY\W*$/i.test(baseTurn.text.trim());
        check("2-base-pack", readyOk, `reply=${JSON.stringify(baseTurn.text.slice(0, 200))} elapsed=${baseTurn.elapsedMs}ms`);
        const baseUsageLine = usageLine("base", baseTurn.response, baseTurn.usageUpdates);
        log(baseUsageLine);
        (summary as any).base = {
          sessionId: baseId,
          reply: baseTurn.text.slice(0, 300),
          usage: baseTurn.response.usage,
          meta: baseTurn.response._meta,
          usageUpdates: baseTurn.usageUpdates,
          elapsedMs: baseTurn.elapsedMs,
          usageLine: baseUsageLine,
        };

        // ---- checks 3+4: fork twice, ask concurrently ----
        // NOTE (claude-agent-acp 0.89.0): session/fork returns a new id but the
        // adapter does not register a live session for it — prompting the fork
        // fails with "Session not found" until session/resume (or load) is
        // called on the forked id. attachFork() applies that workaround and
        // records whether it was needed.
        let resumeNeeded = false;
        const attachFork = async (forkId: string): Promise<string> => {
          try {
            await client.prompt(ctx, forkId, "Reply with exactly the word FORKED and nothing else.", { timeoutMs: 300_000 });
            return "direct-prompt-ok";
          } catch (e: any) {
            const msg = `${String(e)} ${JSON.stringify(e?.data ?? {})}`.slice(0, 500);
            if (/session not found/i.test(msg)) {
              await ctx.request("session/resume", { sessionId: forkId, cwd, mcpServers });
              resumeNeeded = true;
              return "needed-resume";
            }
            throw e;
          }
        };
        const fork1 = await ctx.request("session/fork", { sessionId: baseId, cwd });
        const fork2 = await ctx.request("session/fork", { sessionId: baseId, cwd });
        const fork1Id = fork1.sessionId as string;
        const fork2Id = fork2.sessionId as string;
        const forkedFresh = fork1Id !== baseId && fork2Id !== baseId && fork1Id !== fork2Id;
        check("3-fork", forkedFresh, `base=${baseId} fork1=${fork1Id} fork2=${fork2Id}`);
        (summary as any).forks = { fork1Id, fork2Id };
        const [attach1, attach2] = await Promise.all([attachFork(fork1Id), attachFork(fork2Id)]);
        log(`fork attach: fork1=${attach1} fork2=${attach2}`);
        (summary as any).forks.attach = { fork1: attach1, fork2: attach2 };

        const [f0, f3] = [pack.facts[0], pack.facts[3]];
        const q1 = `Using ONLY the change pack in our conversation, answer this question in one short sentence, with no tools: ${f0.question} The fact id is ${f0.id}.`;
        const q2 = `Using ONLY the change pack in our conversation, answer this question in one short sentence, with no tools: ${f3.question} The fact id is ${f3.id}.`;
        try {
          const [r1, r2] = await Promise.all([
            client.prompt(ctx, fork1Id, q1, { timeoutMs: 900_000 }),
            client.prompt(ctx, fork2Id, q2, { timeoutMs: 900_000 }),
          ]);
          const a1ok = r1.text.includes(f0.answerMustContain);
          const a2ok = r2.text.includes(f3.answerMustContain);
          check("4-fork-answers", a1ok && a2ok, `fork1 reply=${JSON.stringify(r1.text.slice(0, 200))} (need ${f0.answerMustContain}); fork2 reply=${JSON.stringify(r2.text.slice(0, 200))} (need ${f3.answerMustContain})`);
          const u1 = usageLine("fork1", r1.response, r1.usageUpdates);
          const u2 = usageLine("fork2", r2.response, r2.usageUpdates);
          log(u1);
          log(u2);
          (summary as any).forkTurns = {
            fork1: { reply: r1.text.slice(0, 500), usage: r1.response.usage, meta: r1.response._meta, usageUpdates: r1.usageUpdates, usageLine: u1 },
            fork2: { reply: r2.text.slice(0, 500), usage: r2.response.usage, meta: r2.response._meta, usageUpdates: r2.usageUpdates, usageLine: u2 },
          };
        } catch (e) {
          check("4-fork-answers", false, `prompt on fork threw: ${String(e).slice(0, 500)}`);
        }

        // ---- check 6: structured output reliability (10 replies on fork1) ----
        const schemaHint =
          'End your reply with one fenced json block (```json ... ```) matching this schema: {"title": string, "contribute": {"facts": string[]}}. ' +
          "Put nothing after the block.";
        let parsed = 0;
        const failures: string[] = [];
        const jsonQuestions = [
          `In one sentence: ${pack.facts[1].question} ${schemaHint} Set title to "ttl-1".`,
          `In one sentence: ${pack.facts[2].question} ${schemaHint} Set title to "ttl-2".`,
          `In one sentence: ${pack.facts[4].question} ${schemaHint} Set title to "ttl-3".`,
          `In one sentence: ${pack.facts[5].question} ${schemaHint} Set title to "ttl-4".`,
          `In one sentence: ${pack.facts[0].question} ${schemaHint} Set title to "ttl-5".`,
          `In one sentence: ${pack.facts[3].question} ${schemaHint} Set title to "ttl-6".`,
          `In one sentence: ${pack.facts[1].question} ${schemaHint} Set title to "ttl-7".`,
          `In one sentence: ${pack.facts[4].question} ${schemaHint} Set title to "ttl-8".`,
          `In one sentence: ${pack.facts[2].question} ${schemaHint} Set title to "ttl-9".`,
          `In one sentence: ${pack.facts[5].question} ${schemaHint} Set title to "ttl-10".`,
        ];
        const structUsages: unknown[] = [];
        for (let i = 0; i < jsonQuestions.length; i++) {
          let t;
          try {
            t = await client.prompt(ctx, fork1Id, `Using ONLY the change pack, no tools. ${jsonQuestions[i]}`, { timeoutMs: 900_000 });
          } catch (e) {
            failures.push(`turn${i + 1}: prompt threw: ${String(e).slice(0, 200)}`);
            continue;
          }
          structUsages.push(t.response.usage);
          const blocks = [...t.text.matchAll(/```json\s*([\s\S]*?)```/g)];
          if (blocks.length === 0) {
            failures.push(`turn${i + 1}: no fenced json block; tail=${JSON.stringify(t.text.slice(-200))}`);
            continue;
          }
          const last = blocks[blocks.length - 1][1];
          try {
            const obj = JSON.parse(last);
            if (typeof obj.title === "string" && Array.isArray(obj?.contribute?.facts)) {
              parsed++;
            } else {
              failures.push(`turn${i + 1}: schema mismatch; parsed=${JSON.stringify(obj).slice(0, 200)}`);
            }
          } catch (e) {
            failures.push(`turn${i + 1}: JSON.parse failed: ${String(e).slice(0, 120)}; block=${last.slice(0, 200)}`);
          }
          log(`struct turn ${i + 1}: blocks=${blocks.length} parsedSoFar=${parsed} usage=[${fmtUsage(t.response.usage)}] share=${cacheShare(t.response.usage)}`);
        }
        check("6-structured-output", parsed >= 8, `${parsed}/10 parsed. failures: ${failures.join(" | ") || "none"}`);
        (summary as any).structured = { parsed, total: 10, failures, usages: structUsages };

        // ---- check 7a: session/load after close ----
        let loadOk = false;
        let loadEvidence = "";
        try {
          const ls = await ctx.request("session/new", { cwd, mcpServers });
          const lsId = ls.sessionId as string;
          await client.prompt(ctx, lsId, "Remember the word BANANA-42 for later. Reply OK.");
          await ctx.request("session/close", { sessionId: lsId });
          await ctx.request("session/load", { sessionId: lsId, cwd, mcpServers });
          const after = await client.prompt(ctx, lsId, "What word did I ask you to remember? Reply with just the word.");
          loadOk = after.text.includes("BANANA-42");
          loadEvidence = `reply=${JSON.stringify(after.text.slice(0, 200))} stop=${after.response.stopReason}`;
          await ctx.request("session/close", { sessionId: lsId }).catch(() => {});
        } catch (e) {
          loadEvidence = `error: ${String(e).slice(0, 500)}`;
        }
        check("7a-load", loadOk, loadEvidence);

        // ---- check 7b: session/cancel mid-reply ----
        let cancelOk = false;
        let cancelEvidence = "";
        try {
          const cs = await ctx.request("session/new", { cwd, mcpServers });
          const csId = cs.sessionId as string;
          client.drain(csId);
          const respP = ctx.request("session/prompt", {
            sessionId: csId,
            prompt: [
              {
                type: "text",
                text: "Write a very long story, at least 3000 words, about a router that dreams of electric sheep. Do not stop until you are done. Do not call tools.",
              },
            ],
          }) as Promise<any>;
          // Wait for the first agent chunk (poll queue), then cancel.
          const t0 = Date.now();
          let sawChunk = false;
          while (Date.now() - t0 < 120_000) {
            await sleep(500);
            const q = client.drain(csId);
            if (q.some((u: any) => u?.sessionUpdate === "agent_message_chunk")) {
              sawChunk = true;
              break;
            }
          }
          await client.cancel(ctx, csId);
          const resp = await respP;
          cancelOk = resp.stopReason === "cancelled" && sawChunk;
          cancelEvidence = `sawChunk=${sawChunk} stopReason=${resp.stopReason}`;
          await sleep(500);
          await ctx.request("session/close", { sessionId: csId }).catch(() => {});
        } catch (e) {
          cancelEvidence = `error: ${String(e).slice(0, 500)}`;
        }
        check("7b-cancel", cancelOk, cancelEvidence);

        // ---- check 7c: list models + select one ----
        let modelOk = false;
        let modelEvidence = "";
        try {
          const ms = await ctx.request("session/new", { cwd, mcpServers });
          const msId = ms.sessionId as string;
          const opts = (ms.configOptions ?? []) as any[];
          const models = opts.filter((o) => o.category === "model" || /model/i.test(o.id ?? "") || /model/i.test(o.name ?? ""));
          modelEvidence += `configOptions=[${opts.map((o) => `${o.id}:${o.type}:${o.currentValue}`).join(", ") || "none"}] modes=${JSON.stringify(ms.modes)?.slice(0, 400)} `;
          // Try selecting: prefer a select model option; else legacy session/set_model.
          const modelOpt = models.find((o) => o.type === "select" && Array.isArray(o.options) && o.options.length > 0);
          if (modelOpt) {
            const first = modelOpt.options[0].value;
            const setR = await ctx.request("session/set_config_option", {
              sessionId: msId,
              configId: modelOpt.id,
              value: first,
            });
            const cur = (setR.configOptions ?? []).find((o: any) => o.id === modelOpt.id);
            modelOk = cur?.currentValue === first;
            modelEvidence += `set ${modelOpt.id}=${first} -> current=${cur?.currentValue}`;
          } else {
            // legacy fallback some adapters keep
            try {
              const r = await ctx.request("session/set_model", { sessionId: msId, modelId: "default" });
              modelEvidence += `legacy set_model responded: ${JSON.stringify(r).slice(0, 200)}`;
              modelOk = true;
            } catch (e) {
              modelEvidence += `no model option and legacy set_model failed: ${String(e).slice(0, 200)}`;
            }
          }
          await ctx.request("session/close", { sessionId: msId }).catch(() => {});
        } catch (e) {
          modelEvidence += `error: ${String(e).slice(0, 300)}`;
        }
        check("7c-models", modelOk, modelEvidence);

        // ---- check 7d: permission behaviour (deny-all summary) ----
        const denied = client.permissionRequests.length;
        check(
          "7d-permissions",
          true,
          `total permission requests this run=${denied}; get_hunk allowed=${allowedTools.length > 0}; ` +
            `details=${JSON.stringify(client.permissionRequests.map((p) => ({ title: p.title.slice(0, 80), opts: p.options.map((o) => o.kind) }))).slice(0, 800)} (informational: agents were told not to use tools except get_hunk)`,
        );

        // ---- check 8: no-fork fallback (byte-identical first message) ----
        const fresh = await ctx.request("session/new", { cwd, mcpServers, _meta: { systemPrompt: SYSTEM_PROMPT } });
        const freshId = fresh.sessionId as string;
        const sameBytes = packMsg === basePackMessage(pack);
        const fbBase = await client.prompt(ctx, freshId, packMsg, { timeoutMs: 900_000 });
        const fbQ = await client.prompt(
          ctx,
          freshId,
          `Using ONLY the change pack in our conversation, answer in one short sentence, no tools: ${pack.facts[2].question} The fact id is ${pack.facts[2].id}.`,
          { timeoutMs: 900_000 },
        );
        const fbOk = fbQ.text.includes(pack.facts[2].answerMustContain);
        const fbLine = usageLine("fallback-q", fbQ.response, fbQ.usageUpdates);
        log(usageLine("fallback-base", fbBase.response, fbBase.usageUpdates));
        log(fbLine);
        check("8-fallback-cache", true, `byteIdenticalFirstMessage=${sameBytes} answerOk=${fbOk} reply=${JSON.stringify(fbQ.text.slice(0, 200))} :: ${fbLine} (informational: does usage show cache reads from the earlier session's prefix?)`);
        (summary as any).fallback = {
          byteIdentical: sameBytes,
          answerOk: fbOk,
          baseUsage: fbBase.response.usage,
          qUsage: fbQ.response.usage,
          qUsageLine: fbLine,
        };

        // cleanup
        for (const id of [baseId, fork1Id, fork2Id, freshId]) {
          await ctx.request("session/close", { sessionId: id }).catch(() => {});
        }
        log("done");
      },
      { onStderr: (s) => adapterStderr.push(s) },
    );
  } finally {
    (summary as any).adapterStderrTail = adapterStderr.join("").slice(-4000);
    finish();
    await mcp.close();
  }

  const passed = results.filter((r) => r.pass).length;
  log(`\n${adapter}: ${passed}/${results.length} checks passed`);
}

await main();
