/**
 * Language detection for diff highlighting (spike/shiki-highlighting, Refs #23).
 *
 * Maps a file path to a Shiki language id via extension + exact filename.
 * Unknown extensions return null: the row stays plain text (today's render).
 *
 * The shipped set is deliberately small (see SHIPPED_LANGS): every entry
 * becomes a lazy chunk, and some grammars are large (cpp pulls ~33 KB gzip
 * alone; the `.rst` changelog in the demo diff is intentionally NOT shipped
 * and degrades to plain). Shebangs are not consulted: hunk rows don't carry
 * file headers, and fetching file content for detection would cost an API
 * call per file for almost no gain (extensionless scripts are rare in
 * diffs).
 */

export type ShikiLangId =
  | "python"
  | "typescript"
  | "javascript"
  | "tsx"
  | "jsx"
  | "json"
  | "jsonc"
  | "markdown"
  | "bash"
  | "yaml"
  | "css"
  | "html"
  | "toml";

/** Languages bundled (lazily) by the prototype. */
export const SHIPPED_LANGS: readonly ShikiLangId[] = [
  "python",
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "json",
  "jsonc",
  "markdown",
  "bash",
  "yaml",
  "css",
  "html",
  "toml",
];

const BY_EXTENSION: Record<string, ShikiLangId> = {
  py: "python",
  pyw: "python",
  pyi: "python",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "jsonc",
  md: "markdown",
  markdown: "markdown",
  sh: "bash",
  bash: "bash",
  zsh: "bash", // No zsh grammar in Shiki; shellscript is the closest.
  yml: "yaml",
  yaml: "yaml",
  css: "css",
  html: "html",
  htm: "html",
  toml: "toml",
};

/** Exact basenames (Dockerfile has no usable suffix). */
export function filenameLanguage(base: string): ShikiLangId | null {
  if (/^dockerfile(\..*)?$/i.test(base)) return "bash";
  return null;
}

/**
 * Detect the highlight language for a repo-relative path.
 * Returns null for unknown languages (plain render), binary-ish names,
 * and paths without a usable suffix.
 */
export function detectLanguage(path: string): ShikiLangId | null {
  const base = path.split("/").pop() ?? path;
  // Exact-filename rules first (Dockerfile has no suffix; Makefiles have
  // no Shiki grammar and stay plain).
  const byName = filenameLanguage(base);
  if (byName) return byName;
  if (/^(makefile|gnumakefile)$/i.test(base) || /\.mk$/i.test(base)) return null;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  return BY_EXTENSION[ext] ?? null;
}

/**
 * Dynamic importer for a shipped language. One `import()` per language so
 * Vite emits one lazy chunk per grammar, loaded on first use: nothing for
 * that language is in the initial bundle.
 */
export function importLanguage(lang: ShikiLangId): Promise<{ default: unknown }> {
  switch (lang) {
    case "python":
      return import("shiki/langs/python.mjs");
    case "typescript":
      return import("shiki/langs/typescript.mjs");
    case "javascript":
      return import("shiki/langs/javascript.mjs");
    case "tsx":
      return import("shiki/langs/tsx.mjs");
    case "jsx":
      return import("shiki/langs/jsx.mjs");
    case "json":
      return import("shiki/langs/json.mjs");
    case "jsonc":
      return import("shiki/langs/jsonc.mjs");
    case "markdown":
      return import("shiki/langs/markdown.mjs");
    case "bash":
      return import("shiki/langs/shellscript.mjs");
    case "yaml":
      return import("shiki/langs/yaml.mjs");
    case "css":
      return import("shiki/langs/css.mjs");
    case "html":
      return import("shiki/langs/html.mjs");
    case "toml":
      return import("shiki/langs/toml.mjs");
  }
}
