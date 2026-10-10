/**
 * File classification (ingest, PRD §11.1 step "classify files").
 *
 * Language-agnostic (the prototype only handled `.py`): categories are
 * Source, Tests, Docs, Config, Generated (PRD §4.13 file-type chips).
 *
 * Precedence: generated > tests > docs > config > source.
 *
 * - Generated: `.gitattributes linguist-generated` (checked by the caller
 *   via `git check-attr`, passed in) or well-known generated path rules.
 * - Tests: test directories / test file-name conventions (any language).
 * - Docs: prose extensions or docs/changelog directories.
 * - Config: well-known config file names, config extensions, config dirs.
 * - Source: everything else.
 */
import type { FileCategory } from "@unvibe/shared";

const TEST_DIR = /(^|\/)(tests?|__tests__|test|spec|e2e)($|\/)/;
const TEST_FILE =
  /(^|\/)(test[_-].*|.*[_-]test|.*\.(test|spec))\.[A-Za-z0-9]+$|^.*\.(test|spec)\.[A-Za-z0-9]+$/;

const DOCS_EXT = /\.(md|markdown|rst|txt|adoc|textile)$/i;
const DOCS_DIR = /(^|\/)(docs|documentation|changelog|changes|news)($|\/)/i;

const CONFIG_NAMES = new Set([
  "dockerfile",
  "containerfile",
  "makefile",
  "cmakelists.txt",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "jsconfig.json",
  ".eslintrc",
  ".prettierrc",
  "pyproject.toml",
  "setup.cfg",
  "tox.ini",
  "cargo.toml",
  "cargo.lock",
  "go.mod",
  "go.sum",
  "gemfile",
  "gemfile.lock",
  "pom.xml",
  "build.gradle",
  "composer.json",
  "cmakelists",
  ".gitignore",
  ".gitattributes",
  ".gitmodules",
  "docker-compose.yml",
  "docker-compose.yaml",
]);
const CONFIG_EXT = /\.(ya?ml|toml|ini|cfg|conf|json5|jsonc|properties|env)$/i;
const CONFIG_DIR = /(^|\/)(config|configs|settings|\.github|\.vscode|\.circleci)($|\/)/;

const GENERATED_RE =
  /(^|\/)(dist|build|out|target|vendor|node_modules|__pycache__|\.next|coverage)($|\/)|\.(min\.js|min\.css|bundle\.js|bundle\.css|map|lock\.data|snap)$/i;

export interface ClassifyOptions {
  /**
   * Basenames (or full paths) marked `linguist-generated` in `.gitattributes`.
   * The caller resolves these with `git check-attr linguist-generated`.
   */
  linguistGenerated?: Set<string>;
}

/** Classify one repo-relative path. Pure. */
export function classifyFile(filePath: string, opts: ClassifyOptions = {}): FileCategory {
  const lower = filePath.toLowerCase();
  const base = lower.split("/").pop() ?? lower;

  if (opts.linguistGenerated?.has(filePath) || opts.linguistGenerated?.has(base)) {
    return "generated";
  }
  if (GENERATED_RE.test(lower)) return "generated";
  if (TEST_DIR.test(lower) || TEST_FILE.test(lower)) return "tests";
  if (DOCS_EXT.test(lower) || DOCS_DIR.test(lower)) return "docs";
  const baseNoDot = base.startsWith(".") ? base.slice(1) : base;
  if (
    CONFIG_NAMES.has(base) ||
    CONFIG_NAMES.has(baseNoDot) ||
    CONFIG_EXT.test(lower) ||
    CONFIG_DIR.test(lower)
  ) {
    return "config";
  }
  return "source";
}

/**
 * Derive a stable file key for a path (PRD §7.2 `h:`/`diff:` IDs).
 *
 * The key must be unique within a review, stable across versions, and free
 * of `:`/`@` (the ID grammar reserves those). Full paths satisfy all three,
 * so the key is the path with every non-`[A-Za-z0-9_.-]` char (including
 * `/`) mapped to `-`.
 */
export function fileKeyForPath(filePath: string): string {
  return filePath.replace(/[^A-Za-z0-9_.-]/g, "-");
}
