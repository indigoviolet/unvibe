/**
 * `resolveSelectionHost` marks selections inside revealed context
 * (issue #133): the anchor stays a diff line, flagged revealed so the
 * toolbar offers Explain and Ask but not Note.
 */
import { describe, expect, it } from "vitest";
import { resolveSelectionHost } from "./SelectionToolbar.js";

function hostWithRow(revealed: boolean): HTMLElement {
  document.body.innerHTML =
    `<div id="right"><table class="diff"><tbody>` +
    `<tr${revealed ? ' data-revealed="1"' : ""} id="L-conn-70">` +
    `<td class="n">70</td><td class="n">70</td><td class="c">x = 1</td></tr>` +
    `</tbody></table></div>`;
  return document.querySelector("td.c") as HTMLElement;
}

describe("resolveSelectionHost revealed flag", () => {
  it("flags selections in revealed rows", () => {
    const host = resolveSelectionHost(hostWithRow(true));
    expect(host).toEqual({ anchor: { where: "diff-line", fileKey: "conn", line: 70 }, revealed: true });
  });

  it("leaves hunk rows unflagged", () => {
    const host = resolveSelectionHost(hostWithRow(false));
    expect(host).toEqual({ anchor: { where: "diff-line", fileKey: "conn", line: 70 }, revealed: false });
  });
});
