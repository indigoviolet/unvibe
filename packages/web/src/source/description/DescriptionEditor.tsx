/**
 * In-place description editor (comments owner; PRD §4.11).
 *
 * Content-editable body preserving paragraph ids (so citations and
 * annotations still resolve). The live draft lives in `draftRef` — a ref,
 * not state — so it survives any re-render triggered elsewhere on the
 * page while editing. `cleanEditedHtml` strips contenteditable artifacts
 * on save (mirrors the service + prototype `cleanDesc`).
 */
import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";

/** Strip contenteditable artifacts (prototype `cleanDesc`). */
export function cleanEditedHtml(html: string): string {
  return html
    .replace(/ contenteditable="(true|false)"/g, "")
    .replace(/ id="descEdit"/g, "")
    .replace(/ spellcheck="(true|false)"/g, "")
    .replace('class="desc editing"', 'class="desc"')
    .replace(/<div class="author">[\s\S]*?<\/div>/, "");
}

interface Props {
  html: string;
  draftRef: MutableRefObject<string>;
}

export function DescriptionEditor({ html, draftRef }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const initial = useRef(html);
  draftRef.current = draftRef.current || html;

  useEffect(() => {
    const el = bodyRef.current;
    if (el && !el.innerHTML) el.innerHTML = initial.current;
    bodyRef.current?.focus();
  }, []);

  return (
    <div
      className="desc editing"
      id="descEdit"
      ref={bodyRef}
      contentEditable
      spellCheck
      suppressContentEditableWarning
      onInput={(e) => {
        draftRef.current = (e.target as HTMLElement).innerHTML;
      }}
    />
  );
}
