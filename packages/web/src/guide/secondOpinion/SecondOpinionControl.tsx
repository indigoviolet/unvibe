/**
 * Second-opinion action control (PRD §4.10, §4.15).
 *
 * One icon button in the card control row (icons with tooltips): clicking
 * it runs the default mode for that kind of card (blind for findings,
 * check-this-claim for cards). A caret beside it opens a small menu to
 * run the other mode instead. While the job runs the card shows the
 * standard working state (via streams + `jobForCard`). When no distinct
 * second-opinion model is configured, the action explains that and links
 * to Settings.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Card, Page, SecondOpinionMode, Settings } from "@unvibe/shared";
import { Icon } from "../../components/Icon.js";
import { api } from "../../api/client.js";
import { performAction } from "../actions.js";

interface Props {
  reviewId: string;
  card: Card;
  page: Page | undefined;
}

function defaultMode(page: Page | undefined): SecondOpinionMode {
  return page?.kind === "finding" ? "blind" : "check";
}

function modeHint(mode: SecondOpinionMode): string {
  return mode === "blind" ? "Only the topic and the cited code" : "The claim plus the cited code";
}

export function SecondOpinionControl({ reviewId, card, page }: Props): React.JSX.Element {
  const def = defaultMode(page);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .settings()
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch(() => {
        // Settings unavailable: leave the action enabled; the service
        // refuses with a clear error pointing at Settings.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Close the mode menu on outside press or Escape (PRD §4.5 hover rules
  // apply to previews; menus close the same way).
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: PointerEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        caretRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const distinct =
    !settings ||
    settings.secondOpinion.provider !== settings.main.provider ||
    settings.secondOpinion.model !== settings.main.model;

  if (settings && !distinct) {
    return (
      <span className="so-ctl" data-so-ctl={card.id}>
        <button className="ib" type="button" data-tip="Second opinion needs a different model" aria-label="Second opinion needs a different model" disabled>
          <Icon name="spark" />
        </button>
        <span className="so-warn" role="status">
          Needs a different model — <Link to="/settings">Settings</Link>
        </span>
      </span>
    );
  }

  const run = (mode: SecondOpinionMode): void => {
    setMenuOpen(false);
    void performAction(reviewId, { kind: "second_opinion", cardId: card.id, mode });
  };

  const defLabel = def === "blind" ? "blind" : "check this claim";

  return (
    <span className="so-ctl" data-so-ctl={card.id}>
      <button
        className="ib"
        type="button"
        data-tip={`Second opinion (${defLabel})`}
        aria-label={`Second opinion (${defLabel})`}
        onClick={() => run(def)}
      >
        <Icon name="spark" />
      </button>
      <button
        ref={caretRef}
        className="ib"
        type="button"
        data-tip="Choose a second-opinion mode"
        aria-label="Choose a second-opinion mode"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        <Icon name="down" />
      </button>
      {menuOpen ? (
        <div ref={menuRef} className="so-menu" role="menu" aria-label="Second-opinion mode">
          {(["blind", "check"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="menuitemradio"
              aria-checked={mode === def}
              onClick={() => run(mode)}
            >
              <span>
                {mode === "blind" ? "Blind" : "Check this claim"}
                {mode === def ? " (default)" : ""}
              </span>
              <span className="hint">{modeHint(mode)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
