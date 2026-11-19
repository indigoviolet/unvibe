/**
 * Card rendering (M4 interaction; PRD §4.4 display side + §8 stale state).
 *
 * Collapse chevron first (title row when collapsed); control row (Help me
 * understand, Use examples, Add diagram, Undo) wired to
 * `POST /api/reviews/:id/actions`; stale cards
 * show the cited-hunks count with an Update button; "Go deeper"
 * placeholder cards with Generate showing a plain working state. Every
 * agent-starting control sets an in-flight entry on click (dots on the
 * clicked control, conflicting controls disabled, rewrite border or
 * placeholder); the entry hands over to the snapshot job once it appears.
 * Expansions render under their block via `ExpansionCard` (open ones in
 * place; closed ones as dotted-link highlights with a footnote chip on the
 * citations line when the quote is gone); promoted links render as page-link
 * footnote chips. Corrections show as suggestions on the target card with
 * Accept/Dismiss.
 */
import type { CardVariant, Thread, Card, Page, Persona, Reply } from "@unvibe/shared";
import { cardToMarkdown, displayCardTitle } from "@unvibe/shared";
import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GuideBlockThreads } from "../comments/GuideThreads.js";
import { Icon } from "../components/Icon.js";
import { toast } from "../floating/Toast.js";
import { api, friendlyError } from "../api/client.js";
import { useReview } from "../state/store.js";
import { performAction, performExplainRewrite, performFollowUp, performInsertAction, personaVariantKey } from "./actions.js";
import { clearExplainHighlights, unhighlightExplainTerm } from "./explainTerms.js";
import { useEnabledPersonas } from "../settings/usePersonas.js";
import { blockThreads } from "./annotations.js";
import { BlockView } from "./BlockView.js";
import { linkCardBlocks } from "./glossary.js";
import { ThreadMarginOverlay } from "../comments/ThreadMarginOverlay.js";
import { SinceAnswers } from "./SinceAnswers.js";
import { copyContextFor, copyMarkdownText, useGithubRepo } from "./copyAsMarkdown.js";
import { CorrectionSuggestion } from "./expansions/CorrectionSuggestion.js";
import { expansionsForBlock } from "./expansions/ExpansionHighlights.js";
import { isExpansionFootnote } from "./expansions/expansionUtils.js";
import { busyForCard, inflightLabel } from "./inflight.js";
import { Button, Card as UiCard, CardHeader } from "../ui/index.js";

interface Props {
  reviewId: string;
  card: Card;
  lookupPage: (pageId: string) => Page | undefined;
  onOpenPage: (pageId: string) => void;
  onFollowUp: (cardId: string, blockId: string, index: number) => void;
}

function ControlButton({
  icon,
  label,
  onClick,
  disabled,
  pressed,
  busy,
  copyId,
}: {
  icon: "down" | "right" | "slower" | "bulb" | "diagram" | "undo" | "copy";
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  /** This control's action is running: dots in place of the icon. */
  busy?: boolean;
  /** Renders `data-copy-card` for the copy control (journey + tour hooks). */
  copyId?: string;
}) {
  return (
    <button
      className="ib"
      type="button"
      data-tip={busy ? "Working…" : label}
      aria-label={busy ? "Working…" : label}
      aria-pressed={pressed}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={onClick}
      data-copy-card={copyId}
    >
      {busy ? (
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : (
        <Icon name={icon} />
      )}
    </button>
  );
}

/**
 * Card versions for the tab strip (issue #349 step 2): the Guide version
 * plus one entry per persona variant — including orphans whose persona
 * was deleted since (fallback name and neutral colour, never dropped).
 */
export interface CardVersion {
  id: string;
  name: string;
  color: string;
  variant: CardVariant | null;
}

export function cardVersions(card: Card, personas: Persona[]): CardVersion[] {
  const byId = new Map(personas.map((p) => [p.id, p]));
  const out: CardVersion[] = [{ id: "guide", name: "Guide", color: "", variant: null }];
  for (const [personaId, variant] of Object.entries(card.variants ?? {})) {
    const persona = byId.get(personaId);
    out.push({
      id: personaId,
      name: persona?.name ?? "Persona",
      color: persona?.color ?? "#999999",
      variant,
    });
  }
  return out;
}

/**
 * Persona picker for a card toolbar (issue #349 step 2). One button with
 * the second-opinion bubbles icon; the menu lists the enabled personas
 * (colour dot + name — colour is never the only signal). Choosing one
 * runs it on the card. Rendered in a portal from the button rect so the
 * scrolling guide never clips it.
 */
function PersonaButton({
  reviewId,
  cardId,
  personas,
  disabled,
  busy,
  onBeforeRun,
}: {
  reviewId: string;
  cardId: string;
  personas: Persona[];
  disabled?: boolean;
  busy?: boolean;
  onBeforeRun?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Node;
      // The menu lives in a portal (outside the button), so option
      // clicks must not count as outside — else the menu unmounts
      // before the option's click fires.
      if (!btnRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (personas.length === 0) return null;
  return (
    <>
      <button
        className="ib"
        type="button"
        ref={btnRef}
        data-persona-menu={cardId}
        data-tip={busy ? "Working…" : "Run a persona on this card"}
        aria-label={busy ? "Working…" : "Run a persona on this card"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy || undefined}
        disabled={disabled || busy}
        onClick={() => {
          const rect = btnRef.current?.getBoundingClientRect();
          if (rect) {
            const width = 240;
            setPos({
              top: Math.min(rect.bottom + 4, window.innerHeight - 8),
              left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
            });
          }
          setOpen((v) => !v);
        }}
      >
        {busy ? (
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <Icon name="second" />
        )}
      </button>
      {open
        ? createPortal(
            <div
              className="fmenu"
              role="menu"
              ref={menuRef}
              style={{ position: "fixed", top: pos.top, left: pos.left, width: 240 }}
              data-persona-menu-list={cardId}
            >
              {personas.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="menuitem"
                  data-persona-option={p.id}
                  onClick={() => {
                    setOpen(false);
                    onBeforeRun?.();
                    runCardAction(reviewId, { kind: "persona", cardId, personaId: p.id });
                  }}
                >
                  <span
                    className="score-dot"
                    aria-hidden="true"
                    style={{ background: p.color }}
                  />
                  <span className="lbl">{p.name}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * Whether the Explain-terms menu (#418) is on (issue #422): the
 * experimental flag, read when the button mounts. No subscription — a
 * remount (any navigation) picks up a flipped toggle without a reload.
 */
function useExplainTermsEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api
      .settings()
      .then((s) => {
        if (!cancelled) setOn(s.experimental?.explainTerms === true);
      })
      .catch(() => {
        if (!cancelled) setOn(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return on;
}

/**
 * Help-me-understand menu (issue #418). The same icon-only button as
 * today's press (no caret); it opens a menu exactly the way
 * PersonaButton does (same `.fmenu` portal menu). Two items:
 * Simplify runs today's press unchanged; Explain terms… puts this card
 * alone into term picking.
 *
 * Issue #422: with the Explain-terms gate off the button is a plain
 * Simplify press again (same icon, same tooltip, one click runs
 * Simplify, no menu) and term picking is unreachable.
 */
function UnderstandButton({
  reviewId,
  cardId,
  personaId,
  disabled,
  busy,
}: {
  reviewId: string;
  cardId: string;
  personaId?: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  const explainTerms = useExplainTermsEnabled();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Node;
      if (!btnRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  // Issue #422: gate off — the plain Simplify press (same icon, same
  // tooltip, one click runs Simplify, no menu, no term picking).
  if (!explainTerms) {
    return (
      <button
        className="ib"
        type="button"
        data-understand-menu={cardId}
        data-tip={busy ? "Working…" : "Help me understand"}
        aria-label={busy ? "Working…" : "Help me understand"}
        aria-busy={busy || undefined}
        disabled={disabled || busy}
        onClick={() => {
          runCardAction(
            reviewId,
            personaId ? { kind: "slower", cardId, personaId } : { kind: "slower", cardId },
          );
        }}
      >
        {busy ? (
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <Icon name="slower" />
        )}
      </button>
    );
  }
  return (
    <>
      <button
        className="ib"
        type="button"
        ref={btnRef}
        data-understand-menu={cardId}
        data-tip={busy ? "Working…" : "Help me understand"}
        aria-label={busy ? "Working…" : "Help me understand"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy || undefined}
        disabled={disabled || busy}
        onClick={() => {
          const rect = btnRef.current?.getBoundingClientRect();
          if (rect) {
            const width = 240;
            setPos({
              top: Math.min(rect.bottom + 4, window.innerHeight - 8),
              left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
            });
          }
          setOpen((v) => !v);
        }}
      >
        {busy ? (
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <Icon name="slower" />
        )}
      </button>
      {open
        ? createPortal(
            <div
              className="fmenu"
              role="menu"
              ref={menuRef}
              style={{ position: "fixed", top: pos.top, left: pos.left, width: 240 }}
              data-understand-menu-list={cardId}
            >
              <button
                type="button"
                role="menuitem"
                data-understand-simplify={cardId}
                onClick={() => {
                  setOpen(false);
                  runCardAction(
                    reviewId,
                    personaId ? { kind: "slower", cardId, personaId } : { kind: "slower", cardId },
                  );
                }}
              >
                <span className="lbl">Simplify</span>
              </button>
              <button
                type="button"
                role="menuitem"
                data-understand-explain={cardId}
                onClick={() => {
                  setOpen(false);
                  clearExplainHighlights();
                  useReview.getState().setExplainPickCard(cardId);
                }}
              >
                <span className="lbl">Explain terms…</span>
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * In-card Explain-terms tray (issue #418): the picked terms as the
 * app's existing remove chips (`.fchip` with ×, as the plotline filter
 * chip), plus Rewrite (primary ui Button) and Cancel (quiet ui
 * Button). No label: the controls say what they do. Escape cancels
 * too; Rewrite and Cancel clear the highlights before anything else.
 */
function ExplainTermsTray({
  reviewId,
  cardId,
  personaId,
  disabled,
}: {
  reviewId: string;
  cardId: string;
  personaId?: string;
  disabled?: boolean;
}) {
  const terms = useReview((s) => s.explainTerms);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        clearExplainHighlights();
        useReview.getState().setExplainPickCard(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="explain-tray" role="group" aria-label="Picked terms" data-testid="explain-tray">
      {terms.map((t) => (
        <span className="fchip" key={t.id} data-testid="explain-term">
          <span className="fchip-name">{t.text}</span>
          <button
            type="button"
            data-testid="explain-term-remove"
            aria-label={`Remove "${t.text}"`}
            onClick={() => {
              unhighlightExplainTerm(t.id);
              useReview.getState().removeExplainTerm(t.id);
            }}
          >
            ×
          </button>
        </span>
      ))}
      <Button
        variant="primary"
        size="sm"
        type="button"
        data-testid="explain-rewrite"
        disabled={disabled || terms.length === 0}
        onClick={() => performExplainRewrite(reviewId, cardId, personaId)}
      >
        Rewrite
      </Button>
      <Button
        variant="quiet"
        size="sm"
        type="button"
        data-testid="explain-cancel"
        onClick={() => {
          clearExplainHighlights();
          useReview.getState().setExplainPickCard(null);
        }}
      >
        Cancel
      </Button>
    </div>
  );
}

/**
 * Version tab strip (issue #349 step 2): Guide plus one tab per persona
 * that ran on the card. Shown only when a variant exists. Each persona
 * tab carries its colour dot (with the name — colour is never the only
 * signal); the active persona tab underlines in its own colour.
 */
function VersionTabs({
  cardId,
  versions,
  active,
  onSelect,
}: {
  cardId: string;
  versions: CardVersion[];
  active: string;
  onSelect: (id: string) => void;
}) {
  if (versions.length <= 1) return null;
  return (
    <div className="tabs" role="tablist" aria-label="Card versions" data-testid={`versions-${cardId}`}>
      {versions.map((v) => (
        <button
          key={v.id}
          type="button"
          role="tab"
          className="tab"
          aria-selected={active === v.id}
          data-version-tab={v.id}
          onClick={() => onSelect(v.id)}
          style={v.id !== "guide" && active === v.id ? { borderColor: v.color, color: "inherit" } : undefined}
        >
          {v.id !== "guide" ? (
            <span className="score-dot" aria-hidden="true" style={{ background: v.color, display: "inline-block", marginRight: 6, verticalAlign: "baseline" }} />
          ) : null}
          {v.name}
        </button>
      ))}
    </div>
  );
}

/**
 * Plain processing indicator: dots plus a short fixed label. Never
 * streamed agent text, thinking text, or progress strings (issue #46).
 */
export function Working({ text }: { text: string }) {
  return (
    <div className="working" role="status">
      <span className="dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>{text}</span>
    </div>
  );
}

function runCardAction(reviewId: string, action: Parameters<typeof performAction>[1]): void {
  // performAction toasts + resyncs on failure; swallow here so callers stay
  // fire-and-forget without double toasts.
  void performAction(reviewId, action).catch(() => {});
}

/**
 * Fill state for a page card moved mid-fill (issue #152): the link
 * annotation that promoted this card keeps the unsettled turn as the
 * fill's state owner. Returns the link id (for Retry) and the turn while
 * it still carries a working flag or an error.
 */
function promotedFillFor(
  annotations: Thread[],
  card: Card,
): { linkId: string; turn: Reply } | null {
  for (const a of annotations) {
    if (a.type !== "link" || a.promotedToPage !== card.pageId) continue;
    const mapping = (a.promotedReplies ?? []).find((m) => m.cardId === card.id);
    if (!mapping) continue;
    const turn = (a.replies ?? []).find((t) => t.id === mapping.replyId);
    if (!turn) continue;
    if ((turn.working ?? "") !== "" && turn.working !== null) return { linkId: a.id, turn };
    if ((turn.error ?? "") !== "" && turn.error !== null) return { linkId: a.id, turn };
  }
  return null;
}



/**
 * Busy state for a persona's version of a card (issue #349 step 2): the
 * variant tab's own in-flight entry first (it follows the job until it
 * settles), then the variant's stored working line. The snapshot job
 * lookup stays out: jobs carry the guide card id, and a Guide-tab job
 * must never light the variant tab.
 */
function variantBusyState(
  inflight: ReturnType<typeof useReview.getState>["inflight"],
  cardId: string,
  personaId: string,
  variant: CardVariant | null,
): import("./inflight.js").BusyState | null {
  const entry = inflight[personaVariantKey(cardId, personaId)];
  if (entry) {
    return { kind: entry.kind, label: inflightLabel(entry.kind), rewriting: false };
  }
  if (variant?.working) {
    return { kind: "persona", label: variant.working, rewriting: false };
  }
  return null;
}

export function CardView({ reviewId, card, lookupPage, onOpenPage, onFollowUp }: Props) {
  const snapshot = useReview((s) => s.snapshot);
  const jobs = snapshot?.jobs ?? [];
  const annotations = snapshot?.annotations ?? [];
  const inflight = useReview((s) => s.inflight);
  // Issue #418: this card alone picks terms (tray below the toolbar).
  const explainPicking = useReview((s) => s.explainPickCardId) === card.id;
  const contributions = snapshot?.contributions ?? [];
  // Issue #349 step 2: the card's versions (Guide + persona variants)
  // and the active tab. The tab is UI state: a persona run never yanks
  // the reader off the Guide version.
  const personas = useEnabledPersonas();
  // Issue #377: the review's repo for permalink citations (null for
  // local reviews → plain path:lines). Fetched once per review.
  const githubRepo = useGithubRepo();
  const versions = cardVersions(card, personas);
  const [activeVersion, setActiveVersion] = useState("guide");
  const activeEntry = versions.find((v) => v.id === activeVersion) ?? versions[0];
  const activePersonaId = activeEntry.id === "guide" ? undefined : activeEntry.id;
  const activePersona = activePersonaId
    ? personas.find((p) => p.id === activePersonaId) ?? {
        id: activePersonaId,
        name: activeEntry.name,
        color: activeEntry.color,
        lens: "",
        cardInstruction: "",
        followMain: false,
        provider: "",
        model: "",
        enabled: false,
      }
    : undefined;
  const activeVariant = activeEntry.variant;
  // Jobs attached to a persona run's in-flight entry belong to the
  // variant tab — the Guide tab must not light up for them.
  const personaCoveredJobs = new Set(
    Object.entries(inflight)
      .filter(([key, entry]) => key.startsWith(`persona:${card.id}:`) && entry.jobId)
      .map(([, entry]) => entry.jobId as string),
  );
  const guideBusy = busyForCard(
    inflight,
    jobs.filter((j) => !personaCoveredJobs.has(j.id)),
    card.id,
  );
  const busy = activePersonaId ? variantBusyState(inflight, card.id, activePersonaId, activeVariant) : guideBusy;
  const busyKind = busy?.kind;
  // A card moved mid-fill (issue #152) resolves its working/error state
  // through the promoting link until its turn settles.
  const promoted = !busy && !activePersonaId ? promotedFillFor(annotations, card) : null;

  if (card.pending) {
    // Issue #84: the title and the one-line description stay visible while
    // generating — only the Generate button gives way to the indicator,
    // which sits where the prototype puts a pending card's working state
    // (`.ui-card.pend .working`, full width under the text). Issue #49: the
    // same display title as Contents (stored title, else the pending
    // label through the shared helper, never a new rule).
    const title = displayCardTitle(card.title || card.pending.label, card.blocks);
    return (
      <UiCard as="section" variant="plain" className="pend" id={`C-${card.id}`} aria-busy={busy ? true : undefined}>
        <div className="pl">{title}</div>
        <div className="why">{card.pending.why}</div>
        {busy ? (
          <Working text={busy.label} />
        ) : (
          <button
            className="go"
            type="button"
            data-gen={card.id}
            onClick={() => runCardAction(reviewId, { kind: "generate", cardId: card.id })}
          >
            Generate
          </button>
        )}
      </UiCard>
    );
  }

  // Issue #349 step 2: the active version's own blocks/undo stack. The
  // Guide version keeps today's path; a persona tab renders that
  // persona's blocks, and every control below addresses them.
  const shownBlocks = activeVariant ? activeVariant.blocks : card.blocks;
  const shownUndoDepth = activeVariant ? activeVariant.undoStack.length : card.undoStack.length;
  const threadsFor = (blockId: string): Thread[] =>
    blockThreads(annotations, card.id, blockId).filter(
      (t) => (t.personaId ?? null) === (activePersonaId ?? null),
    );

  // Issue #252: glossary terms link in card text (first mention per card).
  const glossary = snapshot?.glossary ?? [];
  const linkedBlocks = linkCardBlocks(shownBlocks, glossary);
  // Issue #380: every thread on the card gets a margin pill, and the
  // card always reserves the gutter it sits in (`.gutter`) — the first
  // thread must never move the text.
  const cardThreads = linkedBlocks.flatMap((b) => threadsFor(b.id));

  const blocks = linkedBlocks.map((block) => {
    const exps = expansionsForBlock(annotations, card.id, block.id);
    // Closed expansions + promoted links whose quote is gone become footnote
    // chips on the paragraph's citations line (via BlockView → BlockMarkers);
    // the highlight passes reveal them when the mark lands nowhere.
    // Issue #374: never comment threads (their fallback is the `.th`
    // chip + the margin pill).
    const footnotes = exps.filter(isExpansionFootnote);
    return (
      // Fragment (not a div): prototype.css child selectors depend on
      // blocks being direct children of the section.
      <Fragment key={block.id}>
        <BlockView
          block={block}
          threads={threadsFor(block.id)}
          footnotes={footnotes}
          lookupPage={lookupPage}
          cardId={card.id}
          onOpenPage={onOpenPage}
          onFollowUp={(blockId, index) =>
            activePersonaId
              ? performFollowUp(reviewId, card.id, blockId, index, activePersonaId)
              : onFollowUp(card.id, blockId, index)
          }
        />
        <GuideBlockThreads reviewId={reviewId} cardId={card.id} blockId={block.id} personaId={activePersonaId} />
      </Fragment>
    );
  });

  if (card.collapsed) {
    // Issue #49: the header always shows the title — the real one, else
    // the shared word-boundary fallback. No blank header row, no
    // body-prefix preview.
    const title = displayCardTitle(card.title, card.blocks);
    return (
      <UiCard as="section" variant="raised" className="collapsed gutter" id={`C-${card.id}`}>
        {/* Issue #364: the margin marker survives even a collapsed card
            (its threads anchor in the hidden body, so it sits at the top). */}
        <ThreadMarginOverlay
          threads={cardThreads}
          minTop={8}
          singleBucket
        />
        <div className="chead">
          <ControlButton
            icon="right"
            label="Expand"
            onClick={() =>
              runCardAction(reviewId, { kind: "collapse", cardId: card.id, collapsed: false })
            }
          />
          {title ? <h2 className="ct">{title}</h2> : null}
        </div>
        {/* #217: an auto-written go-deeper card keeps its why-line
            while collapsed, the way its placeholder looked. */}
        {card.why ? <div className="why">{card.why}</div> : null}
      </UiCard>
    );
  }

  // Issue #377: copy the card as shown (active persona variant's
  // blocks when a persona tab is selected) as portable Markdown.
  // Read-only like every other toolbar action: no job, no settings.
  const copyCard = (): void => {
    const snap = useReview.getState().snapshot;
    if (!snap) {
      toast("The review is still loading");
      return;
    }
    const { ctx, findPage } = copyContextFor(snap, githubRepo);
    copyMarkdownText(
      cardToMarkdown({ title: card.title, blocks: shownBlocks, answers: card.answers }, ctx, { findPage }),
    );
  };
  // Issue #418: any agent action on this card ends its picking first —
  // the highlights are direct DOM edits that a rewrite would leave stale.
  const stopPickingIfMine = (): void => {
    if (useReview.getState().explainPickCardId === card.id) {
      clearExplainHighlights();
      useReview.getState().setExplainPickCard(null);
    }
  };
  // While an agent action runs for this card, the conflicting controls go
  // disabled and the clicked one shows dots in place of its icon.
  const controlsBusy = busy !== null;
  const slowerBusy = busyKind === "slower";
  const examplesBusy = busyKind === "examples";
  const diagramBusy = busyKind === "diagram";
  const personaBusy = busyKind === "persona";
  // Issue #349 step 2: the active persona tab borders the card in that
  // persona's colour (an inset ring, so the rounded corners keep their
  // shape and nothing shifts).
  const personaRing = activePersona ? { boxShadow: `inset 0 0 0 2px ${activePersona.color}` } : undefined;
  // Issue #49: same display title as the collapsed header and Contents.
  const title = displayCardTitle(card.title, card.blocks);

  return (
    <UiCard
      as="section"
      variant="raised"
      className={["gutter", busy?.rewriting ? "rewriting" : ""].filter(Boolean).join(" ") || undefined}
      id={`C-${card.id}`}
      aria-busy={busy ? true : undefined}
      {...(personaRing ? { style: personaRing } : {})}
      // Issue #349 step 2: the active version marks the card for the
      // selection toolbar (Explain/Ask on this text run as the persona).
      // On the section itself, so block child selectors keep matching.
      {...(activePersonaId ? { "data-persona": activePersonaId, "data-card": card.id } : {})}
    >
      {/* Issue #364: one margin icon per thread on this card — on its
          highlight's first line, else its paragraph's first line. */}
      <ThreadMarginOverlay
        threads={cardThreads}
      />
      <CardHeader className="chead">
        <ControlButton
          icon="down"
          label="Collapse"
          onClick={() => {
            // Collapsing ends this card's picking (the tray lives in
            // the expanded body).
            if (explainPicking) {
              clearExplainHighlights();
              useReview.getState().setExplainPickCard(null);
            }
            runCardAction(reviewId, { kind: "collapse", cardId: card.id, collapsed: true });
          }}
        />
        {title ? <h2 className="ct">{title}</h2> : null}
        {/* #274: the toolbar lives in the heading row, hover/focus-revealed. */}
        <div className="ctl">
          <UnderstandButton
            reviewId={reviewId}
            cardId={card.id}
            personaId={activePersonaId}
            disabled={controlsBusy}
            busy={slowerBusy}
          />
          <ControlButton
            icon="bulb"
            label="Use examples"
            busy={examplesBusy}
            disabled={controlsBusy}
            onClick={() => {
              stopPickingIfMine();
              performInsertAction(reviewId, card.id, "examples", activePersonaId);
            }}
          />
          <ControlButton
            icon="diagram"
            label="Add diagram"
            busy={diagramBusy}
            disabled={controlsBusy}
            onClick={() => {
              stopPickingIfMine();
              performInsertAction(reviewId, card.id, "diagram", activePersonaId);
            }}
          />
          <ControlButton
            icon="undo"
            label="Undo"
            disabled={shownUndoDepth === 0 || controlsBusy}
            onClick={() => {
              stopPickingIfMine();
              runCardAction(
                reviewId,
                activePersonaId
                  ? { kind: "undo", cardId: card.id, personaId: activePersonaId }
                  : { kind: "undo", cardId: card.id },
              );
            }}
          />
          <ControlButton
            icon="copy"
            label="Copy as Markdown"
            copyId={card.id}
            onClick={copyCard}
          />
          <PersonaButton
            reviewId={reviewId}
            cardId={card.id}
            personas={personas}
            disabled={controlsBusy}
            busy={personaBusy}
            onBeforeRun={stopPickingIfMine}
          />
        </div>
      </CardHeader>
      <VersionTabs cardId={card.id} versions={versions} active={activeEntry.id} onSelect={setActiveVersion} />
      {explainPicking ? (
        <ExplainTermsTray
          reviewId={reviewId}
          cardId={card.id}
          personaId={activePersonaId}
          disabled={controlsBusy}
        />
      ) : null}
      {busy ? <Working text={busy.label} /> : null}
      {!busy && promoted?.turn.working ? <Working text={promoted.turn.working} /> : null}
      {!busy && promoted?.turn.error ? (
        <div className="perr" role="alert">
          <span>Couldn't get an answer. Retry, or see Debug for details.</span>
          <Button
            variant="primary"
            size="sm"
            type="button"
            data-retry={promoted.turn.id}
            onClick={() =>
              performAction(reviewId, { kind: "retry", annotationId: promoted.linkId }).catch((err: unknown) => {
                toast(`Couldn't retry: ${friendlyError(err)}`);
              })
            }
          >
            Retry
          </Button>
        </div>
      ) : null}
      {/* Issue #349 step 2: a failed persona run is a visible error on
          its own version (banner + Retry), never a silent store. */}
      {!busy && activeVariant?.error ? (
        <div className="perr" role="alert">
          <span>{activeVariant.error}</span>
          <Button
            variant="primary"
            size="sm"
            type="button"
            data-retry-persona={activePersonaId}
            onClick={() => {
              if (activePersonaId) {
                stopPickingIfMine();
                runCardAction(reviewId, { kind: "persona", cardId: card.id, personaId: activePersonaId });
              }
            }}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {blocks}
      {card.answers && card.answers.length > 0 ? <SinceAnswers answers={card.answers} /> : null}
      <CorrectionSuggestion reviewId={reviewId} card={card} contributions={contributions} />
    </UiCard>
  );
}
