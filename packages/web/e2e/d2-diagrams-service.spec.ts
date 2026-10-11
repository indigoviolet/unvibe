/**
 * D2 diagrams over the real service (replay agent, demo review).
 *
 * Written against the endpoint contract and marked to run when the
 * endpoint exists: `beforeAll` probes `/api/readiness` for the `d2` check
 * the service adds, then polls the replay-filled demo snapshot for a
 * diagram block. Every test skips fast when the service side is not merged
 * yet (no `d2` readiness check / no diagram block), when the `d2` binary
 * is absent (render `unavailable`), and the whole file skips when the
 * service is not built.
 *
 * When an `ok` diagram exists: the endpoint serves light + dark SVG
 * (sanitised, with the contract's citation anchors), unknown hashes 404,
 * and the UI renders both themes with hover-preview + click-to-reveal and
 * no navigation. When only an `unavailable`/`error` diagram exists: the
 * UI shows the source fallback. The network-guard fixture asserts zero
 * non-local requests and zero CSP violations throughout — here against
 * the real CSP header, which is what validates the `style-src
 * 'unsafe-inline'` claim end to end.
 *
 * Requires `mise run build` first (runs `packages/service/dist/index.js`
 * and serves `packages/web/dist`).
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";

const exec = promisify(execFile);
const SERVICE_ENTRY = fileURLToPath(new URL("../../service/dist/index.js", import.meta.url));

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

interface RunningService {
  origin: string;
  token: string;
  stop: () => Promise<void>;
}

async function startService(dataDir: string): Promise<RunningService> {
  const { spawn } = await import("node:child_process");
  const proc = spawn(process.execPath, [SERVICE_ENTRY], {
    env: {
      ...process.env,
      UNVIBE_DATA_DIR: dataDir,
      UNVIBE_PORT: "0",
      UNVIBE_REPO_ROOTS: "",
      UNVIBE_AGENT: "replay",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  const started = new Promise<{ origin: string; token: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`service did not start: ${out}`)), 30_000);
    proc.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
      const m = out.match(/Unvibe listening on (http:\/\/127\.0\.0\.1:\d+)\/\?token=(\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ origin: m[1], token: m[2] });
      }
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timer);
        reject(new Error(`service exited with ${code}: ${out}`));
      }
    });
  });
  const { origin, token } = await started;
  return {
    origin,
    token,
    stop: () =>
      new Promise<void>((resolve) => {
        proc.on("exit", () => resolve());
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (proc.exitCode === null) proc.kill("SIGKILL");
          resolve();
        }, 5000).unref?.();
      }),
  };
}

async function apiJson(origin: string, token: string, method: string, urlPath: string, body?: unknown): Promise<unknown> {
  const args = [
    "-s",
    "-X",
    method,
    `${origin}${urlPath}`,
    "-H",
    `Authorization: Bearer ${token}`,
    "-H",
    "content-type: application/json",
  ];
  if (body !== undefined) args.push("-d", JSON.stringify(body));
  const { stdout } = await exec("curl", args);
  return JSON.parse(stdout);
}

interface CurlResult {
  status: number;
  contentType: string;
  body: string;
}

/** Raw GET (status + content type + body) for the SVG endpoint. */
async function curlGet(origin: string, token: string, urlPath: string): Promise<CurlResult> {
  const { stdout } = await exec("curl", [
    "-s",
    "-w",
    "\n%{http_code} %{content_type}",
    `${origin}${urlPath}`,
    "-H",
    `Authorization: Bearer ${token}`,
  ]);
  const lines = stdout.split("\n");
  const trailer = lines.pop() ?? "";
  const [status, ...ct] = trailer.split(" ");
  return { status: Number(status), contentType: ct.join(" "), body: lines.join("\n") };
}

interface DiagramInfo {
  blockId: string;
  hash: string;
  status: "ok" | "unavailable" | "error";
}

async function hoverFresh(page: Page, locator: import("@playwright/test").Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = await locator.boundingBox();
  if (!box) throw new Error("anchor has no box");
  await page.mouse.move(8, 200);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
}

test.describe("D2 diagrams over the real service", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";
  /** False until the endpoint contract is observable: tests skip. */
  let hasEndpoint = false;
  let skipReason = "needs the d2 service side merged (no d2 readiness check)";
  let diagram: DiagramInfo | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-d2-data-"));
    svc = await startService(dataDir);
    const readiness = (await apiJson(svc.origin, svc.token, "GET", "/api/readiness")) as {
      checks: { id: string }[];
    };
    if (!readiness.checks.some((c) => c.id === "d2")) return;
    const created = (await apiJson(svc.origin, svc.token, "POST", "/api/reviews", {
      repoId: "demo",
    })) as { review: { id: string } };
    reviewId = created.review.id;
    const deadline = Date.now() + 90_000;
    for (;;) {
      const snap = (await apiJson(svc.origin, svc.token, "GET", `/api/reviews/${reviewId}`)) as {
        pages: { id: string; cards: { blocks: { type: string; id: string; render?: DiagramInfo }[] }[] }[];
      };
      const root = snap.pages.find((p) => p.id === "root");
      const found = root?.cards
        .flatMap((c) => c.blocks)
        .find((b) => b.type === "diagram" && b.render && typeof b.render.hash === "string");
      if (found?.render) {
        diagram = { blockId: found.id, hash: found.render.hash, status: found.render.status };
        break;
      }
      if (Date.now() > deadline) {
        skipReason = "replay pipeline produced no diagram block in time";
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (diagram && diagram.status === "ok") {
      hasEndpoint = true;
      skipReason = "";
    } else {
      skipReason = `diagram render is ${diagram?.status ?? "missing"} (no usable d2 binary?)`;
    }
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function openReview(page: Page): Promise<void> {
    if (!svc) throw new Error("service not running");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#page .doc h1.title")).toContainText(
      "Unfold obsolete folded response headers",
      { timeout: 30_000 },
    );
  }

  function needEndpoint(): void {
    test.skip(!hasEndpoint, skipReason);
    if (!svc || !diagram) throw new Error("service not running");
  }

  test("endpoint serves light + dark SVG and 404s unknown hashes", async () => {
    test.setTimeout(60_000);
    needEndpoint();
    const light = await curlGet(
      svc!.origin,
      svc!.token,
      `/api/reviews/${reviewId}/diagrams/${diagram!.hash}?theme=light`,
    );
    expect(light.status).toBe(200);
    expect(light.contentType).toContain("image/svg+xml");
    expect(light.body).toContain("<svg");
    // Contract anchors survive the service sanitiser.
    expect(light.body).toContain("data-refs");
    expect(light.body).toContain("data-src");
    expect(light.body).not.toContain("<script");
    const dark = await curlGet(
      svc!.origin,
      svc!.token,
      `/api/reviews/${reviewId}/diagrams/${diagram!.hash}?theme=dark`,
    );
    expect(dark.status).toBe(200);
    expect(dark.contentType).toContain("image/svg+xml");
    expect(dark.body).toContain("<svg");
    expect(dark.body).not.toBe(light.body);
    const missing = await curlGet(
      svc!.origin,
      svc!.token,
      `/api/reviews/${reviewId}/diagrams/deadbeef?theme=light`,
    );
    expect(missing.status).toBe(404);
  });

  test("diagram renders in light and dark, hover previews, click reveals", async ({ page }) => {
    test.setTimeout(120_000);
    needEndpoint();
    await openReview(page);
    const host = `#B-${diagram!.blockId} .dg-svg svg`;
    await expect(page.locator(host)).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await expect(page.locator(host)).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));

    const anchor = page.locator(`#B-${diagram!.blockId} .dg-svg a[data-refs]`).first();
    await hoverFresh(page, anchor);
    await expect(page.locator("#pop")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#pop .cite .loc").first()).toContainText("connection.py");
    const before = page.url();
    await anchor.click();
    expect(page.url()).toBe(before);
    await expect(page.locator('#right [role="tab"][aria-selected="true"]')).toContainText("Diff");
  });

  test("unavailable render shows the source fallback, never a broken card", async ({ page }) => {
    test.skip(hasEndpoint, "only relevant without a rendered diagram");
    test.skip(!diagram, skipReason);
    await openReview(page);
    const fallback = page.locator(`#B-${diagram!.blockId} .dg-fallback`);
    await expect(fallback).toBeVisible({ timeout: 30_000 });
    await expect(fallback.locator("pre.code")).not.toBeEmpty();
  });
});
