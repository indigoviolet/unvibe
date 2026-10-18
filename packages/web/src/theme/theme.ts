/**
 * UI theme application (issue #196). The persisted source of truth is
 * `Settings.uiTheme` (service SQLite, via PUT /api/settings); the
 * `localStorage` mirror below lets `public/theme-init.js` apply the
 * theme before first paint on the next load. Light/dark (`data-theme`)
 * is an independent axis and is never touched here.
 */
import { DEFAULT_UI_THEME, isUiThemeId, type UiThemeId } from "@unvibe/shared";

export const UI_THEME_STORAGE_KEY = "unvibe:ui-theme";

/** Apply a theme to <html> now and mirror it for the boot script. */
export function applyUiTheme(theme: UiThemeId): void {
  document.documentElement.setAttribute("data-ui-theme", theme);
  try {
    localStorage.setItem(UI_THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable: the attribute still applies for this page.
  }
}

/** Theme currently on <html> (set by the boot script or applyUiTheme). */
export function currentUiTheme(): UiThemeId {
  const attr = document.documentElement.getAttribute("data-ui-theme");
  return isUiThemeId(attr) ? attr : DEFAULT_UI_THEME;
}

/**
 * Reconcile with the server-side setting once it is known: a theme saved
 * elsewhere (or a cleared mirror) wins over whatever the boot script
 * picked. Returns the theme now in effect.
 */
export function syncUiThemeFromSettings(theme: unknown): UiThemeId {
  const next: UiThemeId = isUiThemeId(theme) ? theme : DEFAULT_UI_THEME;
  applyUiTheme(next);
  return next;
}
