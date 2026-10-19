/**
 * UI theme application (issue #196). The persisted source of truth is
 * `Settings.uiTheme` (service SQLite, via PUT /api/settings); the
 * `localStorage` mirror below lets `public/theme-init.js` apply the
 * theme before first paint on the next load. Light/dark (`data-theme`)
 * is an independent axis and is never touched here.
 */
import { DEFAULT_UI_THEME, isUiThemeId, type UiThemeId } from "@unvibe/shared";

export const UI_THEME_STORAGE_KEY = "unvibe:ui-theme";

/**
 * Per-theme font bundles (issue #196): dynamic imports, so a theme's
 * @fontsource CSS and woff2 files load only when that theme is
 * selected. The Default theme's fonts stay in the main bundle.
 */
const fontLoaders: Partial<Record<UiThemeId, () => Promise<unknown>>> = {
  studio: () => import("./fonts-studio.js"),
  console: () => import("./fonts-console.js"),
};
const fontsRequested = new Set<UiThemeId>();

export function ensureThemeFonts(theme: UiThemeId): void {
  const load = fontLoaders[theme];
  if (!load || fontsRequested.has(theme)) return;
  fontsRequested.add(theme);
  void load().catch(() => {
    // Fonts failing to load fall back to the stack's system families.
    fontsRequested.delete(theme);
  });
}

/** Apply a theme to <html> now and mirror it for the boot script. */
export function applyUiTheme(theme: UiThemeId): void {
  ensureThemeFonts(theme);
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
