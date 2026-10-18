/**
 * Rendering other people's Markdown (issue #168): existing GitHub review
 * comments are shown in the diff and given to agents, but their bodies
 * must never reach the DOM — or a prompt — as raw HTML.
 *
 * Same sanitiser shape as the agent-reply renderer (`parse.ts`): raw HTML
 * stays escaped (`html: false`), images render as literal text (no `<img>`
 * into `dangerouslySetInnerHTML`), `linkify`/`typographer` stay off, and
 * links open in a new tab. Block-level (paragraphs, lists, fences), unlike
 * the inline-only reply renderer.
 */
import MarkdownIt from "markdown-it";

const untrustedMd = new MarkdownIt({ html: false, linkify: false, typographer: false });
untrustedMd.disable("image");
untrustedMd.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noopener noreferrer");
  return self.renderToken(tokens, idx, options);
};

/**
 * Render untrusted Markdown to safe HTML. Raw HTML is escaped, never
 * passed through; the output is shaped for `dangerouslySetInnerHTML`.
 */
export function renderUntrustedMarkdown(src: string): string {
  return untrustedMd.render(src);
}
