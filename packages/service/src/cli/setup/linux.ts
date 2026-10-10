/**
 * Linux `unvibe://` handler (PRD §14): a `.desktop` file in
 * `~/.local/share/applications` with `MimeType=x-scheme-handler/unvibe`,
 * registered through `xdg-mime`. Mirrors the macOS helper's behaviour:
 * `unvibe://start` (or a bare launch) starts the service.
 */

export const DESKTOP_FILENAME = "unvibe-open.desktop";
export const URL_MIME = "x-scheme-handler/unvibe";

export function desktopFilePath(homeDir: string): string {
  return `${homeDir}/.local/share/applications/${DESKTOP_FILENAME}`;
}

/** XDG Exec quoting: double quotes with `\` and `"` escaped. */
export function desktopQuote(s: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Full contents of the `.desktop` file. */
export function desktopFileContent(nodePath: string, cliPath: string): string {
  const exec = `${desktopQuote(nodePath)} ${desktopQuote(cliPath)} start %u`;
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.0",
    "Name=Unvibe",
    "Comment=Start the Unvibe local service (unvibe:// URL handler)",
    `Exec=${exec}`,
    "Terminal=false",
    "Categories=Development;",
    `MimeType=${URL_MIME};`,
    // A URL handler, not a launcher: hide it from menus.
    "NoDisplay=true",
    "StartupNotify=false",
    "",
  ].join("\n");
}
