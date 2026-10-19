/**
 * UI theme application (issue #196): the <html> attribute, the
 * localStorage mirror the boot script reads, and reconciliation with
 * the persisted setting. Pure DOM logic; UI behaviour is covered by
 * the settings journey against the real service.
 */
import { afterEach, describe, expect, it } from "vitest";
import { applyUiTheme, currentUiTheme, syncUiThemeFromSettings, UI_THEME_STORAGE_KEY } from "./theme.js";

afterEach(() => {
  document.documentElement.removeAttribute("data-ui-theme");
  localStorage.removeItem(UI_THEME_STORAGE_KEY);
});

describe("ui theme", () => {
  it("applies the theme to <html> and mirrors it for the boot script", () => {
    applyUiTheme("studio");
    expect(document.documentElement.getAttribute("data-ui-theme")).toBe("studio");
    expect(localStorage.getItem(UI_THEME_STORAGE_KEY)).toBe("studio");
    expect(currentUiTheme()).toBe("studio");
  });

  it("falls back to the default theme for a missing or unknown attribute", () => {
    expect(currentUiTheme()).toBe("default");
    document.documentElement.setAttribute("data-ui-theme", "nope");
    expect(currentUiTheme()).toBe("default");
  });

  it("syncs from the persisted setting and rejects unknown values to the default", () => {
    expect(syncUiThemeFromSettings("studio")).toBe("studio");
    expect(currentUiTheme()).toBe("studio");
    expect(syncUiThemeFromSettings("nope")).toBe("default");
    expect(currentUiTheme()).toBe("default");
    expect(localStorage.getItem(UI_THEME_STORAGE_KEY)).toBe("default");
  });

  it("never touches the independent light/dark axis", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    applyUiTheme("studio");
    syncUiThemeFromSettings("default");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
