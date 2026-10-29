/**
 * Pure helpers for `scripts/release-notes.mjs` (#311), dependency-free
 * so vitest can import them directly (same pattern as preview-lib.mjs).
 */

/** `DATA_FORMAT` value from `packages/shared/src/data-format.ts` source, or null. */
export function parseDataFormat(source) {
  const m = /export const DATA_FORMAT = (\d+)/.exec(String(source ?? ""));
  return m ? Number(m[1]) : null;
}

/**
 * The reset section for release notes, or null when the format did not
 * change. A previous tag with no `DATA_FORMAT` at all counts as format
 * 0 (unstamped data), so the first stamped release warns too.
 */
export function dataResetSection(prevFormat, nextFormat, version) {
  if (nextFormat === null || nextFormat === undefined) return null;
  const prev = prevFormat ?? 0;
  if (prev === nextFormat) return null;
  return [
    "## Data reset needed",
    "",
    `This release changes the stored data format (${prev} → ${nextFormat}), so it cannot read reviews stored by earlier versions. Nothing is converted and nothing is deleted: on first start the app asks for a reset, which moves your data aside to a dated copy next to the data directory.`,
    "",
    "Before updating, export any unposted drafts: open the app, open each review's Outbox and copy its Markdown somewhere safe. Drafts only live in the Outbox, and the fresh start will not show them.",
    "",
    "Update and reset from a terminal:",
    "",
    "```sh",
    "unvibe stop",
    `npm install -g github:indigoviolet/unvibe#release`,
    "unvibe reset-data",
    "unvibe start",
    "```",
    "",
    "Or update as usual and use the app's **Export Outbox first** and **Reset** buttons when it opens.",
    "",
    `The attached tarball installs the same build: \`npm install -g ./unvibe-${version}.tgz\`.`,
  ].join("\n");
}
