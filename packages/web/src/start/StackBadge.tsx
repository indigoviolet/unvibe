/** #321: stack badge (position/size in the stack colour) + popover listing the stack in review order. */
import { useEffect, useRef, useState } from "react";
import { STACK_PALETTE, type PrStackInfo } from "@unvibe/shared";

export function StackBadge({ info, currentNumber, onOpenPr }: {
  info: PrStackInfo;
  currentNumber: number;
  onOpenPr: (prNumber: number, title: string, branch: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const pair = STACK_PALETTE[info.colorIndex % STACK_PALETTE.length];
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open ]);
  const label = `${info.position}/${info.size}`;
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex" }} data-testid="stack-badge-wrap">
      <button
        type="button"
        data-testid="stack-badge"
        aria-label={`Stack position ${label}${info.source === "inferred" ? " (inferred stack)" : ""}`}
        title={info.source === "inferred" ? `Inferred stack ${label}` : `Stack ${label}`}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        style={{
          background: `light-dark(${pair.light.bg}, ${pair.dark.bg})`,
          color: `light-dark(${pair.light.fg}, ${pair.dark.fg})`,
          border: "1px solid currentColor", borderRadius: 999, fontSize: 11, lineHeight: "16px",
          padding: "0 6px", cursor: "pointer", fontVariantNumeric: "tabular-nums",
        }}
      >
        {label}{info.source === "inferred" ? " ~" : ""}
      </button>
      {open ? (
        <div
          role="dialog" aria-label="Pull request stack" data-testid="stack-popover"
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 60, minWidth: 260, maxWidth: 360,
            background: "var(--surface, #fff)", color: "var(--text, #111)", border: "1px solid var(--border, #ccc)",
            borderRadius: 8, padding: 6, boxShadow: "0 8px 24px rgba(0,0,0,0.18)", textAlign: "left",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontSize: 11, opacity: 0.7, padding: "2px 6px" }}>
            {info.source === "inferred" ? "Inferred stack" : "Stack"} · review bottom first
          </div>
          {[...info.members].reverse().map((m) => (
            <button
              key={m.number} type="button" data-testid={`stack-entry-${m.number}`}
              aria-current={m.number === currentNumber ? "true" : undefined}
              onClick={() => { setOpen(false); onOpenPr(m.number, m.title, m.headRefName); }}
              style={{
                display: "flex", gap: 6, width: "100%", textAlign: "left", padding: "5px 6px", borderRadius: 6,
                background: m.number === currentNumber ? "rgba(127,127,127,0.15)" : "transparent",
                border: 0, cursor: "pointer", color: "inherit", font: "inherit",
              }}
            >
              <span style={{ fontVariantNumeric: "tabular-nums" }}>#{m.number}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title}</span>
                <span style={{ display: "block", fontSize: 11, opacity: 0.7 }}>{m.headRefName}{m.number === currentNumber ? " · this PR" : ""}</span>
              </span>
            </button>
          ))}
          {info.siblings && info.siblings.length > 0 ? (
            <div style={{ fontSize: 11, opacity: 0.7, padding: "2px 6px" }}>Also branched here: {info.siblings.map((n) => `#${n}`).join(", ")}</div>
          ) : null}
          <div style={{ fontSize: 11, opacity: 0.7, padding: "4px 6px 2px", borderTop: "1px solid var(--border, #ddd)", marginTop: 4 }}>
            {info.baseRefName} (base)
          </div>
        </div>
      ) : null}
    </span>
  );
}
