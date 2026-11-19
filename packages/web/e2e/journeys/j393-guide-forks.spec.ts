/**
 * J393 — Guide prompt forks (#393).
 *
 * A persona folder with reader.md is guide-capable: Re-do with runs
 * the whole guide under it, and every main-agent task on that review
 * resolves templates, model and lens through it. Guards: whole-file
 * overlay (fallback for unforked templates), guide-capable detection,
 * redo-with validation + stamping, fork templates/model/lens on the
 * re-done review (reader, slower, Second opinion's base instructions), and
 * the drift warning naming the file.
 *
 * Boots: ONE replay service over a fixture prompt set (a Tutor fork
 * with sentinel lines) + a scratch branch review. The guide replays
 * fixture content there, so card ids match the recordings.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import {
  TUTOR_LENS,
  TUTOR_SENTINEL,
  apiJson,
  createScratchReview,
  fakeServicePath,
  makeScratchRepo,
  makeTutorForkPrompts,
  realGitPath,
  writeFakeGitOffline,
  writeFakeShell,
} from "./journey-helpers.js";

test.use({ channel: "chromium" });
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});
test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

const TUTOR = {
  id: "tutor",
  name: "Tutor",
  followMain: false,
  provider: "codex",
  model: "gpt-6.1-sol",
  lens: TUTOR_LENS,
  cardInstruction: "",
  enabled: true,
  color: "#C2410C",
};

interface PersonaBody {
  id: string;
  name: string;
}

async function personas(svc: RunningService): Promise<PersonaBody[]> {
  const res = await apiJson(svc, "GET", "/api/settings");
  expect(res.status).toBe(200);
  return (res.json as { personas: PersonaBody[] }).personas;
}

async function jobsFor(svc: RunningService, reviewId: string): Promise<{ id: string; kind: string; state: string; provider: string; model: string }[]> {
  const res = await apiJson(svc, "GET", `/api/jobs?review=${reviewId}`);
  expect(res.status).toBe(200);
  return (res.json as { jobs: { id: string; kind: string; state: string; provider: string; model: string }[] }).jobs;
}

async function jobPrompt(svc: RunningService, jobId: string): Promise<string> {
  const res = await apiJson(svc, "GET", `/api/jobs/${jobId}`);
  expect(res.status).toBe(200);
  return ((res.json as { job: { promptSnapshot?: string } }).job.promptSnapshot ?? "");
}

async function jobState(svc: RunningService, jobId: string): Promise<string> {
  const res = await apiJson(svc, "GET", `/api/jobs/${jobId}`);
  expect(res.status).toBe(200);
  return (res.json as { job: { state: string } }).job.state;
}

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await check()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`${what} timed out`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function waitGuide(svc: RunningService, reviewId: string, timeoutMs = 240_000): Promise<void> {
  await waitFor(async () => {
    const res = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    if (res.status !== 200) return false;
    const pages = ((res.json as { pages?: { cards?: { blocks?: unknown[] }[] }[] }).pages ?? []).flatMap((p) => p.cards ?? []);
    return pages.some((c) => (c.blocks ?? []).length > 0);
  }, timeoutMs, "guide fill");
}

async function firstCardId(svc: RunningService, reviewId: string): Promise<string> {
  const res = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
  expect(res.status).toBe(200);
  const cards = ((res.json as { pages: { cards: { id: string; blocks: unknown[] }[] }[] }).pages ?? []).flatMap((p) => p.cards);
  const hit = cards.find((c) => c.blocks.length > 0);
  if (!hit) throw new Error("no filled card yet");
  return hit.id;
}

async function waitJobDone(svc: RunningService, jobId: string, timeoutMs = 180_000): Promise<void> {
  await waitFor(async () => (await jobState(svc, jobId)) === "done", timeoutMs, `job ${jobId}`);
}

async function gotoPersonas(page: Page, svc: RunningService): Promise<void> {
  await page.goto(`${svc.origin}/settings?token=${svc.token}`);
  await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Personas" }).click();
  await expect(page.getByTestId("personas-section")).toBeVisible();
}

test.describe("J393 guide forks", () => {
  let dirs: string[] = [];
  let promptsDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    const tmp = (tag: string): string => {
      const d = mkdtempSync(path.join(os.tmpdir(), `unvibe-j393-${tag}-`));
      dirs.push(d);
      return d;
    };
    promptsDir = makeTutorForkPrompts("j393").dir;
    dirs.push(promptsDir);
    const scratch = await makeScratchRepo(tmp("repo"));
    const dataDir = tmp("data");
    const fakeBin = tmp("bin");
    writeFakeGitOffline(fakeBin, realGitPath());
    const fakeShell = writeFakeShell(fakeBin);
    svc = await startService(dataDir, {
      agent: "replay",
      label: "j393",
      extraEnv: {
        SHELL: fakeShell,
        PATH: fakeServicePath(fakeBin),
        UNVIBE_PROMPTS_DIR: promptsDir,
      },
    });
    const seed = await personas(svc);
    const added = await apiJson(svc, "PUT", "/api/settings", { personas: [...seed, TUTOR] });
    expect(added.status).toBe(200);
    reviewId = await createScratchReview(svc, scratch.dir);
    const created = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    expect((created.json as { review: { guidePersonaId: string } }).review.guidePersonaId).toBe("guide");
    await waitGuide(svc, reviewId);
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs = [];
  });

  function service(): RunningService {
    if (!svc) throw new Error("no service");
    return svc;
  }

  test("re-do with Tutor re-runs the guide under the fork", async () => {
    test.setTimeout(300_000);
    const s = service();
    const redo = await apiJson(s, "POST", `/api/reviews/${reviewId}/redo`, { personaId: "tutor" });
    expect(redo.status).toBe(202);
    const forkedId = (redo.json as { review: { id: string; guidePersonaId: string } }).review.id;
    expect(forkedId).not.toBe(reviewId);
    expect((redo.json as { review: { guidePersonaId: string } }).review.guidePersonaId).toBe("tutor");
    reviewId = forkedId;
    await waitGuide(s, reviewId);

    await test.step("the reader used the fork text on the persona model", async () => {
      const jobs = await jobsFor(s, reviewId);
      const reader = jobs.find((j) => j.kind === "reader");
      expect(reader).toBeDefined();
      expect(reader!.provider).toBe("codex");
      expect(reader!.model).toBe("gpt-6.1-sol");
      const prompt = await jobPrompt(s, reader!.id);
      expect(prompt).toContain(TUTOR_SENTINEL.reader);
      expect(prompt.startsWith(`# Writing style\n\n${TUTOR_LENS}\n\n`)).toBe(true);
    });
  });

  test("slower and Second opinion resolve through the fork", async () => {
    test.setTimeout(300_000);
    const s = service();
    const cardId = await firstCardId(s, reviewId);

    await test.step("slower renders the fork template with the fork lens", async () => {
      const res = await apiJson(s, "POST", `/api/reviews/${reviewId}/actions`, { kind: "slower", cardId });
      expect(res.status).toBe(200);
      const jobId = (res.json as { jobId: string }).jobId;
      await waitJobDone(s, jobId);
      const prompt = await jobPrompt(s, jobId);
      expect(prompt).toContain(TUTOR_SENTINEL.slower);
      expect(prompt.startsWith(`# Writing style\n\n${TUTOR_LENS}\n\n`)).toBe(true);
    });

    await test.step("Second opinion layers its lens on the fork instructions", async () => {
      const res = await apiJson(s, "POST", `/api/reviews/${reviewId}/actions`, {
        kind: "persona",
        cardId,
        personaId: "second-opinion",
      });
      expect(res.status).toBe(200);
      const jobId = (res.json as { jobId: string }).jobId;
      await waitJobDone(s, jobId);
      const prompt = await jobPrompt(s, jobId);
      expect(prompt).toContain("second reader");
      expect(prompt).not.toContain(TUTOR_LENS);
      const snap = await apiJson(s, "GET", `/api/reviews/${reviewId}`);
      const card = ((snap.json as { pages: { cards: { id: string; variants?: Record<string, { blocks: unknown[] }> }[] }[] }).pages ?? [])
        .flatMap((p) => p.cards)
        .find((c) => c.id === cardId);
      expect(card?.variants?.["second-opinion"]?.blocks.length).toBeGreaterThan(0);
      const jobs = await jobsFor(s, reviewId);
      const persona = jobs.find((j) => j.id === jobId);
      expect(persona?.provider).toBe("codex");
    });
  });

  test("drift warning names the file", async () => {
    test.setTimeout(120_000);
    const s = service();
    const base = path.join(promptsDir, "reader.md");
    writeFileSync(base, `${readFileSync(base, "utf8")}\nNew base rule.\n`);
    const res = await apiJson(s, "GET", "/api/prompt-forks");
    expect(res.status).toBe(200);
    const forks = (res.json as { forks: { personaId: string; guideCapable: boolean; drifted: string[] }[] }).forks;
    expect(forks.find((f) => f.personaId === "tutor")).toMatchObject({ guideCapable: true, drifted: ["reader.md"] });
  });

  test("Re-do with Tutor from the review bar", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.getByRole("button", { name: "Re-do guide" })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Re-do guide" }).click();
    const menu = page.getByTestId("redo-menu");
    await expect(menu).toBeVisible();
    // Issue #405 removes the Teach built-in; the Tutor fixture fork is
    // the only other guide-capable persona, so it is the only menu item
    // beside the plain re-do.
    await expect(menu.getByRole("menuitem", { name: "Re-do with Tutor" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "Re-do with Tutor" }).click();
    await expect(page.getByText("Confirm re-do with Tutor")).toBeVisible();
    await page.getByRole("button", { name: "Confirm re-do with Tutor" }).click();
    await waitFor(async () => {
      const url = page.url();
      const id = url.split("/review/")[1]?.split("?")[0] ?? "";
      return id !== "" && id !== reviewId;
    }, 60_000, "redo navigation");
    const id = page.url().split("/review/")[1]!.split("?")[0]!;
    const snap = await apiJson(s, "GET", `/api/reviews/${id}`);
    expect((snap.json as { review: { guidePersonaId: string } }).review.guidePersonaId).toBe("tutor");
    reviewId = id;
  });

  test("Settings shows the Tutor drift warning", async ({ page }) => {
    test.setTimeout(120_000);
    const s = service();
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPersonas(page, s);
    const row = page.getByTestId("persona-tutor");
    await expect(row).toBeVisible();
    await expect(row.getByTestId("persona-tutor-drift")).toContainText("reader.md");
  });

  test("default guide: new reviews and plain Re-do run as Tutor", async () => {
    test.setTimeout(300_000);
    const s = service();
    const saved = await apiJson(s, "PUT", "/api/settings", { defaultGuidePersonaId: "tutor" });
    expect(saved.status).toBe(200);

    const repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j393-default-repo-"));
    dirs.push(repoDir);
    const scratch = await makeScratchRepo(repoDir);
    const id = await createScratchReview(s, scratch.dir);

    await test.step("a new review records the default and runs its fork", async () => {
      const created = await apiJson(s, "GET", `/api/reviews/${id}`);
      expect((created.json as { review: { guidePersonaId: string } }).review.guidePersonaId).toBe("tutor");
      await waitGuide(s, id);
      const jobs = await jobsFor(s, id);
      const reader = jobs.find((j) => j.kind === "reader");
      expect(reader).toBeDefined();
      expect(reader!.provider).toBe("codex");
      expect(reader!.model).toBe("gpt-6.1-sol");
      const prompt = await jobPrompt(s, reader!.id);
      expect(prompt).toContain(TUTOR_SENTINEL.reader);
      expect(prompt.startsWith(`# Writing style\n\n${TUTOR_LENS}\n\n`)).toBe(true);
    });

    await test.step("plain Re-do guide re-runs as the default", async () => {
      const redo = await apiJson(s, "POST", `/api/reviews/${id}/redo`, {});
      expect(redo.status).toBe(202);
      const forkedId = (redo.json as { review: { id: string; guidePersonaId: string } }).review.id;
      expect((redo.json as { review: { guidePersonaId: string } }).review.guidePersonaId).toBe("tutor");
      await waitGuide(s, forkedId);

      await test.step("Re-do with Guide still picks explicitly", async () => {
        const explicit = await apiJson(s, "POST", `/api/reviews/${forkedId}/redo`, { personaId: "guide" });
        expect(explicit.status).toBe(202);
        expect((explicit.json as { review: { guidePersonaId: string } }).review.guidePersonaId).toBe("guide");
      });
    });
  });
});
