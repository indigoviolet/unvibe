/**
 * Mock implementations of the card actions for `VITE_MOCK=1`
 * (M2, web-guide owner). Real mode posts to `POST /api/reviews/:id/actions`
 * via `src/guide/actions.ts`; the service drives jobs and state patches.
 *
 * - `read` / `collapse` / bookmark toggle locally (bookmark also persists
 *   to `localStorage`).
 * - `depth` switches to the depth text already in the fixture; `+` at the
 *   deepest level adds an "Underlying principle" aside (prototype behaviour).
 * - `examples` / `diagram` insert the canned KB example / Mermaid diagram
 *   matching the card's text (prototype `transform` behaviour); otherwise a
 *   toast, since generation itself is a later milestone.
 * - `undo` pops the card's undo stack (no redo; annotations survive).
 * - `generate` simulates job progress from the card's `statusSteps`, then
 *   fills the card from `genContent`.
 */
import type {
  ActionResponse,
  Block,
  Card,
  DepthLevel,
  Job,
  ReviewAction,
  ReviewSnapshot,
} from "@unvibe/shared";
import { toast } from "../floating/Toast.js";
import { useReview } from "../state/store.js";
import {
  foldMermaid,
  genContent,
  kbAnswers,
  kbExampleCookie,
  kbExampleFold,
  kbExampleHeaders,
  kbExampleInjection,
  kbExampleRegex,
  pathMermaid,
} from "./guide.js";

const wait = (ms: number): Promise<void> =>
  new Promise((r) => {
    window.setTimeout(r, ms);
  });

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mutateSnapshot(fn: (snap: ReviewSnapshot) => ReviewSnapshot): void {
  const { snapshot, setSnapshot } = useReview.getState();
  if (snapshot) setSnapshot(fn(snapshot));
}

function findCard(snap: ReviewSnapshot, cardId: string): Card | null {
  for (const page of snap.pages) {
    const card = page.cards.find((c) => c.id === cardId);
    if (card) return card;
  }
  return null;
}

function withCard(cardId: string, fn: (card: Card) => void): boolean {
  let found = false;
  mutateSnapshot((snap) => {
    const next: ReviewSnapshot = { ...snap, pages: snap.pages.map((p) => ({ ...p })) };
    for (const page of next.pages) {
      page.cards = page.cards.map((c) => {
        if (c.id !== cardId) return c;
        const copy: Card = { ...c, blocks: c.blocks.map((b) => ({ ...b })) };
        fn(copy);
        found = true;
        return copy;
      });
    }
    return next;
  });
  return found;
}

function pushUndo(card: Card): void {
  card.undoStack = [...card.undoStack, { blocks: clone(card.blocks), level: card.level }];
}

const stripTags = (s: string): string => s.replace(/<[^>]+>/g, " ");

function depthTextOf(block: Block, level: DepthLevel): string | null {
  if (block.type !== "paragraph") return null;
  const t = block.text;
  if (level === "simple") return t.simple ?? t.standard;
  if (level === "deep") return t.deep ?? t.standard;
  return t.standard;
}

function cardText(card: Card): string {
  return card.blocks
    .map((b) => {
      if (b.type === "paragraph") return stripTags(depthTextOf(b, card.level) ?? "");
      if (b.type === "list") return b.items.map((i) => stripTags(i.html)).join(" ");
      if (b.type === "html") return stripTags(b.html);
      return "";
    })
    .join(" ");
}

function principleFor(text: string): string {
  if (/regex|backtrack|linear|pattern/i.test(text))
    return `When a step processes untrusted input, make its cost depend only on the input's length. Patterns that can retry from many positions turn long, odd values into a slowdown an attacker controls.`;
  if (/HTTPHeaderDict|HTTPMessage|copies|views/i.test(text))
    return `When two representations of the same data exist, normalize the source and derive the others from it, so they agree by construction instead of by careful syncing.`;
  return `Convert wire encodings into one canonical value at the boundary where data enters, so nothing downstream has to know how the bytes were laid out, or can be tricked by it.`;
}

interface KbHit {
  example?: string;
  diagram?: { mermaid: string; caption: string };
}

function kbFor(text: string): KbHit | null {
  if (/obs-fold|fold|unfold|continuation|line folding/i.test(text))
    return {
      example: kbExampleFold,
      diagram: {
        mermaid: foldMermaid,
        caption: "An obs-fold on the wire, and the value urllib3 now hands to callers.",
      },
    };
  if (/HTTPHeaderDict|HTTPMessage|http\.client|email\.message|headers object/i.test(text))
    return { example: kbExampleHeaders };
  if (/inject|CRLF|response splitting|line break|smuggl|re-emit/i.test(text))
    return {
      example: kbExampleInjection,
      diagram: {
        mermaid: pathMermaid,
        caption:
          "Where a response's headers go after parsing, and the one place they are now unfolded.",
      },
    };
  if (/regex|backtrack|ReDoS|quadratic|lookbehind|linear/i.test(text))
    return { example: kbExampleRegex };
  if (/cookie|Set-Cookie|comma/i.test(text)) return { example: kbExampleCookie };
  return null;
}

function mockDepth(cardId: string, direction: "simpler" | "deeper"): ActionResponse {
  const order: DepthLevel[] = ["simple", "standard", "deep"];
  let msg: string | null = null;
  const ok = withCard(cardId, (card) => {
    const i = order.indexOf(card.level);
    const ni = i + (direction === "simpler" ? -1 : 1);
    if (ni >= 0 && ni < order.length) {
      const nl = order[ni];
      const changed = card.blocks.some(
        (b) => b.type === "paragraph" && depthTextOf(b, nl) !== depthTextOf(b, card.level),
      );
      if (changed) {
        pushUndo(card);
        card.level = nl;
        return;
      }
    }
    if (
      direction === "deeper" &&
      !card.blocks.some((b) => b.type === "aside" && b.kind === "Underlying principle")
    ) {
      pushUndo(card);
      const inner: Block = {
        type: "paragraph",
        id: `mock-principle-${card.id}`,
        text: { standard: principleFor(cardText(card)) },
        citations: [],
      };
      card.blocks = [
        ...card.blocks,
        {
          type: "aside",
          id: `mock-aside-principle-${card.id}`,
          kind: "Underlying principle",
          inner: [inner],
          citations: [],
        },
      ];
      return;
    }
    msg =
      direction === "simpler"
        ? "This is the simplest version of this card."
        : "Nothing more to add to this card in mock mode.";
  });
  if (msg) toast(msg);
  return { accepted: ok };
}

function mockInsert(cardId: string, kind: "examples" | "diagram"): ActionResponse {
  let msg: string | null = null;
  const ok = withCard(cardId, (card) => {
    const text = cardText(card);
    const hit = kbFor(text);
    const hasExample = (html: string): boolean =>
      card.blocks.some(
        (b) =>
          b.type === "aside" &&
          b.inner.some((x) => x.type === "html" && x.html === html),
      );
    const hasDiagram = (mermaid: string): boolean =>
      card.blocks.some(
        (b) =>
          (b.type === "diagram" && b.mermaid === mermaid) ||
          (b.type === "aside" &&
            b.inner.some((x) => x.type === "diagram" && x.mermaid === mermaid)),
      );
    const wantExample = kind === "examples" ? hit?.example : undefined;
    const wantDiagram = kind === "diagram" ? hit?.diagram : undefined;
    if ((wantExample && hasExample(wantExample)) || (wantDiagram && hasDiagram(wantDiagram.mermaid))) {
      msg = "Already added to this card.";
      return;
    }
    if (!wantExample && !wantDiagram) {
      msg = "Nothing canned to add to this card in mock mode.";
      return;
    }
    pushUndo(card);
    if (wantExample) {
      const inner: Block = { type: "html", id: `mock-ex-${card.id}`, html: wantExample, citations: [] };
      card.blocks = [
        ...card.blocks,
        {
          type: "aside",
          id: `mock-aside-ex-${card.id}`,
          kind: "Example",
          inner: [inner],
          citations: [],
        },
      ];
    }
    if (wantDiagram) {
      const inner: Block = {
        type: "diagram",
        id: `mock-diag-${card.id}`,
        mermaid: wantDiagram.mermaid,
        caption: wantDiagram.caption,
        citations: [],
      };
      card.blocks = [
        ...card.blocks,
        {
          type: "aside",
          id: `mock-aside-diag-${card.id}`,
          kind: "Diagram",
          inner: [inner],
          citations: [],
        },
      ];
    }
  });
  if (msg) toast(msg);
  return { accepted: ok };
}

async function mockGenerate(cardId: string): Promise<ActionResponse> {
  const snap = useReview.getState().snapshot;
  const card = snap ? findCard(snap, cardId) : null;
  if (!snap || !card || !card.pending) return { accepted: false };
  const { statusSteps = [], genKey } = card.pending;
  const blocks = genKey ? genContent[genKey] : undefined;
  if (!blocks) {
    toast("Nothing canned to generate in mock mode.");
    return { accepted: false };
  }
  const jobId = `mock-${cardId}`;
  const setJobs = (jobs: Job[]): void =>
    mutateSnapshot((s) => ({ ...s, jobs, rev: s.rev + 1 }));
  const base: Job = {
    id: jobId,
    kind: "go-deeper",
    model: "mock",
    priority: 1,
    state: "running",
    cardId,
  };
  setJobs([...snap.jobs.filter((j) => j.id !== jobId), base]);
  for (const step of statusSteps) {
    setJobs([{ ...base, progress: `${step}…` }]);
    await wait(250);
  }
  withCard(cardId, (c) => {
    c.pending = undefined;
    c.title = card.pending?.label ?? c.title;
    c.blocks = clone(blocks);
  });
  setJobs([{ ...base, state: "done", progress: undefined }]);
  return { accepted: true, jobId };
}

export function mockFollowUp(cardId: string, blockId: string, index: number): void {
  const snap = useReview.getState().snapshot;
  const card = snap ? findCard(snap, cardId) : null;
  const block = card?.blocks.find((b) => b.id === blockId);
  if (!card || block?.type !== "follow-up") return;
  const item = block.items[index];
  if (!item) return;
  const answer = item.ask ? kbAnswers[item.ask] : undefined;
  if (!answer) {
    toast("No canned answer in mock mode.");
    return;
  }
  withCard(cardId, (c) => {
    const i = c.blocks.findIndex((b) => b.id === blockId);
    if (i < 0) return;
    // Clicking a follow-up consumes it and adds its answer (prototype `follow`).
    const copy = { ...(c.blocks[i] as Extract<Block, { type: "follow-up" }>) };
    copy.items = copy.items.filter((_, j) => j !== index);
    const answerBlock: Block = {
      type: "paragraph",
      id: `mock-answer-${cardId}-${index}`,
      text: { standard: answer },
      citations: [],
    };
    c.blocks = [...c.blocks.slice(0, i), copy, answerBlock, ...c.blocks.slice(i + 1)];
  });
}

function savedKey(reviewId: string, pageId: string): string {
  return `unvibe:saved:${reviewId}:${pageId}`;
}

export function mockBookmark(reviewId: string, pageId: string, saved: boolean): void {
  try {
    localStorage.setItem(savedKey(reviewId, pageId), saved ? "1" : "0");
  } catch {
    // Storage may be unavailable; the snapshot update below still applies.
  }
  mutateSnapshot((snap) => ({
    ...snap,
    pages: snap.pages.map((p) => (p.id === pageId ? { ...p, saved } : p)),
  }));
}

export function applySavedState(reviewId: string): void {
  mutateSnapshot((snap) => ({
    ...snap,
    pages: snap.pages.map((p) => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(savedKey(reviewId, p.id));
      } catch {
        // Ignore storage failures.
      }
      return saved === null ? p : { ...p, saved: saved === "1" };
    }),
  }));
}

export async function mockAction(
  reviewId: string,
  action: ReviewAction,
): Promise<ActionResponse> {
  switch (action.kind) {
    case "read":
      withCard(action.cardId, (card) => {
        card.read = action.read;
        card.collapsed = action.read;
      });
      return { accepted: true };
    case "collapse":
      withCard(action.cardId, (card) => {
        card.collapsed = action.collapsed;
      });
      return { accepted: true };
    case "depth":
      return mockDepth(action.cardId, action.direction);
    case "examples":
      return mockInsert(action.cardId, "examples");
    case "diagram":
      return mockInsert(action.cardId, "diagram");
    case "undo": {
      let undone = false;
      withCard(action.cardId, (card) => {
        const prev = card.undoStack[card.undoStack.length - 1];
        if (!prev) {
          toast("Nothing to undo.");
          return;
        }
        card.undoStack = card.undoStack.slice(0, -1);
        card.blocks = clone(prev.blocks);
        card.level = prev.level;
        undone = true;
      });
      return { accepted: undone };
    }
    case "generate":
      return mockGenerate(action.cardId);
    case "bookmark":
      mockBookmark(reviewId, action.pageId, action.saved);
      return { accepted: true };
    default:
      toast("Not available in mock mode.");
      return { accepted: false };
  }
}
