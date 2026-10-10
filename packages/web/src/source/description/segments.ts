/**
 * Description segments (comments owner; PRD §4.11).
 *
 * Splits rendered description HTML into top-level blocks so threads sit
 * under their paragraph. Block boundaries + ids match the service's
 * `parseDescBlocks` (`p`/`ul`/`ol`/`pre` carry `id`, `h3` headings don't),
 * so paragraph identity — and therefore citations and annotations —
 * survives edits.
 */

export interface DescriptionSegment {
  /** Paragraph id (`d-p<n>`), or null for headings. */
  id: string | null;
  tag: "p" | "ul" | "ol" | "pre" | "h3";
  /** Full outer HTML of the block (ids preserved). */
  html: string;
}

/**
 * Split description HTML into segments in document order. Content outside
 * top-level blocks (the wrapping `<div class="desc">`, whitespace) is
 * ignored; blocks without an id still render, they just own no threads.
 */
export function splitDescriptionHtml(html: string): DescriptionSegment[] {
  const out: DescriptionSegment[] = [];
  const re = /<(p|ul|ol|pre|h3)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[1].toLowerCase() as DescriptionSegment["tag"];
    const attrs = m[2];
    const idMatch = attrs.match(/\bid=["']([^"']+)["']/i);
    out.push({ id: tag === "h3" ? null : (idMatch?.[1] ?? null), tag, html: m[0] });
  }
  return out;
}
