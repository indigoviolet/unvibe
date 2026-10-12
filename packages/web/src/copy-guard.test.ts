/**
 * User-facing copy guard (issue #45, section 4).
 *
 * Parses source with the TypeScript compiler API and looks only at string
 * literals, template-literal text and JSX text and attribute values.
 * Comments are never visited, so "PRD §8" in a comment stays legal.
 *
 * Scope: `packages/web/src/**` (not `*.test.*`, not `mock/`),
 * `packages/web/public/*.html` and `*.js` (HTML comments, tags and
 * style/script blocks stripped; `.js` parsed, so its comments are skipped
 * too), `packages/service/src/cli/**`, and in
 * `packages/service/src/routes/**` and `pipeline/actions/**` only the
 * literals passed to `.send({ error: … })` and `new Error(…)`.
 *
 * Fails on the first list everywhere, plus the second (smaller) jargon
 * list for web text outside `debug/` and `doctor/`. Exceptions go in
 * ALLOWLIST below, each with the file, the pattern and a one-line reason,
 * so adding one is a visible decision. Failures print `file:line` and the
 * offending text.
 */
import * as ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const WEB_SRC = path.resolve(ROOT, "packages/web/src");
const WEB_PUBLIC = path.resolve(ROOT, "packages/web/public");
const SERVICE_SRC = path.resolve(ROOT, "packages/service/src");

interface Pattern {
  name: string;
  rx: RegExp;
}

const FIRST: Pattern[] = [
  { name: "PRD", rx: /\bPRD\b/ },
  { name: "section-sign", rx: /§/ },
  { name: "issue-ref", rx: /issue #\d+/i },
  { name: "bare-hash-num", rx: /#\d/ },
  { name: "milestone", rx: /\bM[1-9]\b/ },
  { name: "not-implemented", rx: /not implemented/i },
  { name: "not-wired", rx: /not wired/i },
];

const SECOND: Pattern[] = [
  { name: "base session", rx: /base session/i },
  { name: "append-only", rx: /append-only/i },
  { name: "contribution", rx: /contribution/i },
  { name: "snapshot", rx: /snapshot/i },
  { name: "lease", rx: /lease/i },
  { name: "ACP", rx: /\bACP\b/ },
  { name: "adapter", rx: /adapter/i },
  { name: "worktree", rx: /worktree/i },
  { name: "ingest", rx: /ingest/i },
  { name: "update pass", rx: /update pass/i },
  { name: "probe", rx: /\bprobe\b/i },
];

interface AllowEntry {
  file: string;
  pattern: string;
  reason: string;
}

const ALLOWLIST: AllowEntry[] = [
  {
    file: "packages/web/src/components/Icon.tsx",
    pattern: "milestone",
    reason: "SVG icon path data in d attributes, never rendered as text.",
  },
  {
    file: "packages/web/src/api/client.ts",
    pattern: "contribution",
    reason: "API route paths (/contributions), not user text.",
  },
  {
    file: "packages/web/src/state/store.ts",
    pattern: "snapshot",
    reason: "WebSocket event-type discriminator, never rendered.",
  },
];

interface Finding {
  file: string;
  line: number;
  pattern: string;
  text: string;
}

function isModuleSpecifier(node: ts.StringLiteralLike): boolean {
  const p = node.parent;
  return (
    (ts.isImportDeclaration(p) && p.moduleSpecifier === node) ||
    (ts.isExportDeclaration(p) && p.moduleSpecifier === node)
  );
}

function literalText(node: ts.Expression): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join("");
  }
  return null;
}

function collectTs(source: string, file: string, onlyErrors: boolean): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const push = (node: ts.Node, text: string): void => {
    const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    out.push({ line: pos.line + 1, text });
  };
  const visit = (node: ts.Node): void => {
    if (!onlyErrors) {
      if (ts.isStringLiteralLike(node) && !isModuleSpecifier(node)) {
        push(node, node.text);
      } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        push(node, node.text);
      } else if (ts.isJsxText(node) && node.text.trim() !== "") {
        push(node, node.text);
      }
    } else {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "send" &&
        node.arguments.length === 1 &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        for (const prop of node.arguments[0].properties) {
          if (ts.isPropertyAssignment(prop) && prop.name.getText(sf) === "error") {
            const text = literalText(prop.initializer);
            if (text !== null) push(prop.initializer, text);
          }
        }
      }
      if (
        ts.isNewExpression(node) &&
        node.expression.getText(sf) === "Error" &&
        node.arguments !== undefined &&
        node.arguments.length > 0
      ) {
        const text = literalText(node.arguments[0]);
        if (text !== null) push(node.arguments[0], text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((ext) => full.endsWith(ext))) out.push(full);
  }
  return out.sort();
}

function checkTexts(
  rel: string,
  texts: { line: number; text: string }[],
  patterns: Pattern[],
  findings: Finding[],
): void {
  for (const { line, text } of texts) {
    for (const { name, rx } of patterns) {
      if (!rx.test(text)) continue;
      const allowed = ALLOWLIST.some((a) => rel.endsWith(a.file) && a.pattern === name);
      if (!allowed) findings.push({ file: rel, line, pattern: name, text: text.trim().slice(0, 120) });
    }
  }
}

function collectFindings(): Finding[] {
  const findings: Finding[] = [];
  for (const full of walk(WEB_SRC, [".ts", ".tsx"])) {
    const rel = path.relative(ROOT, full);
    if (rel.includes(".test.") || rel.includes("/mock/")) continue;
    const second = !rel.includes("/debug/") && !rel.includes("/doctor/");
    checkTexts(rel, collectTs(fs.readFileSync(full, "utf8"), full, false), second ? [...FIRST, ...SECOND] : FIRST, findings);
  }
  for (const full of walk(WEB_PUBLIC, [".html"])) {
    const rel = path.relative(ROOT, full);
    let text = fs.readFileSync(full, "utf8");
    text = text.replace(/<!--[\s\S]*?-->/g, " ");
    text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
    text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
    text = text.replace(/<[^>]*>/g, " ");
    checkTexts(
      rel,
      text.split("\n").map((line, i) => ({ line: i + 1, text: line })),
      FIRST,
      findings,
    );
  }
  for (const full of walk(WEB_PUBLIC, [".js"])) {
    const rel = path.relative(ROOT, full);
    checkTexts(rel, collectTs(fs.readFileSync(full, "utf8"), full, false), FIRST, findings);
  }
  for (const full of walk(path.join(SERVICE_SRC, "cli"), [".ts"])) {
    const rel = path.relative(ROOT, full);
    if (rel.includes(".test.")) continue;
    checkTexts(rel, collectTs(fs.readFileSync(full, "utf8"), full, false), FIRST, findings);
  }
  for (const dir of ["routes", "pipeline/actions"]) {
    for (const full of walk(path.join(SERVICE_SRC, dir), [".ts"])) {
      const rel = path.relative(ROOT, full);
      if (rel.includes(".test.")) continue;
      checkTexts(rel, collectTs(fs.readFileSync(full, "utf8"), full, true), FIRST, findings);
    }
  }
  return findings;
}

describe("user-facing copy guard", () => {
  it("carries no spec refs, issue numbers, milestones or jargon", () => {
    const findings = collectFindings();
    const message = findings.map((f) => `${f.file}:${f.line} [${f.pattern}] ${f.text}`).join("\n");
    expect(message, message === "" ? undefined : `\n${message}`).toBe("");
  });
});
