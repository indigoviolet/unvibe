/**
 * Release-notes generator helpers (#330), dependency-free so vitest can
 * import them directly (same pattern as preview-lib.mjs).
 *
 * Previous-build rule (owner decision on #330): the previous build is
 * ALWAYS the newest `v*` release tag reachable from HEAD, on every
 * channel — preview notes are cumulative since the last release. When
 * building the release itself, the current version's tag is excluded.
 * `previousVersion: null` and full history only when there is no such
 * tag at all. The tag anchors `git log <prev>..HEAD --merges`.
 *
 * One-liner rule: `summary` is the issue title's first line when `gh`
 * returns one; otherwise the merge subject with its `Merge ...` prefix
 * stripped. A human notes entry's `whatChanged` first line replaces the
 * summary when present.
 */
import { dataResetSection, parseDataFormat } from "./release-notes-lib.mjs";

export { parseDataFormat };

const ISSUE_RE = /#(\d+)/g;

/** Issue numbers named in a merge subject/body, in order, deduped. */
export function extractIssueNumbers(...texts) {
  const out = [];
  const seen = new Set();
  for (const text of texts) {
    for (const m of String(text ?? "").matchAll(ISSUE_RE)) {
      const n = Number(m[1]);
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
  }
  return out;
}

/**
 * Parse `git log --merges --pretty=format:%H%x1f%s%x1f%b%x1e` output into
 * `[{ sha, subject, body, issues }]`, newest first (git's order).
 */
export function parseMergeLog(output) {
  const records = String(output ?? "").split("\x1e");
  const out = [];
  for (const rec of records) {
    const trimmed = rec.replace(/^\n+/, "");
    if (!trimmed.trim()) continue;
    const [sha = "", subject = "", body = ""] = trimmed.split("\x1f");
    out.push({
      sha: sha.trim(),
      subject: subject.trim(),
      body: body.trim(),
      issues: extractIssueNumbers(subject, body),
    });
  }
  return out;
}

/**
 * Merge subject without its merge shell. A trailing `(#N: text)`
 * parenthetical carries the real description — take its text. Else
 * strip `Merge pull request #N from <branch>`, `Merge [branch] ...`
 * and any `into <branch>` tail, for quoted and unquoted branch names.
 */
export function cleanMergeSubject(subject) {
  let s = String(subject ?? "").trim();
  const paren = /\((#\d+[:\s][^)]*)\)/.exec(s);
  if (paren) {
    const inner = paren[1].replace(/^#\d+[:\s]*/, "").trim();
    if (inner) return inner;
  }
  s = s.replace(/^Merge pull request #\d+ from \S+\s*/i, "").trim();
  s = s.replace(/^Merge branch '[^']+'(?:\s+of\s+\S+)?\s*/i, "").trim();
  s = s.replace(/^Merge branch "[^"]+"(?:\s+of\s+\S+)?\s*/i, "").trim();
  s = s.replace(/^Merge remote-tracking branch '[^']+'\s*/i, "").trim();
  // Unquoted branch merge: `Merge feat/x into main-rc` is all shell.
  s = s.replace(/^Merge \S+ into \S+\s*/i, "").trim();
  s = s.replace(/^into \S+\s*/i, "").trim();
  s = s.replace(/\s+into \S+$/i, "").trim();
  return s;
}

/**
 * True when a human `whatChanged` adds more than the one-liner: it is
 * not shown separately when it merely repeats the summary (its first
 * line became the summary); it is shown when it carries extra lines.
 */
export function whatChangedAddsMore(item) {
  const wc = typeof item?.whatChanged === "string" ? item.whatChanged.trim() : "";
  if (!wc) return false;
  return wc !== String(item?.summary ?? "").trim();
}

/** First non-empty line of a text, trimmed. */
export function firstLine(text) {
  for (const line of String(text ?? "").split("\n")) {
    const t = line.trim();
    if (t) return t;
  }
  return "";
}

/** One-liner for an item: issue title's first line, else cleaned merge subject (may be empty). */
export function chooseSummary({ title, subject }) {
  const fromTitle = firstLine(title);
  if (fromTitle) return fromTitle;
  return cleanMergeSubject(subject);
}

function cleanField(v) {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/**
 * Parse a publisher notes file into `{ [issueNumber]: entry }`. Accepts
 * either a map (`{ "330": { whatChanged, whatToTry, caveats } }`), an
 * `{ items: [...] }` wrapper, or a bare array of
 * `{ number, whatChanged, whatToTry, caveats }`. Unknown shapes and
 * non-string fields are dropped (fail closed: no raw passthrough).
 */
export function parseHumanNotes(raw) {
  let doc = raw;
  if (typeof raw === "string") {
    try {
      doc = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  const out = {};
  const put = (num, entry) => {
    const n = typeof num === "string" ? Number(num) : num;
    if (!Number.isInteger(n) || n <= 0 || !entry || typeof entry !== "object") return;
    const cleaned = {};
    for (const k of ["whatChanged", "whatToTry", "caveats"]) {
      const v = cleanField(entry[k]);
      if (v !== undefined) cleaned[k] = v;
    }
    if (Object.keys(cleaned).length > 0) out[n] = cleaned;
  };
  if (Array.isArray(doc)) {
    for (const e of doc) put(e?.number, e);
  } else if (doc && typeof doc === "object") {
    if (Array.isArray(doc.items)) {
      for (const e of doc.items) put(e?.number, e);
    } else {
      for (const [k, v] of Object.entries(doc)) put(k, v);
    }
  }
  return out;
}

/**
 * Merge human entries into generated items. With an entry, its fields
 * ride on the item and `whatChanged`'s first line becomes the summary;
 * without one the item keeps only the generated one-liner (fallback).
 */
export function mergeHumanNotes(items, human) {
  const map = human ?? {};
  return (items ?? []).map((item) => {
    const entry = map[item.number] ?? map[String(item.number)];
    if (!entry) return { ...item };
    const next = { ...item };
    if (entry.whatChanged) {
      next.whatChanged = entry.whatChanged;
      next.summary = firstLine(entry.whatChanged) || item.summary;
    }
    if (entry.whatToTry) next.whatToTry = entry.whatToTry;
    if (entry.caveats) next.caveats = entry.caveats;
    return next;
  });
}

/** Assemble the `release-notes.json` document (pure). */
export function buildReleaseNotes({
  channel,
  version,
  previousVersion = null,
  commit = null,
  previousCommit = null,
  dataFormat = null,
  previousDataFormat = null,
  generatedAt = new Date().toISOString(),
  items = [],
}) {
  const prev = previousDataFormat ?? null;
  const dataResetNeeded =
    dataFormat !== null && dataFormat !== undefined && prev !== null && prev !== dataFormat;
  return {
    channel,
    version,
    previousVersion: previousVersion ?? null,
    commit: commit ?? null,
    previousCommit: previousCommit ?? null,
    dataFormat: dataFormat ?? null,
    previousDataFormat: prev,
    dataResetNeeded,
    generatedAt,
    items,
  };
}

/** Issue URL in this repo (notes come only from this repo, #330). */
export function issueUrl(repo, number) {
  return `https://github.com/${repo}/issues/${number}`;
}

/**
 * Generate notes through an injectable runner:
 * `runner(cmd, args, opts?) -> Promise<{ stdout, stderr, code }>`.
 * `gh` is invoked with `GITHUB_TOKEN` unset by the caller's runner env
 * contract (the CLI runner deletes it; tests assert the args only).
 * Every external failure degrades: unreadable previous build -> first
 * build; failed log -> no items; failed `gh` view -> merge-subject title.
 */
export async function generateReleaseNotes({
  runner,
  channel,
  version,
  head = "HEAD",
  repo = "indigoviolet/unvibe",
  humanNotes = {},
  generatedAt,
}) {
  const run = async (cmd, args) => {
    try {
      return await runner(cmd, args, {});
    } catch {
      return { stdout: "", stderr: "", code: 1 };
    }
  };
  const gitShow = async (ref, file) => {
    const r = await run("git", ["show", `${ref}:${file}`]);
    return r.code === 0 ? r.stdout : null;
  };

  // Previous build (owner decision on #330): ALWAYS the newest `v*`
  // release tag reachable from HEAD, on every channel — preview notes
  // are cumulative since the last release. The current version's tag is
  // excluded when building that release itself. No tag at all -> null
  // and the full history is listed.
  let previousVersion = null;
  let previousCommit = null;
  let previousDataFormat = null;
  {
    const cur = `v${version}`;
    let prevTag = null;
    const desc = await run("git", ["describe", "--tags", "--abbrev=0", head]);
    if (desc.code === 0) {
      const t = desc.stdout.trim();
      if (/^v\d+\.\d+\.\d+$/.test(t) && t !== cur) prevTag = t;
    }
    if (prevTag === null) {
      const tagsRaw = await run("git", ["tag", "--list", "v*", "--merged", head, "--sort=-v:refname"]);
      if (tagsRaw.code === 0) {
        const tags = tagsRaw.stdout
          .split("\n")
          .map((s) => s.trim())
          .filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
        prevTag = tags.find((t) => t !== cur) ?? null;
      }
    }
    if (prevTag) {
      previousVersion = prevTag.replace(/^v/, "");
      previousCommit = prevTag;
    }
  }
  if (previousCommit) {
    const src = await gitShow(previousCommit, "packages/shared/src/data-format.ts");
    if (src !== null) previousDataFormat = parseDataFormat(src);
  }

  const headShaRes = await run("git", ["rev-parse", head]);
  const commit = headShaRes.code === 0 ? headShaRes.stdout.trim() || null : null;

  const range = previousCommit ? `${previousCommit}..${head}` : head;
  const logRes = await run("git", [
    "log",
    range,
    "--merges",
    "--pretty=format:%H%x1f%s%x1f%b%x1e",
  ]);
  const merges = logRes.code === 0 ? parseMergeLog(logRes.stdout) : [];

  // One item per issue, first (newest) merge wins for the fallback title.
  const subjectByIssue = new Map();
  for (const m of merges) {
    for (const n of m.issues) {
      if (!subjectByIssue.has(n)) subjectByIssue.set(n, m.subject);
    }
  }

  const items = [];
  for (const number of subjectByIssue.keys()) {
    let title = "";
    let url = issueUrl(repo, number);
    const view = await run("gh", [
      "issue",
      "view",
      String(number),
      "--json",
      "title,url",
      "-R",
      repo,
    ]);
    if (view.code === 0) {
      try {
        const parsed = JSON.parse(view.stdout);
        if (typeof parsed?.title === "string") title = parsed.title;
        if (typeof parsed?.url === "string" && parsed.url) url = parsed.url;
      } catch {
        // Keep fallbacks.
      }
    }
    const subject = subjectByIssue.get(number) ?? "";
    const itemTitle = firstLine(title) || cleanMergeSubject(subject) || `Issue #${number}`;
    items.push({
      number,
      title: itemTitle,
      summary: chooseSummary({ title, subject }) || itemTitle,
      url,
    });
  }

  const curSrc = await gitShow(head, "packages/shared/src/data-format.ts");
  const dataFormat = curSrc !== null ? parseDataFormat(curSrc) : null;

  const merged = mergeHumanNotes(items, humanNotes);
  return buildReleaseNotes({
    channel,
    version,
    previousVersion,
    commit,
    previousCommit,
    dataFormat,
    previousDataFormat,
    ...(generatedAt ? { generatedAt } : {}),
    items: merged,
  });
}

/** GitHub Release body rendered from the same notes file (#330). */
export function renderReleaseBody(notes, { branch = "release" } = {}) {
  const version = notes.version;
  const reset =
    notes.dataResetNeeded && notes.previousDataFormat !== null && notes.dataFormat !== null
      ? dataResetSection(notes.previousDataFormat, notes.dataFormat, version)
      : notes.dataResetNeeded
        ? dataResetSection(notes.previousDataFormat ?? 0, notes.dataFormat ?? 1, version)
        : null;
  const lines = [`# Unvibe ${version}`, ""];
  if (reset) lines.push(reset, "");
  lines.push(
    "Install with no flags (Node 24 or newer):",
    "",
    "```sh",
    `npm install -g github:indigoviolet/unvibe#${branch}`,
    "```",
    "",
    "No login needed: the repository is public. The attached tarball below",
    "installs the same way — download it from its plain releases/download URL",
    "and install the file:",
    "",
    "```sh",
    `npm install -g ./unvibe-${version}.tgz`,
    "```",
    "",
    "## What is in this release",
    "",
  );
  if (!notes.items || notes.items.length === 0) {
    lines.push("- (no changes listed)");
  } else {
    if (notes.previousVersion) lines.push(`Changes since ${notes.previousVersion}:`, "");
    for (const item of notes.items) {
      lines.push(`- [#${item.number}](${item.url}) ${item.summary}`);
      if (whatChangedAddsMore(item)) lines.push(`  - What changed: ${item.whatChanged}`);
      if (item.whatToTry) lines.push(`  - What to try: ${item.whatToTry}`);
      if (item.caveats) lines.push(`  - Caveats: ${item.caveats}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
