/**
 * Rich text rendering (M2, web-guide owner): trusted HTML with delegated
 * interactions. Dotted page links (`a.cx[data-node]`) navigate in-app;
 * source buttons (`.src[data-src]`, e.g. inside canned answers) reveal.
 * Links to fully read pages render muted with the prototype's check mark.
 */
import { useMemo } from "react";
import { revealSource } from "../source/reveal.js";
import { useReview } from "../state/store.js";
import { isPageRead, markKnownLinks } from "./guideUtils.js";

interface Props {
  html: string;
  className?: string;
  /** Block id for the `data-top` selection/anchor hook (prototype). */
  top?: string;
  /** Open a guide page in-app. */
  onOpenPage: (pageId: string) => void;
}

export function RichText({ html, className, top, onOpenPage }: Props) {
  const pages = useReview((s) => s.snapshot?.pages);
  const processed = useMemo(() => {
    if (!pages) return html;
    const byId = new Map(pages.map((p) => [p.id, p]));
    return markKnownLinks(html, (id) => {
      const p = byId.get(id);
      return p ? isPageRead(p) : false;
    });
  }, [html, pages]);

  return (
    <span
      className={className}
      {...(top !== undefined ? { "data-top": top } : {})}
      dangerouslySetInnerHTML={{ __html: processed }}
      onClick={(e) => {
        const link = (e.target as HTMLElement).closest?.("a.cx[data-node]");
        if (link) {
          e.preventDefault();
          onOpenPage(link.getAttribute("data-node") ?? "");
          return;
        }
        const src = (e.target as HTMLElement).closest?.("[data-src]");
        if (src) {
          revealSource(src.getAttribute("data-src") ?? "");
        }
      }}
    />
  );
}
