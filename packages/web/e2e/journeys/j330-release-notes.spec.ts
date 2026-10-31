/**
 * J330: release notes in the app on the real service (fake updater, no
 * network). An updated build shows the What's new card once on the start
 * page, and Settings → Version shows the current notes plus a channel's
 * newest notes fetched on demand. Issue text renders as plain text.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

const NEW_VERSION = "0.0.1-preview.feat-x.abc1234";

function notesFor(channel: string, version: string, summary: string) {
  return {
    channel,
    version,
    previousVersion: "0.0.1",
    commit: "abc1234def5678",
    previousCommit: "b535a30ccccccc",
    dataFormat: 1,
    previousDataFormat: 1,
    dataResetNeeded: false,
    generatedAt: "2026-10-31T00:00:00.000Z",
    items: [
      {
        number: 330,
        title: "Release notes inside every build",
        summary,
        url: "https://github.com/indigoviolet/unvibe/issues/330",
        whatChanged: "Every build now ships its release notes.",
        whatToTry: "Open Settings, then Version, and read the notes.",
        caveats: "Full gates not yet run. <b>not bold</b>",
      },
    ],
  };
}

test.describe("J330 release notes", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j330-data-"));
    // Stamp the data format (#311): a seeded dir without it reads as
    // pre-format data and the service shows the reset notice instead.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
    db.exec("PRAGMA user_version = 1");
    db.close();
    mkdirSync(path.join(dataDir, "update"), { recursive: true });
    writeFileSync(
      path.join(dataDir, "update", "fake-channels.json"),
      JSON.stringify([
        { ref: "release", kind: "release", version: "0.0.1", commit: "b535a30ccccccc", sourceBranch: null, builtAt: "2026-10-28T00:00:00.000Z", dataFormat: 1 },
        { ref: "preview/feat-x", kind: "preview", version: NEW_VERSION, commit: "abc1234def5678", sourceBranch: "feat/x", builtAt: "2026-10-31T00:00:00.000Z", dataFormat: 1 },
      ]),
    );
    writeFileSync(path.join(dataDir, "update", "current-ref"), "preview/feat-x\n");
    writeFileSync(
      path.join(dataDir, "update", "outcome.json"),
      JSON.stringify({
        status: "ok",
        from: "release",
        to: "preview/feat-x",
        finishedAt: "2026-10-31T00:00:00.000Z",
        fromVersion: "0.0.1",
        toVersion: NEW_VERSION,
      }) + "\n",
    );
    writeFileSync(
      path.join(dataDir, "update", "fake-release-notes.json"),
      JSON.stringify({
        "preview/feat-x": notesFor("preview/feat-x", NEW_VERSION, "Release notes inside every build"),
        release: notesFor("release", "0.0.1", "Earlier release notes"),
      }),
    );
    svc = await startService(dataDir, { agent: "none", extraEnv: { UNVIBE_UPDATER_BACKEND: "fake" } });
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("updated build shows What's new once; Version shows current + channel notes", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");

    await page.goto(`${svc.origin}/?token=${svc.token}`);
    const card = page.getByTestId("whats-new-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(`What's new in ${NEW_VERSION}`);
    await expect(card).toContainText("What to try:");
    await expect(card).toContainText("Full gates not yet run. <b>not bold</b>");
    // Plain text only: the literal tag never becomes an element.
    await expect(card.locator("b")).toHaveCount(0);

    await page.getByTestId("whats-new-dismiss").click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("Open a PR by URL or number")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("whats-new-card")).toHaveCount(0);

    await page.goto(`${svc.origin}/settings?token=${svc.token}`);
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "Version" }).click();
    await expect(page.getByRole("tabpanel", { name: "Version" })).toBeVisible({ timeout: 15_000 });

    const current = page.getByTestId("current-release-notes");
    await expect(current).toBeVisible({ timeout: 15_000 });
    await expect(current).toContainText("Every build now ships its release notes.");

    const toggle = page.getByTestId("version-picker-toggle");
    if (!(await toggle.isChecked())) await toggle.click();
    await expect(page.locator('[data-testid="update-channel"][data-ref="release"]')).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-testid="channel-notes-toggle"][data-ref="release"]').click();
    const channelNotes = page.locator('[data-testid="channel-release-notes"][data-ref="release"]');
    await expect(channelNotes).toBeVisible({ timeout: 15_000 });
    await expect(channelNotes).toContainText("Earlier release notes");
  });
});
