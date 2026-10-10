/**
 * Pending correction suggestion on its target card (PRD §9.5).
 *
 * Shows what would change, where it came from with a link to the source
 * thread, and its citations — with Accept (new card revision, then Undo
 * works) and Dismiss. Nothing is rewritten silently.
 */
import type { Card, Contribution } from "@unvibe/shared";
import { useState } from "react";
import { api, friendlyError } from "../../api/client.js";
import { toast } from "../../floating/Toast.js";
import { revealSource } from "../../source/reveal.js";

interface Props {
  reviewId: string;
  card: Card;
  contributions: Contribution[];
}

function targetMatches(target: string | undefined, cardId: string): string | null {
  if (!target || !target.startsWith("card:")) return null;
  const rest = target.slice("card:".length);
  const [cid, block] = rest.split("#");
  if (cid !== cardId) return null;
  return block ?? null;
}

export function CorrectionSuggestion({ reviewId, card, contributions }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const pending = contributions.filter((c) => c.status === "pending");
  const matches: { contribution: Contribution; itemIndex: number; block: string | null }[] = [];
  for (const c of pending) {
    c.items.forEach((item, i) => {
      if (item.kind !== "correction") return;
      const block = targetMatches(item.target, card.id);
      if (block !== null || item.target === `card:${card.id}`) {
        matches.push({ contribution: c, itemIndex: i, block });
      }
    });
  }
  if (matches.length === 0) return null;

  const act = (id: string, fn: () => Promise<unknown>, done: string): void => {
    setBusy(id);
    fn()
      .then(() => toast(done))
      .catch((err: unknown) => {
        toast(`Couldn't update the suggestion: ${friendlyError(err)}`);
      })
      .finally(() => setBusy(null));
  };

  return (
    <>
      {matches.map(({ contribution, itemIndex }) => {
        const item = contribution.items[itemIndex];
        const key = `${contribution.id}:${itemIndex}`;
        const threadId = contribution.sourceThread ?? contribution.sourceSession;
        return (
          <div className="suggest" key={key} data-correction={contribution.id}>
            <div className="stag">Suggested correction · pending</div>
            <p>{item.text}</p>
            {item.citations.length > 0 ? (
              <p className="hint">
                cites:{" "}
                {item.citations.map((c) => (
                  <button
                    key={c.target}
                    className="cite"
                    type="button"
                    onClick={() => revealSource(c.target)}
                  >
                    <span className="loc">{c.target}</span>
                  </button>
                ))}
              </p>
            ) : null}
            <div className="frow">
              {threadId ? (
                <span className="hint">
                  from{" "}
                  <button
                    className="x"
                    type="button"
                    onClick={() => {
                      document.getElementById(threadId)?.scrollIntoView({ block: "nearest" });
                    }}
                  >
                    thread {threadId}
                  </button>
                </span>
              ) : (
                <span className="hint">from {contribution.sourceSession}</span>
              )}
              <span className="sp" />
              <button
                className="btn ghost"
                type="button"
                disabled={busy === key}
                onClick={() =>
                  act(key, () => api.dismissContribution(reviewId, contribution.id), "Correction dismissed.")
                }
              >
                Dismiss
              </button>
              <button
                className="btn"
                type="button"
                disabled={busy === key}
                onClick={() =>
                  act(key, () => api.acceptContribution(reviewId, contribution.id), "Correction accepted — new card revision.")
                }
              >
                Accept
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}
