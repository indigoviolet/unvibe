#!/usr/bin/env node
/*global console process */
/**
 * Fork helper (issue #393).
 *
 * Copies base prompt templates into a persona's fork folder and writes
 * the fork manifest (per forked file, the base file's sha256 when
 * recorded):
 *
 *   node scripts/persona-fork.mjs <persona-id> <template> [<template> ...]
 *
 * Named files are copied only when the fork lacks them — never
 * overwritten, so a manual merge survives. The manifest always records
 * the CURRENT base hashes of every forked file, so re-running it after
 * a manual merge clears the drift warning for the merged files. With no
 * template names it only (re)writes the manifest.
 *
 * `--prompts-dir <dir>` overrides the prompts directory (default:
 * `UNVIBE_PROMPTS_DIR`, else walk up from this script to the first
 * ancestor containing `prompts/instructions.md`).
 *
 * The manifest shape is read by `readForkManifest` in
 * `packages/service/src/prompts/personas.ts` (and pinned by its test):
 * `{ "personaId": "<id>", "files": { "<name>": "<sha256>" } }`.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const MANIFEST = "fork.json";

function fail(message) {
  console.error(`persona-fork: ${message}`);
  process.exit(1);
}

function resolvePromptsDir(explicit) {
  if (explicit) {
    if (!fs.existsSync(path.join(explicit, "instructions.md"))) fail(`no prompts dir: ${explicit}`);
    return explicit;
  }
  const override = process.env.UNVIBE_PROMPTS_DIR;
  if (override && fs.existsSync(path.join(override, "instructions.md"))) return override;
  let dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (;;) {
    const candidate = path.join(dir, "prompts");
    if (fs.existsSync(path.join(candidate, "instructions.md"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) fail("no prompts dir found (set UNVIBE_PROMPTS_DIR or --prompts-dir)");
    dir = parent;
  }
}

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function main() {
  const raw = process.argv.slice(2).filter((a) => a !== "--");
  let promptsDir = null;
  const positional = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "--prompts-dir") {
      promptsDir = raw[++i];
      if (!promptsDir) fail("missing value for --prompts-dir");
    } else if (raw[i].startsWith("--")) {
      fail(`unknown flag: ${raw[i]}`);
    } else {
      positional.push(raw[i]);
    }
  }
  const [personaId, ...names] = positional;
  if (!personaId) fail("usage: persona-fork.mjs <persona-id> [template ...] [--prompts-dir <dir>]");
  const dir = resolvePromptsDir(promptsDir);
  const baseNames = new Set(
    fs
      .readdirSync(dir)
      .filter((e) => e.endsWith(".md"))
      .map((e) => e.slice(0, -".md".length)),
  );
  for (const name of names) {
    if (!baseNames.has(name)) fail(`not a base template: ${name}`);
  }
  const forkDir = path.join(dir, "personas", personaId);
  fs.mkdirSync(forkDir, { recursive: true });
  const copied = [];
  const skipped = [];
  for (const name of names) {
    const dest = path.join(forkDir, `${name}.md`);
    if (fs.existsSync(dest)) {
      skipped.push(name);
      continue;
    }
    fs.copyFileSync(path.join(dir, `${name}.md`), dest);
    copied.push(name);
  }
  const forked = fs
    .readdirSync(forkDir)
    .filter((e) => e.endsWith(".md") && baseNames.has(e.slice(0, -".md".length)))
    .map((e) => e.slice(0, -".md".length))
    .sort();
  const files = {};
  for (const name of forked) {
    files[name] = sha256Hex(fs.readFileSync(path.join(dir, `${name}.md`), "utf8"));
  }
  fs.writeFileSync(path.join(forkDir, MANIFEST), `${JSON.stringify({ personaId, files }, null, 2)}\n`, "utf8");
  for (const name of copied) console.log(`copied ${name}.md`);
  for (const name of skipped) console.log(`kept ${name}.md (already forked)`);
  console.log(`manifest: ${forked.length} forked file(s) recorded for "${personaId}"`);
}

main();
