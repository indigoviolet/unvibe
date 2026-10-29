/**
 * Shared live-test helper units (issue #292).
 *
 * Pure logic (arg overrides, listing parse, catalogue pricing, the
 * pre-flight, the unpriced refusal, spend tracking, the settings patch)
 * plus the two free pi calls against the stub pi (`fake-pi.mjs`, which
 * prints a fixed `--list-models` table and RPC catalogue — no install, no
 * login, no prompt, no spend, no real home).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LIVE_PI_DEFAULT,
  assertPriced,
  costOf,
  createSpendTracker,
  fetchPiCatalog,
  findCatalogEntry,
  liveModelPatch,
  parseListModels,
  parseLiveArgs,
  precheckModelOffered,
  preflightCap,
  resolvePiCmd,
  runPiListModels,
  selectLiveModel,
  splitModelRef,
  worstCaseTurnUsd,
  writeLiveReport,
} from "../../../scripts/live-pi-lib.mjs";

const FAKE_PI = resolve(dirname(fileURLToPath(import.meta.url)), "fake-pi.mjs");

const CATALOG = [
  {
    provider: "meta",
    id: "muse-spark-1.3-contributor",
    cost: { input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 131072,
  },
  { provider: "openai-codex", id: "gpt-5.6-terra", cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 } },
];

const stubEnv = (models = CATALOG) => ({ ...process.env, UNVIBE_FAKE_PI_MODELS: JSON.stringify(models) });

describe("parseLiveArgs (issue #292)", () => {
  it("defaults to pi + muse-spark with an explicit cap", () => {
    expect(parseLiveArgs(["--cap", "5"])).toEqual({
      provider: "pi",
      model: "muse-spark-1.3-contributor",
      capUsd: 5,
      allowUnpriced: false,
    });
  });

  it("takes --provider and --model overrides, keeping other providers selectable", () => {
    const parsed = parseLiveArgs(["--port", "4595", "--provider", "codex", "--model", "gpt-5.6-terra", "--cap", "2.5"]);
    expect(parsed.provider).toBe("codex");
    expect(parsed.model).toBe("gpt-5.6-terra");
    expect(parsed.capUsd).toBe(2.5);
  });

  it("takes --allow-unpriced", () => {
    expect(parseLiveArgs(["--cap", "1", "--allow-unpriced"]).allowUnpriced).toBe(true);
  });

  it("refuses without --cap, and on bad values", () => {
    expect(() => parseLiveArgs([])).toThrow(/--cap/);
    expect(() => parseLiveArgs(["--cap", "abc"])).toThrow(/--cap/);
    expect(() => parseLiveArgs(["--cap", "0"])).toThrow(/--cap/);
    expect(() => parseLiveArgs(["--cap", "-3"])).toThrow(/--cap/);
  });
});

describe("model refs and pi command", () => {
  it("splits provider/id, bare ids stay providerless", () => {
    expect(splitModelRef("meta/muse-spark-1.3-contributor")).toEqual({ provider: "meta", id: "muse-spark-1.3-contributor" });
    expect(splitModelRef("sonnet")).toEqual({ provider: null, id: "sonnet" });
  });

  it("defaults to PATH pi, honours UNVIBE_PI_BIN", () => {
    expect(resolvePiCmd({})).toEqual(["pi"]);
    expect(resolvePiCmd({ UNVIBE_PI_BIN: "/tmp/stub-pi" })).toEqual(["/tmp/stub-pi"]);
  });

  it("keeps the owner default", () => {
    expect(LIVE_PI_DEFAULT).toEqual({ provider: "pi", model: "muse-spark-1.3-contributor" });
  });
});

describe("free pre-check (stub pi --list-models)", () => {
  it("parses the table into rows", () => {
    const out = "provider  model\nmeta      muse-spark-1.3-contributor\nopenai    gpt-5\n";
    expect(parseListModels(out)).toEqual([
      { provider: "meta", model: "muse-spark-1.3-contributor" },
      { provider: "openai", model: "gpt-5" },
    ]);
  });

  it("parses the no-match line as no rows", () => {
    expect(parseListModels('No models matching "zzz"\n')).toEqual([]);
  });

  it("passes when the stub lists the default model", () => {
    const hit = precheckModelOffered([FAKE_PI], { ...LIVE_PI_DEFAULT }, { env: stubEnv() });
    expect(hit).toEqual({ provider: "meta", model: "muse-spark-1.3-contributor" });
  });

  it("passes with a bare id, and refuses before any spend when missing", () => {
    const hit = precheckModelOffered([FAKE_PI], { provider: "pi", model: "muse-spark-1.3-contributor" }, { env: stubEnv() });
    expect(hit.model).toBe("muse-spark-1.3-contributor");
    expect(() => precheckModelOffered([FAKE_PI], { provider: "pi", model: "no-such-model" }, { env: stubEnv() })).toThrow(
      /does not offer model/,
    );
  });

  it("skips the pi listing for other providers", () => {
    expect(precheckModelOffered([FAKE_PI], { provider: "codex", model: "gpt-5.6-terra" }, { env: stubEnv() })).toEqual({
      provider: "codex",
      model: "gpt-5.6-terra",
    });
  });

  it("fails plainly when the binary is missing", () => {
    expect(() => runPiListModels(["/nonexistent/pi-stub"], "x")).toThrow(/cannot run/);
  });
});

describe("catalogue pricing (stub pi RPC, no prompt)", () => {
  it("fetches the stub catalogue", async () => {
    const catalog = await fetchPiCatalog([FAKE_PI], { env: stubEnv() });
    expect(catalog.find((e) => e.id === "muse-spark-1.3-contributor")).toMatchObject({ provider: "meta" });
  });

  it("finds the entry by bare id or provider-qualified, misses otherwise", () => {
    expect(findCatalogEntry(CATALOG, { provider: "pi", model: "muse-spark-1.3-contributor" })?.provider).toBe("meta");
    expect(findCatalogEntry(CATALOG, { provider: "pi", model: "meta/muse-spark-1.3-contributor" })?.provider).toBe("meta");
    expect(findCatalogEntry(CATALOG, { provider: "pi", model: "meta/nope" })).toBeNull();
    expect(findCatalogEntry(CATALOG, { provider: "codex", model: "gpt-5.6-terra" })).toBeNull();
  });

  it("prices muse-spark from pi's own numbers", () => {
    const rates = assertPriced(findCatalogEntry(CATALOG, { ...LIVE_PI_DEFAULT }), { ...LIVE_PI_DEFAULT });
    expect(rates).toEqual({ input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: 0 });
  });

  it("refuses a missing entry, and all-zero cost, unless --allow-unpriced", () => {
    expect(() => assertPriced(null, { provider: "pi", model: "meta/gone" })).toThrow(/no catalogue entry/);
    const zero = { provider: "meta", id: "m", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    expect(() => assertPriced(zero, { provider: "pi", model: "meta/m" })).toThrow(/all zeros/);
    expect(assertPriced(null, { provider: "pi", model: "meta/gone", allowUnpriced: true })).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  it("costs usage at catalogue rates", () => {
    const rates = { input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: 0 };
    const usd = costOf({ inputTokens: 1_000_000, cachedReadTokens: 1_000_000, cachedWriteTokens: 0, outputTokens: 500_000 }, rates);
    expect(usd).toBeCloseTo(0.1 + 0.002 + 0.1, 9);
  });
});

describe("cap pre-flight and spend tracker", () => {
  const rates = { input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: 0 };

  it("worst-cases one full-context turn", () => {
    const worst = worstCaseTurnUsd(rates, CATALOG[0]);
    expect(worst).toBeCloseTo((1048576 * (0.1 + 0.002 + 0) + 131072 * 0.2) / 1_000_000, 6);
    expect(worstCaseTurnUsd(rates, {})).toBeNull();
  });

  it("refuses to start when the worst case is over the cap", () => {
    expect(() => preflightCap({ capUsd: 0.01, worstCaseUsd: 0.5, what: "2 runs" })).toThrow(/exceeds cap/);
    expect(preflightCap({ capUsd: 5, worstCaseUsd: 0.5 })).toBe(0.5);
    expect(preflightCap({ capUsd: 5, worstCaseUsd: null })).toBeNull();
  });

  it("counts every token from the first, failed jobs included", () => {
    const spend = createSpendTracker(rates, 5);
    spend.add({ inputTokens: 100, cachedReadTokens: 50, outputTokens: 10 });
    spend.add({ inputTokens: 200, outputTokens: 0 }); // e.g. a failed job's partial usage
    expect(spend.totals).toEqual({ inputTokens: 300, cachedReadTokens: 50, cachedWriteTokens: 0, outputTokens: 10 });
    expect(spend.check("test")).toBeCloseTo(costOf(spend.totals, rates), 9);
    spend.add({ inputTokens: 1_000_000_000, outputTokens: 0 });
    expect(() => spend.check("test")).toThrow(/exceeds cap/);
  });
});

describe("model selection (single place, TODO #292)", () => {
  it("builds the patch for the requested roles", () => {
    expect(liveModelPatch({ provider: "pi", model: "m" }, ["main", "small"])).toEqual({
      // `effort` is required by the settings contract ("" = provider default).
      main: { provider: "pi", model: "m", effort: "" },
      small: { provider: "pi", model: "m", effort: "" },
    });
  });

  it("goes through the settings API and fails loudly when refused", async () => {
    const ok = await selectLiveModel(async () => ({ ok: true, status: 200, detail: "", body: { main: 1 } }), {
      provider: "pi",
      model: "m",
    });
    expect(ok).toEqual({ main: 1 });
    await expect(
      selectLiveModel(async () => ({ ok: false, status: 400, detail: 'main model "m" is not offered by pi', body: null }), {
        provider: "pi",
        model: "m",
      }),
    ).rejects.toThrow(/not offered by pi/);
  });
});

describe("test-results report", () => {
  it("writes spend + per-task results as JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "unvibe-live-report-"));
    try {
      const file = writeLiveReport({
        dir,
        task: "pipeline",
        provider: "pi",
        model: "muse-spark-1.3-contributor",
        rates: { input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: 0 },
        capUsd: 5,
        spendUsd: 0.0123,
        tokens: { inputTokens: 1 },
        results: [{ run: "pi", failures: [] }],
        failures: [],
      });
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      expect(parsed.task).toBe("pipeline");
      expect(parsed.spendUsd).toBe(0.0123);
      expect(parsed.results).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
