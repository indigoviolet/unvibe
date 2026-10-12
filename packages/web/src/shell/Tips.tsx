/**
 * Tips popover (top bar): the prototype's `TIPS` content, updated for what
 * the product does. Plain popover panel; closes on Escape or outside press.
 */
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon.js";

const TIPS: { title: string; body: string }[] = [
  {
    title: "Using the reader",
    body: "Select text to Explain it, Ask about it, or add a Note. An explanation is a card: use its controls for examples, diagrams and depth.",
  },
  {
    title: "Cards",
    body: "Each card: − / + changes depth; add examples or a diagram; Undo; mark read (collapses it).",
  },
  {
    title: "Markers",
    body: "Small markers at the end of a paragraph: <> shows the cited code, the speech bubble shows comments. Hover to preview, click to open.",
  },
  {
    title: "Findings",
    body: "Orange cards are the agent's own observations about the change. Open one to see the evidence.",
  },
  {
    title: "Diff",
    body: "Filter files; Hide uninteresting collapses generated, import-only and docs hunks to one line; Fold all summarizes and folds every hunk. Per hunk: fold, summarize, note, mark reviewed. Click a line number to comment.",
  },
  {
    title: "Comments",
    body: "The Comments menu (in the review bar, next to Submit review) lists every comment. “For PR” comments and description edits stay drafts until you click Submit review.",
  },
  {
    title: "New commits",
    body: "When the branch gets new commits, the Diff tab shows what changed and an Update button. Cards whose code changed offer the same button. Older versions stay readable from the Version menu above the guide.",
  },
  {
    title: "Settings",
    body: "Repos, models, environment checks, prompt templates, limits, the installed version and data reset.",
  },
  {
    title: "Debug",
    body: "For this review: the agent jobs with their token counts, the prompts as they were sent, and the notes the agent keeps between conversations.",
  },
];

export function TipsButton(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
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
  }, [open ]);

  return (
    <span ref={wrap} style={{ position: "relative", display: "inline-flex" }}>
      <button
        className="tbtn"
        type="button"
        aria-expanded={open}
        aria-label="Usage tips"
        title="Usage tips"
        onClick={() => setOpen(!open)}
      >
        <Icon name="bulb" /> Tips
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Usage tips"
          className="cmenu"
          style={{ position: "absolute", left: 0, top: "calc(100% + 4px)", width: 340 }}
        >
          {TIPS.map((t) => (
            <div key={t.title} style={{ padding: "4px 6px" }}>
              <b style={{ fontSize: 12.5 }}>{t.title}</b>
              <p className="hint" style={{ margin: "2px 0 6px" }}>
                {t.body}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </span>
  );
}
