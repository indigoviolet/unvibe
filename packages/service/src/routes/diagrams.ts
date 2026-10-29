/**
 * D2 diagrams endpoint (docs/d2-diagrams.md).
 *
 * `GET /api/reviews/:id/diagrams/:hash?theme=light|dark` →
 * - `200 image/svg+xml` with the sanitised SVG (cacheable by hash),
 * - `404` unknown review/hash,
 * - `409` with `{status, error}` when the diagram exists but is not rendered
 *   (binary unavailable or render error).
 *
 * Token auth is global (all routes). On-demand rendering: when the stored
 * block is `unavailable` but `d2` is now present, the endpoint renders,
 * caches, updates the block to `ok`, and serves.
 */
import type { FastifyInstance } from "fastify";
import { diagramHash, D2_VERSION_UNKNOWN, findDiagramByHash, findDiagramBySource } from "@unvibe/shared";
import type { DiagramBlock, DiagramStatusBody } from "@unvibe/shared";
import type { ServiceContext } from "./context.js";
import type { RouteDeps } from "./deps.js";
import { DiagramCache, type DiagramTheme } from "../diagrams/cache.js";
import { resolveD2Bin, meetsD2MinVersion } from "../diagrams/bins.js";
import { probeD2Version, renderD2Theme, D2_THEME_DARK, D2_THEME_LIGHT } from "../diagrams/render.js";
import { postProcessSvg, type CitationMap } from "../diagrams/sanitize.js";
import { lookupForSnapshot } from "../pipeline/lookup.js";
import { validateTarget } from "../validate/index.js";

// Diagram lookup lives in `@unvibe/shared` (`content/blocks.ts`): one
// walker over every live `Block[]` list (page cards, card second
// opinions, expansion bodies, expansion second opinions, asides at any
// depth), so a new container cannot be missed silently. This route only
// calls `findDiagramByHash` / `findDiagramBySource`.

export async function registerDiagrams(
  app: FastifyInstance,
  ctx: ServiceContext,
  deps: RouteDeps = {},
): Promise<void> {
  app.get("/api/reviews/:id/diagrams/:hash", async (req, reply) => {
    const { id, hash } = req.params as { id: string; hash: string };
    const query = req.query as { theme?: string };
    const theme: DiagramTheme = query.theme === "dark" ? "dark" : query.theme === undefined || query.theme === "light" ? "light" : "invalid" as DiagramTheme;
    if (theme !== "light" && theme !== "dark") {
      return reply.code(400).send({ error: `bad ?theme=${query.theme}: want light|dark` });
    }

    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: "unknown review" });

    const block = findDiagramByHash(snapshot, hash);
    if (!block) return reply.code(404).send({ error: "unknown diagram hash" });

    const cache = new DiagramCache({ dataDir: ctx.dataDir, ...(deps.fixturesDir ? { fixturesDir: deps.fixturesDir } : {}) });

    // Fast path: cached (or fixture-seeded) SVG. Serve whenever the bytes
    // exist — seeds prove the render — and heal an `unavailable` block to
    // `ok` best-effort so later reads skip on-demand work.
    const cached = cache.get(hash, theme);
    if (cached) {
      if (block.render?.status !== "ok") {
        try {
          await ctx.reviews.mutate(id, (draft) => {
            const b = findDiagramByHash(draft, hash);
            if (b && b.render?.status !== "ok") b.render = { hash, status: "ok" };
          });
        } catch {
          // serve anyway
        }
      }
      return reply
        .code(200)
        .header("content-type", "image/svg+xml")
        .header("cache-control", "public, max-age=31536000, immutable")
        .send(cached);
    }

    // Block not rendered (unavailable/error) or cache missed: try on-demand
    // render when the binary is present (covers "render later on demand
    // when the binary appears").
    if (block.render?.status !== "ok" || !cached) {
      const onDemand = await tryRenderOnDemand(ctx, deps, id, block, hash, theme, cache);
      if (onDemand.kind === "rendered") {
        return reply
          .code(200)
          .header("content-type", "image/svg+xml")
          .header("cache-control", "public, max-age=31536000, immutable")
          .send(onDemand.svg);
      }
      // Still not rendered: 409 with the on-demand outcome (contract,
      // issue #130). `error` means d2 ran and the source failed;
      // `unavailable` means the binary is really missing — the status is
      // the attempt's result, never inferred from a stale snapshot.
      const body: DiagramStatusBody =
        onDemand.status === "error"
          ? { status: "error", ...(onDemand.error ? { error: onDemand.error } : {}) }
          : { status: "unavailable" };
      return reply.code(409).send(body);
    }

    // Status ok but cache miss and on-demand failed (no binary): 409.
    return reply.code(409).send({ status: block.render?.status ?? "unavailable" });
  });
}

/**
 * Try on-demand rendering for one diagram block. Returns `{ kind:
 * "rendered", svg }` on success, else `{ kind: "failed", status }` where
 * `status` is the attempt's own outcome (issue #130): `"unavailable"`
 * only when the binary is missing/too old, `"error"` with the compiler
 * message when d2 ran and the source failed. Never throws.
 */
type OnDemandResult =
  | { kind: "rendered"; svg: string }
  | { kind: "failed"; status: "unavailable" | "error"; error?: string };

async function tryRenderOnDemand(
  ctx: ServiceContext,
  deps: RouteDeps,
  reviewId: string,
  block: DiagramBlock,
  requestedHash: string,
  theme: DiagramTheme,
  cache: DiagramCache,
): Promise<OnDemandResult> {
  const fail = (status: "unavailable" | "error", error?: string): OnDemandResult =>
    error ? { kind: "failed", status, error } : { kind: "failed", status };
  try {
    const bin = resolveD2Bin({});
    if (!bin) return fail("unavailable");
    const version = await probeD2Version(ctx.runner, bin.path).catch(() => null);
    if (!version || !meetsD2MinVersion(version)) return fail("unavailable");

    const source = block.source;
    const newHash = diagramHash(source, version);
    // Build citation map for anchor rewriting (canonical + unverified).
    const citations: CitationMap = new Map();
    try {
      const snapshot = ctx.reviews.getSnapshot(reviewId);
      if (snapshot) {
        let lookup = lookupForSnapshot(snapshot);
        // Demo alias keys (conn/tconn/…) resolve like the pipeline does.
        if (snapshot.review.repoId === "demo" && deps.fixturesDir) {
          try {
            const fs = await import("node:fs");
            const path = await import("node:path");
            const meta = JSON.parse(fs.readFileSync(path.join(deps.fixturesDir, "meta.json"), "utf8")) as { keyAliases?: Record<string, string> };
            const aliases = meta.keyAliases ?? {};
            if (Object.keys(aliases).length > 0) {
              const base = lookup;
              const inner = base.resolveFileKey.bind(base);
              lookup = { ...base, resolveFileKey: (key: string) => inner(key) ?? (aliases[key] ? inner(aliases[key]) : null) };
            }
          } catch {
            // ignore alias failures; base lookup still works for canonical keys
          }
        }
        const { extractD2Links, canonicalizeTarget } = await import("@unvibe/shared");
        for (const raw of extractD2Links(source)) {
          const canon = canonicalizeTarget(raw, lookup.resolveFileKey.bind(lookup));
          if (!citations.has(raw)) citations.set(raw, { canonical: canon });
          if (!citations.has(canon)) citations.set(canon, { canonical: canon });
        }
        for (const c of block.citations ?? []) {
          const rep = validateTarget(c.target, lookup);
          if (rep.status === "repaired" && rep.repairedTo) {
            citations.set(c.target, { canonical: rep.repairedTo });
            citations.set(rep.repairedTo, { canonical: rep.repairedTo });
          } else if (rep.status === "unverified") {
            citations.set(c.target, { canonical: c.target, unverified: true });
          } else {
            citations.set(c.target, { canonical: c.target });
          }
        }
      }
    } catch {
      // best effort; anchors fall back to bare tokens
    }

    const themeVal = theme === "dark" ? D2_THEME_DARK : D2_THEME_LIGHT;
    const otherTheme: DiagramTheme = theme === "dark" ? "light" : "dark";
    const otherVal = otherTheme === "dark" ? D2_THEME_DARK : D2_THEME_LIGHT;

    const [r1, r2] = await Promise.all([
      renderD2Theme(source, { runner: ctx.runner, binPath: bin.path, salt: newHash, theme: themeVal }),
      renderD2Theme(source, { runner: ctx.runner, binPath: bin.path, salt: newHash, theme: otherVal }),
    ]);
    if (!r1.ok || !r1.svg || !r2.ok || !r2.svg) {
      // Record the error on the block (so later reads carry it), and
      // report it as the attempt's outcome.
      const err = (!r1.ok ? r1.error : r2.error) ?? "d2 render failed";
      try {
        await ctx.reviews.mutate(reviewId, (draft) => {
          const b = findDiagramByHash(draft, requestedHash) ?? findDiagramBySource(draft, source);
          if (b) {
            b.render = { hash: requestedHash, status: "error", error: err };
          }
        });
      } catch {
        // ignore
      }
      return fail("error", err);
    }

    const svg1 = postProcessSvg(r1.svg, citations, newHash);
    const svg2 = postProcessSvg(r2.svg, citations, newHash);
    const svgForTheme = theme === "dark" ? (themeVal === D2_THEME_DARK ? svg1 : svg2) : (themeVal === D2_THEME_LIGHT ? svg1 : svg2);
    const svgOther = theme === "dark" ? (themeVal === D2_THEME_DARK ? svg2 : svg1) : (themeVal === D2_THEME_LIGHT ? svg2 : svg1);
    // Stripped icons (issue #286): noted on the block for Debug, never an error.
    const iconNotes = [...(r1.iconNotes ?? []), ...(r2.iconNotes ?? [])]
      .filter((n, i, all) => all.findIndex((o) => o.url === n.url) === i)
      .map((n) => `icon stripped: ${n.url}: ${n.reason}`);

    // Cache under the new hash AND the requested hash (old URLs keep working).
    cache.put(newHash, theme, svgForTheme);
    cache.put(newHash, otherTheme, svgOther);
    if (newHash !== requestedHash) {
      cache.put(requestedHash, theme, svgForTheme);
      cache.put(requestedHash, otherTheme, svgOther);
    }

    // Update the stored block to ok (with the new hash).
    try {
      await ctx.reviews.mutate(reviewId, (draft) => {
        const b = findDiagramByHash(draft, requestedHash) ?? findDiagramBySource(draft, source);
        if (b) {
          b.render = { hash: newHash, status: "ok", ...(iconNotes.length > 0 ? { notes: iconNotes } : {}) };
        }
      });
    } catch {
      // ignore (serve anyway)
    }
    void D2_VERSION_UNKNOWN;
    return { kind: "rendered", svg: svgForTheme };
  } catch {
    return fail("error", "d2 render failed");
  }
}
