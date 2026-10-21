/** J225 (#225): start page with PR lists — the fake `gh` returns Your
 * PRs, an empty Requested-of-you, and team PRs with mixed states (open,
 * draft, merged, approved, changes requested) so #224's badges show up
 * once part A merges. `checkLayout` runs on the list in every variant.
 * No real `gh`, no network: the fake answers `pr list` from canned
 * JSON, everything else exits 1 (best-effort listings). */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { checkLayout } from "../layout-check.js";
import { apiJson, git, makeScratchRepo } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
test.use({ channel: "chromium" });

interface FakePr {
  number: number;
  title: string;
  author: { login: string };
  updatedAt: string;
  headRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  url: string;
  reviewRequests: { login?: string; slug?: string }[];
  state: string;
  isDraft: boolean;
  reviewDecision?: string;
}

function pr(n: number, title: string, branch: string, extra: Partial<FakePr> = {}): FakePr {
  return {
    number: n,
    title,
    author: { login: "teammate" },
    updatedAt: new Date().toISOString(),
    headRefName: branch,
    additions: 10 + n,
    deletions: n,
    changedFiles: 2,
    url: `https://github.com/acme/widgets/pull/${n}`,
    reviewRequests: [],
    state: "OPEN",
    isDraft: false,
    ...extra,
  };
}

// Your PRs: open + draft. Requested-of-you stays empty; the team group
// carries the rest of the state mix.
const AUTHORING: FakePr[] = [
  pr(101, "Fix quadratic backtracking in OWS matching", "fix-quadratic"),
  pr(102, "WIP: normalize folded headers on parse", "wip-normalize", { isDraft: true }),
];
const TEAM: FakePr[] = [
  pr(201, "Bump minimum Python to 3.10", "py310", { reviewRequests: [{ slug: "core-team" }] }),
  pr(202, "Drop the old compat shim", "drop-shim", { state: "MERGED" }),
  pr(203, "Add OWS regression tests", "ows-tests", { reviewDecision: "CHANGES_REQUESTED" }),
  pr(204, "Document header unfolding", "docs-unfold", { reviewDecision: "APPROVED" }),
];

function writeFakeGhPrLists(binDir: string, logDir: string): void {
  const script = `#!/bin/sh
LOG="${logDir}"
mkdir -p "$LOG"
printf '%s\\n' "$*" >> "$LOG/calls.log"
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  case "$*" in
    *"--author"*) cat <<EOF
${JSON.stringify(AUTHORING)}
EOF
      exit 0 ;;
    *"user-review-requested:@me"*) echo '[]'; exit 0 ;;
    *"review-requested:@me"*) cat <<EOF
${JSON.stringify(TEAM)}
EOF
      exit 0 ;;
  esac
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo '{"login":"reviewer"}'; exit 0; fi
echo "fake gh: unexpected call: $*" >&2; exit 1
`;
  writeFileSync(path.join(binDir, "gh"), script, { mode: 0o755 });
}

test.describe("J225 start-page PR list", () => {
  let repoDir = "";
  let dataDir = "";
  let logDir = "";
  let fakeBin = "";
  let svc: RunningService | null = null;
  let repoId = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j225pr-repo-"));
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j225pr-data-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j225pr-gh-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-j225pr-bin-"));
    await makeScratchRepo(repoDir);
    await git(repoDir, "remote", "add", "origin", "https://github.com/acme/widgets.git");
    writeFakeGhPrLists(fakeBin, logDir);
    const fakeShell = path.join(fakeBin, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, { mode: 0o755 });
    svc = await startService(dataDir, {
      agent: "none",
      extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    const repos = await apiJson(svc, "POST", "/api/repos", { path: repoDir });
    const list = (repos.json as { repos: { id: string; localPath: string }[] }).repos;
    const registered = list.find((r) => r.localPath === repoDir);
    if (!registered) throw new Error(`repo not registered: ${JSON.stringify(list)}`);
    repoId = registered.id;
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir, logDir, fakeBin]) rmSync(d, { recursive: true, force: true });
  });

  for (const combo of [
    { name: "1440-light", width: 1440, dark: false },
    { name: "1440-dark", width: 1440, dark: true },
    { name: "960-light", width: 960, dark: false },
    { name: "960-dark", width: 960, dark: true },
  ] as const) {
    test(`pr lists read and share the column edge (${combo.name})`, async ({ page }) => {
      test.setTimeout(180_000);
      if (!svc) throw new Error("no service");
      await page.setViewportSize({ width: combo.width, height: 900 });
      if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
      await page.addInitScript((id) => {
        try {
          localStorage.setItem("unvibe.start.repoId", id);
        } catch {
          // Start page falls back to no selection; asserts below fail.
        }
      }, repoId);
      await page.goto(`${svc.origin}/?token=${svc.token}`);
      // Your PRs (open + draft).
      await expect(page.getByText("Fix quadratic backtracking in OWS matching")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("WIP: normalize folded headers on parse")).toBeVisible();
      // Requested of you: empty sub-group, same indent treatment.
      await expect(page.getByTestId("requested-direct-empty")).toContainText("No PRs requested of you.");
      // Requested of your team: the rest of the state mix.
      await expect(page.getByText("Bump minimum Python to 3.10")).toBeVisible();
      await expect(page.getByText("Drop the old compat shim")).toBeVisible();
      await expect(page.getByText("Add OWS regression tests")).toBeVisible();
      await expect(page.getByText("Document header unfolding")).toBeVisible();
      await page.getByText("No PRs requested of you.").scrollIntoViewIfNeeded();
      await checkLayout(page, `start-pr-list-${combo.name}`);
    });
  }
});
