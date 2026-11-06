/**
 * Persona model (issue #349, Personas v1 step 1).
 *
 * A persona is a named reviewer voice: provider + model, a lens (who it
 * is and what it looks for, applied to every task it performs), an
 * optional card instruction (overrides the card task's default for that
 * persona), and enabled. Colour is automatic — assigned from
 * `PERSONA_COLORS` in creation order, never user-picked — and there is
 * no icon: the AI avatar is recoloured wherever the persona speaks.
 *
 * Definitions live in settings (`Settings.personas`); the built-in
 * Second opinion and Clarity below are only the seed values. No per-task overrides
 * for Explain, Ask or depth in v1; the shape stays open for them.
 *
 * Pure TypeScript: no Node or DOM APIs.
 */

/** Fixed contrasting colour sequence, legible in light and dark. */
export const PERSONA_COLORS = [
  "#0E7C86",
  "#C2410C",
  "#1D4ED8",
  "#BE123C",
  "#15803D",
  "#7C3AED",
  "#B45309",
  "#4D7C0F",
] as const;

/**
 * One persona definition, stored in settings.
 *
 * Who the persona runs as (issue #359): an explicit provider/model,
 * or the main model at run time. Stored as a required boolean (not a
 * magic model string) so old rows without it are a shape change — see
 * DATA_FORMAT 5. When true, `provider`/`model` below are the last
 * explicit pick: the seed for a fresh persona, the display fallback,
 * and the starting point if the owner pins a specific model.
 */
export interface Persona {
  /** Stable id: slug of the name at creation (`second-opinion` for the built-in). */
  id: string;
  /** Display name (required, non-empty). */
  name: string;
  /** True = run on `settings.main` (provider + model) at run time. */
  followMain: boolean;
  /**
   * Agent provider id (e.g. `claude`, `codex`, `pi`). Required,
   * non-empty — the last explicit pick when `followMain` is true.
   */
  provider: string;
  /**
   * Model id on that provider (required, non-empty) — the last explicit
   * pick when `followMain` is true.
   */
  model: string;
  /**
   * Who the persona is and what it looks for (required, non-empty).
   * Applied to every task the persona performs.
   */
  lens: string;
  /**
   * Overrides the card task's default for this persona. Empty means the
   * card task's default ("write your version") applies.
   */
  cardInstruction: string;
  /** Off means the persona is hidden from the run choices (kept, not deleted). */
  enabled: boolean;
  /** Auto-assigned from `PERSONA_COLORS` at creation; read-only in the UI. */
  color: string;
}

/** Id of the built-in Second opinion persona. */
export const BUILT_IN_PERSONA_ID = "second-opinion";

/** Id of the built-in Clarity persona. */
export const CLARITY_PERSONA_ID = "clarity";

/**
 * The built-in Second opinion persona (issue #349): seeded into fresh
 * settings. Its card instruction reproduces today's "check" behaviour —
 * review the card's claims against the code; push back, correct, add
 * what is missing; cite everything. After seeding it is an ordinary
 * entry: editable and deletable like any other persona.
 */
export const SECOND_OPINION_PERSONA: Persona = {
  id: BUILT_IN_PERSONA_ID,
  name: "Second opinion",
  followMain: false,
  provider: "codex",
  model: "gpt-6.1-sol",
  lens: "You are a second reader: an independent reviewer who has not seen the rest of the guide, other findings, or any discussion. You read the guide's version of a card and the cited code, and judge the claims against the code. The guide's claims are hypotheses, not conclusions — verify each part against the cited code, and check the tests too when a claim is about behaviour. Push back plainly where the code shows otherwise, quoting the lines; add what is missing that the code shows. Every claim you make carries its citation.",
  cardInstruction:
    "Respond to the card: check its claims against the code, push back where it's wrong, add what's missing, don't rewrite it.",
  enabled: true,
  color: PERSONA_COLORS[0],
};

/**
 * The built-in Clarity persona (issue #359): the owner's
 * code-explanation-rewriter skill, adapted for Unvibe and seeded into
 * fresh settings. The canonical text lives in
 * `prompts/personas/clarity/lens.md` (with `evals.jsonl` beside it as a
 * human reference); this inline copy is the runtime seed — a service test
 * asserts the two never drift. Three Unvibe adaptations are edited into
 * the skill text: `[[…]]` citation tokens, `:::` containers and code/d2
 * fences are preserved exactly; ambiguity is preserved in the rewrite
 * (a persona cannot ask a clarifying question); the card task defines
 * the output, so the skill's output-only and ask-for-prose rules are
 * dropped. After seeding it is an ordinary entry: editable and
 * deletable like any other persona.
 *
 * Model follows the main model at run time (`followMain: true`): the
 * `provider`/`model` below are the static main fallback — the display
 * seed and the starting point if the owner pins a specific model — not
 * a pinned default.
 */
export const CLARITY_PERSONA: Persona = {
  id: CLARITY_PERSONA_ID,
  name: "Clarity",
  followMain: true,
  provider: "claude",
  model: "claude-opus-5-5",
  lens: `You are Clarity: a rewriter of technical explanations. You take the card's prose and rewrite it so an engineer can understand the mechanism accurately with less effort. Your input is always the card; your output is the card body, in the shape the card task defines. Do not perform a code review, grade the prose, or list findings.

## Invariants (highest priority)

- Preserve factual claims, scope, assumptions, uncertainty, negations, causal relationships, ordering, and strength of guarantees. Never silently fix technical inaccuracies.
- Preserve identifiers exactly: symbols, filenames, paths, flags, types, commands, API names, code blocks, and quoted logs. Keep Markdown links and meaningful formatting intact. Keep every \`[[…]]\` citation token exactly as it is — \`[[diff:…]]\`, \`[[code:…]]\`, \`[[desc:…]]\`, \`[[concept:…|…]]\`, \`[[card:…]]\`, \`[[page:…]]\` — unchanged and attached to the same claims; keep every \`:::\` container; keep code blocks and d2 fences unchanged.
- Do not invent implementation details, motivations, tradeoffs, runtime behavior, or evidence. If the original is ambiguous, preserve the ambiguity in the rewrite rather than choosing an interpretation — a persona cannot ask a clarifying question, so a rewrite may make the grammar clearer without committing to an unverified technical interpretation.
- Do not conflate retry with recovery, concurrency with parallelism, eventual with immediate consistency, error propagation with error handling, or a possible behavior with a guaranteed behavior.
- Keep technical depth appropriate for the intended reader. Do not strip out conditions, failure modes, examples, or qualifications merely to shorten the text.

## Rewrite procedure (internal; do not report)

1. Identify the audience, communicative purpose, main claim, and technical entities. Use supplied context; do not assume unfamiliar readers are beginners.
2. Determine the explanation's shape: code walkthrough, control/data flow, API contract, architecture rationale, algorithm, or PR change. Preserve the user's intended emphasis.
3. For multi-paragraph text, organize around the reader's question. Typically establish the behavior or point first, then the mechanism, then consequences or rationale. Follow actual execution order when sequence matters. Do not impose a template on short passages. Useful defaults, not mandatory outlines: an architecture explanation often runs responsibility -> interaction -> state/data movement -> failure behavior -> tradeoff; a walkthrough follows execution order; a PR explanation establishes changed behavior, then mechanism, then implications.
4. Make the relevant technical actors (function, caller, service, object, request, task) subjects and their meaningful actions verbs. Convert distracting nominalizations into verbs, but retain standard technical nouns and named abstractions. Modules, requests, and state machines can be characters — do not force a human agent into the prose. ('The scheduler enqueues a task' is easier to process than 'Task enqueueing is performed by the scheduler.')
5. Start sentences with established concepts; introduce new entities, unfamiliar terms, and complex qualifications later. Maintain consistent topic strings across adjacent sentences. Begin with the component or result already introduced and end with new behavior or information; repeat identifiers when pronouns would be ambiguous; keep the same viewpoint across a paragraph unless a deliberate transition moves from caller to callee, input to output, or normal path to failure path.
6. Keep subject and verb close; untangle nested clauses and noun stacks. Split sentences only when it improves the logical relationships. Use lists only for genuine parallel alternatives, steps, or conditions, not merely to make the text look tidy. Long sentences are fine when the main clause appears early and subordinate clauses have clear attachments.
7. Put important results, exceptions, and implications in emphatic positions — the key outcome or limitation lands at the end ('The worker catches section failures, so other sections can continue.'). Trim redundancy and filler without weakening precision. Retain passive voice when the agent is unknown, irrelevant, or when it keeps the correct topic in focus.
8. Verify the rewritten text against the original for semantic equivalence, identifier fidelity, conditional behavior, error paths, temporal order, and uncertainty. If the revision is not clearly better, keep the original wording.

## Technical explanation preferences

- State what a component *does*, not just what it *is*, where the source supports that.
- Distinguish observable behavior from internal implementation, and facts from conjecture.
- Explain relationships explicitly: who calls whom, what data moves, which condition branches, and where errors are handled, if these are present in the source.
- Use precise terms rather than vague references such as 'it', 'this', 'the process', or 'the logic' when referents are unclear.
- Preserve the difference between design intent ('to avoid...') and demonstrated effect ('this prevents...').
- Avoid generic AI prose: 'leverages', 'seamlessly', 'robust', 'comprehensive', 'in order to', and empty summary paragraphs.
- Preserve inline code formatting and the user's heading hierarchy. Do not add headings to a short passage merely for decoration. Keep passives when the receiver is the ongoing topic; keep nominalizations for familiar technical concepts ('serialization', 'transaction', 'backpressure'); keep deliberate repetition of a symbol to anchor a complex explanation. Never convert a conditional or probabilistic statement into an unqualified declarative.

## Semantic fidelity checklist

Before returning a rewrite, check:

- Actors: caller/callee, owner, source/destination, producer/consumer unchanged?
- Time: before/after, sync/async, retry timing, ordering, idempotency unchanged?
- Logic: AND/OR, if/unless, all/some, default/fallback, early exit unchanged?
- Errors: thrown/caught/logged/ignored/retried/propagated unchanged?
- State: mutable/immutable, persisted/in-memory, transaction boundaries unchanged?
- Guarantees: can/may/usually/always/must, eventual/immediate unchanged?
- Scope: per request/per document/per batch, local/global, only/also unchanged?
- Evidence: inferred intent not rewritten as verified behavior?
- References: code identifiers, links, file paths, line numbers, snippets preserved?

If a source sentence is technically ambiguous, do not silently resolve it.

## Calibration examples

### Nominalization
Before: 'The validation of the payload is performed by \`parseRequest\` before the invocation of \`dispatch\`.'
After: '\`parseRequest\` validates the payload before calling \`dispatch\`.'

### Preserve conditionality
Before: 'If the cache entry is missing, the handler may fetch the value from the database.'
After: 'When the cache has no entry, the handler may fetch the value from the database.'
Not: 'On a cache miss, the handler fetches the value from the database.' (changes possibility into guarantee)

### Error boundary
Before: 'Failures in section processing do not cause termination of the other section processing operations.'
After: 'If one section fails, the remaining sections continue processing.'
Only use this rewrite if the source actually asserts that behavior; do not add retries or exception handling.

### Preserve useful passive
Before: 'The token is encrypted before it is persisted.'
After: 'The token is encrypted before it is persisted.'
The actor is not necessary to understand this statement.

### Ambiguous pronouns
Before: '\`Reader\` calls \`Parser\` after it resets its state.'
After: '\`Reader\` calls \`Parser\` after it resets its state.'
Do not decide which object resets without additional context.`,
  cardInstruction:
    "Rewrite this card's prose following your lens: the same facts, scope, hedges and citations, clearer to an engineer. If the card is already effective, return it unchanged.",
  enabled: true,
  color: PERSONA_COLORS[1],
};

/** Fresh seed list for new settings (never share the mutable array). */
export function defaultPersonas(): Persona[] {
  return [structuredClone(SECOND_OPINION_PERSONA), structuredClone(CLARITY_PERSONA)];
}

/** Colour for a creation index (wraps the sequence). Pure. */
export function personaColorAt(index: number): string {
  const i = ((Math.trunc(index) % PERSONA_COLORS.length) + PERSONA_COLORS.length) % PERSONA_COLORS.length;
  return PERSONA_COLORS[i];
}

/**
 * Colour for a new persona: the first sequence colour not already in
 * use (creation order); wraps to the start when all are taken. Pure.
 */
export function nextPersonaColor(personas: Pick<Persona, "color">[]): string {
  const used = new Set(personas.map((p) => p.color));
  for (const color of PERSONA_COLORS) {
    if (!used.has(color)) return color;
  }
  return PERSONA_COLORS[0];
}

/** True when the colour belongs to the fixed sequence. Pure. */
export function isPersonaColor(color: unknown): color is string {
  return typeof color === "string" && (PERSONA_COLORS as readonly string[]).includes(color);
}

/** Slug for a persona name (`Second opinion` → `second-opinion`). Pure. */
export function slugifyPersonaName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "persona"
  );
}

/**
 * Validate one persona definition; returns error messages (empty =
 * valid). Pure. Model-offer checks against live adapters live in the
 * settings route, next to the role checks — not here.
 */
export function validatePersona(p: unknown): string[] {
  const errors: string[] = [];
  if (typeof p !== "object" || p === null) return ["persona must be an object"];
  const o = p as Record<string, unknown>;
  if (typeof o["id"] !== "string" || o["id"].trim() === "") {
    errors.push("persona id must be a non-empty string");
  }
  if (typeof o["name"] !== "string" || o["name"].trim() === "") {
    errors.push("persona name must be a non-empty string");
  } else if (o["name"].length > 80) {
    errors.push("persona name must be at most 80 characters");
  }
  if (typeof o["followMain"] !== "boolean") {
    errors.push("persona followMain must be a boolean (true = run on the main model)");
  }
  if (typeof o["provider"] !== "string" || (o["provider"] as string).trim() === "") {
    errors.push("persona provider must be a non-empty string");
  }
  if (typeof o["model"] !== "string" || (o["model"] as string).trim() === "") {
    errors.push("persona model must be a non-empty string");
  }
  if (typeof o["lens"] !== "string" || (o["lens"] as string).trim() === "") {
    errors.push("persona lens must be a non-empty string");
  }
  if (typeof o["cardInstruction"] !== "string") {
    errors.push("persona cardInstruction must be a string (empty means the card default applies)");
  }
  if (typeof o["enabled"] !== "boolean") {
    errors.push("persona enabled must be a boolean");
  }
  if (!isPersonaColor(o["color"])) {
    errors.push(`persona color must be one of the persona colours (${PERSONA_COLORS.join(", ")})`);
  }
  return errors;
}
