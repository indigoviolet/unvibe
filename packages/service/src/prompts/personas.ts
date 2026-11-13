/**
 * Persona prompt composition (issue #349, owner decision 2026-11-03).
 *
 * A persona's prompt is composed in layers:
 * 1. **Base instructions** (`prompts/instructions.md`): format, citations
 *    and rules. Shared, unchanged.
 * 2. **Persona lens** (required): who the persona is and what it looks
 *    for. Applied to every task the persona performs — it travels in the
 *    system prompt, below the base instructions, and (issue #359,
 *    option B) at the start of every persona turn's prompt, so
 *    same-model personas forking main's shared base still see it.
 * 3. **Task template** (shared, from `prompts/`, the same templates the
 *    main guide uses): the card task is the new `persona_card.md`
 *    ("here is the guide's version of this card; write your version");
 *    Explain / Ask use `ask.md` / `ask_turn.md`; slower rewrites,
 *    examples, diagram and concept pages use their own templates unchanged.
 *
 * The persona's **card instruction** overrides the card task's default
 * for that persona (e.g. Second opinion's "respond to the card …"). When
 * it is empty, the card task's default applies. No per-task overrides
 * for Explain, Ask or slower rewrites in v1; the input shape stays open
 * for them.
 *
 * Pure except for the template library passed in (rendered by the
 * caller from the prompts dir, as everywhere else).
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { GUIDE_PERSONA_ID, type AccessMode, type Persona, type ReviewSnapshot } from "@unvibe/shared";
import { loadTemplatesDirSync, renderTemplate, type TemplateLibrary } from "./index.js";
import { parseTemplate, TemplateLoadError } from "./loader.js";
import { renderSystemPrompt } from "./access.js";

/**
 * Main writing turns covered by the Guide lens (issue #379): the
 * templates rendered for main-agent turns (`runInFork` plus the reader
 * guide turn). Persona turns and the repair follow-ups that continue an
 * already-prefixed session are excluded. One set, so switching
 * placement later touches one place.
 */
export const GUIDE_STYLE_TEMPLATES: ReadonlySet<string> = new Set([
  "reader",
  "go_deeper",
  "slower",
  "ask",
  "ask_turn",
]);

/**
 * Prefix the Guide's writing-style lens to a main writing turn. Empty
 * lens returns the prompt unchanged (byte-identical). The lens governs
 * tone and wording only: the task's own rules stay authoritative, said
 * in the section so the model cannot mistake style for new output
 * rules. Persona turns never pass through here.
 */
export function withGuideWritingStyle(prompt: string, lens: string): string {
  const style = lens.trim();
  if (style === "") return prompt;
  return (
    `# Writing style\n\n${style}\n\n` +
    `(This governs tone and wording only; the task's rules below on structure, citations, ` +
    `containers and JSON output take precedence.)\n\n${prompt}`
  );
}

/**
 * Prefix the Guide lens to one turn of a main writing task (issue
 * #379): the single placement helper for every main-turn site (first
 * turns, connection retries, the reader). Persona tasks and repair
 * follow-ups never call it. A template outside the set, or an empty
 * lens, returns the prompt unchanged.
 */
export function withGuideStyleForTurn(template: string, prompt: string, lens: string): string {
  if (!GUIDE_STYLE_TEMPLATES.has(template)) return prompt;
  return withGuideWritingStyle(prompt, lens);
}

/**
 * Card-task default: what an empty card instruction means. Kept here
 * (not in the template) so the override decision stays testable in one
 * place and the template only carries its variables.
 */
export const DEFAULT_CARD_INSTRUCTION =
  "Here is the guide's version of this card. Write your version: cover the same ground in your own words, with your own judgement of what matters.";

export interface PersonaCardInput {
  /** Lock-down or full-access posture for the L0 render. */
  access: AccessMode;
  /** The persona's lens (required, non-empty). */
  lens: string;
  /** The guide's version of the card (text + citations). */
  card: string;
  /** The persona's card instruction; empty means the default applies. */
  cardInstruction?: string;
}

export interface PersonaPrompt {
  /** L0 base instructions + the persona lens. */
  system: string;
  /** Rendered `persona_card.md` turn. */
  turn: string;
  /** The card instruction that was actually used (override or default). */
  cardInstruction: string;
}

/**
 * Compose the system prompt + card turn for a persona run. Throws when
 * the lens is blank or `persona_card` is missing from the library.
 */
export function buildPersonaCardPrompt(lib: TemplateLibrary, input: PersonaCardInput): PersonaPrompt {
  const lens = input.lens.trim();
  if (lens === "") throw new Error("persona lens must be a non-empty string");
  const tpl = lib.get("persona_card");
  if (!tpl) throw new Error("missing prompt template persona_card");
  const cardInstruction =
    input.cardInstruction !== undefined && input.cardInstruction.trim() !== ""
      ? input.cardInstruction
      : DEFAULT_CARD_INSTRUCTION;
  const system = `${renderSystemPrompt(lib, input.access)}\n\n# Persona lens\n\n${lens}`;
  const turn = renderTemplate(tpl, { card: input.card, card_instruction: cardInstruction });
  return { system, turn, cardInstruction };
}

/** `buildPersonaCardPrompt` over a full persona definition. */
export function buildPersonaCardPromptFor(
  lib: TemplateLibrary,
  access: AccessMode,
  persona: Pick<Persona, "lens" | "cardInstruction">,
  card: string,
): PersonaPrompt {
  return buildPersonaCardPrompt(lib, {
    access,
    lens: persona.lens,
    card,
    cardInstruction: persona.cardInstruction,
  });
}

/**
 * Whole-file prompt forks (issue #393).
 *
 * A persona with id `<id>` owns `prompts/personas/<id>/` when it exists.
 * Any template there replaces the shared template of the same name,
 * whole file, for every task that persona's guide runs; templates it
 * does not contain fall back to `prompts/`. No section merging. Files
 * that match no shared template (e.g. Clarity's `lens.md`, `evals.jsonl`)
 * are never templates — the overlay only replaces names the shared
 * library already holds.
 */

/** Manifest file inside a fork folder (never a template: not `.md`). */
export const PERSONA_FORK_MANIFEST = "fork.json";

/** Fork folder for a persona id (exists or not — callers check). */
export function personaForkDir(promptsDir: string, personaId: string): string {
  return path.join(promptsDir, "personas", personaId);
}

/** Persona ids holding a fork folder (directory entries only). Sorted. */
export function forkPersonaIds(promptsDir: string): string[] {
  let entries: { name: string; isDirectory(): boolean }[];
  try {
    entries = fs.readdirSync(path.join(promptsDir, "personas"), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/**
 * True when the persona is guide-capable: its fork folder holds
 * `reader.md`, so it can write a whole guide (on its own provider/model,
 * or following main) with its lens as the writing style. Pure except for
 * the existence check.
 */
export function isGuideCapable(promptsDir: string, personaId: string): boolean {
  return fs.existsSync(path.join(personaForkDir(promptsDir, personaId), "reader.md"));
}

/** Names in a fork folder that overlap the shared library (the forked files). Sorted. */
export function forkedTemplateNames(lib: TemplateLibrary, promptsDir: string, personaId: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(personaForkDir(promptsDir, personaId));
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.endsWith(".md") && lib.has(e.slice(0, -".md".length)))
    .map((e) => e.slice(0, -".md".length))
    .sort();
}

/** sha256 of bytes (the fork manifest records base files by it). */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Template library for one persona: the shared templates with any
 * same-named fork file replacing its entry whole. `undefined` (the
 * built-in Guide, which keeps the shared prompts) loads the shared
 * library untouched.
 */
export function loadPersonaLibrarySync(promptsDir: string, personaId?: string): TemplateLibrary {
  const lib = loadTemplatesDirSync(promptsDir);
  if (personaId === undefined || personaId === GUIDE_PERSONA_ID) return lib;
  const dir = personaForkDir(promptsDir, personaId);
  if (!fs.existsSync(dir)) return lib;
  const issues: { template: string; message: string }[] = [];
  for (const name of forkedTemplateNames(lib, promptsDir, personaId)) {
    const raw = fs.readFileSync(path.join(dir, `${name}.md`), "utf8");
    let parsed: ReturnType<typeof parseTemplate>;
    try {
      parsed = parseTemplate(name, raw);
    } catch (err) {
      if (err instanceof TemplateLoadError) {
        for (const issue of err.issues) {
          issues.push({ template: name, message: `persona "${personaId}" fork of ${name}.md: ${issue.message}` });
        }
      } else throw err;
      continue;
    }
    // A forked template must declare every variable its base declares
    // (e.g. slower.md's `{{terms}}`/`{{guide}}`, issue #388) — and no
    // others, which the pipeline never supplies. A fresh fork passes by
    // construction (the helper copies the base whole); anything else
    // fails here, naming the persona and file, never silently at
    // render time.
    const baseVars = lib.get(name)?.variables ?? [];
    const missing = baseVars.filter((v) => !parsed.variables.includes(v));
    const extra = parsed.variables.filter((v) => !baseVars.includes(v));
    if (missing.length > 0 || extra.length > 0) {
      const parts: string[] = [];
      if (missing.length > 0) parts.push(`missing base variables: ${missing.join(", ")}`);
      if (extra.length > 0) parts.push(`undeclared variables the pipeline never supplies: ${extra.join(", ")}`);
      issues.push({ template: name, message: `persona "${personaId}" fork of ${name}.md ${parts.join("; ")}` });
      continue;
    }
    lib.set(name, parsed);
  }
  if (issues.length > 0) throw new TemplateLoadError(issues);
  return lib;
}

/** The review's Guide persona id (stored on the review, issue #393). */
export function reviewGuidePersonaId(snapshot: Pick<ReviewSnapshot, "review">): string {
  return snapshot.review.guidePersonaId;
}

/**
 * The review's Guide persona definition from settings. Throws when the
 * list holds no such persona (a deleted persona breaks its reviews
 * loudly instead of silently writing with another voice); a disabled
 * one still resolves (the review already exists).
 */
export function guidePersonaForReview(personas: Persona[], guidePersonaId: string): Persona {
  const found = personas.find((p) => p.id === guidePersonaId);
  if (!found) throw new Error(`unknown guide persona "${guidePersonaId}" (its reviews need that persona in Settings)`);
  return found;
}

/** Manifest shape: per forked file, the base file's hash when recorded. */
export interface PersonaForkManifest {
  personaId: string;
  files: Record<string, string>;
}

function manifestPath(promptsDir: string, personaId: string): string {
  return path.join(personaForkDir(promptsDir, personaId), PERSONA_FORK_MANIFEST);
}

/** Read a fork manifest; null when the folder holds none. Throws on invalid JSON. */
export function readForkManifest(promptsDir: string, personaId: string): PersonaForkManifest | null {
  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath(promptsDir, personaId), "utf8");
  } catch {
    return null;
  }
  const parsed = JSON.parse(raw) as Partial<PersonaForkManifest>;
  if (typeof parsed !== "object" || parsed === null || typeof parsed.personaId !== "string" || typeof parsed.files !== "object") {
    throw new Error(`invalid fork manifest for persona "${personaId}"`);
  }
  return { personaId: parsed.personaId, files: parsed.files as Record<string, string> };
}

/**
 * Forked files whose base template changed since the manifest recorded
 * it (issue #393 drift warning): file names (`reader.md`), sorted. A
 * forked file with no manifest entry (the helper never ran for it)
 * counts as drifted too. Empty means in sync (or no fork at all).
 * Files with no base counterpart are not forked files and never drift.
 */
export function forkDrift(promptsDir: string, personaId: string, shared?: TemplateLibrary): string[] {
  const lib = shared ?? loadTemplatesDirSync(promptsDir);
  const forked = forkedTemplateNames(lib, promptsDir, personaId);
  if (forked.length === 0) return [];
  const manifest = readForkManifest(promptsDir, personaId);
  const out: string[] = [];
  for (const name of forked) {
    const baseRaw = fs.readFileSync(path.join(promptsDir, `${name}.md`), "utf8");
    const recorded = manifest?.files[name];
    if (typeof recorded !== "string" || recorded !== sha256Hex(baseRaw)) out.push(`${name}.md`);
  }
  return out;
}

/**
 * Helper behind `mise run persona:fork` (issue #393): copy base
 * templates into a persona's fork and write the manifest. Named files
 * are copied only when the fork lacks them (never overwritten, so a
 * manual merge survives); the manifest always records the CURRENT base
 * hashes of every forked file — so re-running it after a manual merge
 * clears the drift warning for the merged files. Throws when a named
 * file is not a base template.
 */
export function copyPersonaFork(
  promptsDir: string,
  personaId: string,
  names: string[],
): { copied: string[]; skipped: string[] } {
  const lib = loadTemplatesDirSync(promptsDir);
  for (const name of names) {
    if (!lib.has(name)) throw new Error(`not a base template: ${name}`);
  }
  const dir = personaForkDir(promptsDir, personaId);
  fs.mkdirSync(dir, { recursive: true });
  const copied: string[] = [];
  const skipped: string[] = [];
  for (const name of names) {
    const dest = path.join(dir, `${name}.md`);
    if (fs.existsSync(dest)) {
      skipped.push(name);
      continue;
    }
    fs.copyFileSync(path.join(promptsDir, `${name}.md`), dest);
    copied.push(name);
  }
  const files: Record<string, string> = {};
  for (const name of forkedTemplateNames(lib, promptsDir, personaId)) {
    files[name] = sha256Hex(fs.readFileSync(path.join(promptsDir, `${name}.md`), "utf8"));
  }
  const manifest: PersonaForkManifest = { personaId, files };
  fs.writeFileSync(manifestPath(promptsDir, personaId), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { copied, skipped };
}

/**
 * Main writing turns that carry a fork Guide's lens (issue #393): the
 * #379 set (reader, go-deeper, slower, Ask) plus the other main-agent
 * tasks the issue lists (examples, diagrams, concept pages, update
 * pass, critic, hunk pass — depth.md is slower.md since #387).
 * Consolidation and plotline assignment stay lens-free (small-model
 * background work the issue does not list).
 */
export const GUIDE_FORK_STYLE_TEMPLATES: ReadonlySet<string> = new Set([
  "reader",
  "go_deeper",
  "slower",
  "ask",
  "ask_turn",
  "examples",
  "diagram",
  "concept_page",
  "update_pass",
  "critic",
  "hunk_pass",
]);

/**
 * Prefix a Guide lens for one turn of a review (issue #393): the
 * review's Guide persona supplies the lens (empty = unchanged). The
 * built-in Guide keeps the #379 placement exactly
 * (`withGuideStyleForTurn`); a fork Guide additionally styles the rest
 * of its listed main tasks. Persona turns never pass through here.
 */
export function withGuideStyleForReview(
  template: string,
  prompt: string,
  lens: string,
  forkGuide: boolean,
): string {
  if (lens.trim() === "") return prompt;
  if (!forkGuide) return withGuideStyleForTurn(template, prompt, lens);
  if (!GUIDE_FORK_STYLE_TEMPLATES.has(template)) return prompt;
  return withGuideWritingStyle(prompt, lens);
}
