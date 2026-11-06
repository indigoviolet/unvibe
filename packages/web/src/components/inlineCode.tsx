/**
 * Inline `code` spans in model-written one-liners (issue #353): plotline
 * names and descriptions carry identifiers in backticks, and the raw
 * markdown must never render literally. Same rule as the hover
 * popover's `tick` helper (escape, then backticks to `<code>`), in two
 * shapes: React nodes for JSX spots (React escapes the text segments,
 * so no innerHTML is needed) and plain text for tooltips and chips.
 */
import { Fragment, type ReactNode } from "react";

const CODE_SPLIT = /(`[^`]+`)/g;

export function InlineCode({ text }: { text: string }): ReactNode {
  return (
    <>
      {text.split(CODE_SPLIT).map((part, i) =>
        part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
          <code key={i}>{part.slice(1, -1)}</code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** Plain-text form for tooltips and chips: drop the backticks, keep the identifier text. */
export function stripCodeSpans(text: string): string {
  return text.replace(/`([^`]+)`/g, "$1");
}
