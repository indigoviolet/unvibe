/**
 * Second-opinion action control (PRD §4.10, §4.15).
 *
 * Icon with tooltip in the card control row, plus a small mode switch
 * showing the default for that kind of card (blind for findings, check
 * for cards). While the job runs the card shows the standard working
 * state (via streams + `jobForCard`). When no distinct second-opinion
 * model is configured, the action explains that and links to Settings.
 */
import { useEffect, useState } from "react";
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

export function SecondOpinionControl({ reviewId, card, page }: Props): React.JSX.Element {
  const def = defaultMode(page);
  const [mode, setMode] = useState<SecondOpinionMode>(def);
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    setMode(defaultMode(page));
  }, [page?.kind]);

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

  return (
    <span className="so-ctl" data-so-ctl={card.id}>
      <span className="seg so-switch" role="group" aria-label="Second-opinion mode">
        <button
          type="button"
          aria-pressed={mode === "blind"}
          data-tip="Blind: only the topic and cited code"
          aria-label="Blind mode"
          onClick={() => setMode("blind")}
        >
          Blind
        </button>
        <button
          type="button"
          aria-pressed={mode === "check"}
          data-tip="Check this claim: the claim plus cited code"
          aria-label="Check mode"
          onClick={() => setMode("check")}
        >
          Check
        </button>
      </span>
      <button
        className="ib"
        type="button"
        data-tip={`Second opinion (${mode === "blind" ? "blind" : "check this claim"}${mode === def ? ", default" : ""})`}
        aria-label={`Second opinion (${mode})`}
        onClick={() => void performAction(reviewId, { kind: "second_opinion", cardId: card.id, mode })}
      >
        <Icon name="spark" />
      </button>
    </span>
  );
}
