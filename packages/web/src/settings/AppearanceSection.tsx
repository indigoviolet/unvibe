/**
 * Appearance section (Settings -> Appearance, issue #196): the UI theme
 * picker. Themes are independent of light/dark: each theme supplies
 * both sets and light/dark keeps following the OS / `data-theme`.
 * Picking a theme applies it at once and saves it like every other
 * setting (PUT /api/settings); the boot script re-applies it before
 * first paint on the next load.
 */
import { useState } from "react";
import { UI_THEMES, type Settings, type UiThemeId } from "@unvibe/shared";
import { api } from "../api/client.js";
import { applyUiTheme, currentUiTheme } from "../theme/theme.js";
import { putErrors } from "./LimitsSection.js";
import { Card, Field, Select } from "../ui/index.js";

export function AppearanceSection({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: (next: Settings) => void;
}): React.JSX.Element {
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const selected: UiThemeId = settings.uiTheme ?? currentUiTheme();

  const pick = async (theme: UiThemeId): Promise<void> => {
    if (theme === selected || saving) return;
    const previous = selected;
    applyUiTheme(theme);
    setSaving(true);
    setErrors([]);
    setSavedNote(null);
    try {
      const next = await api.saveSettings({ uiTheme: theme });
      onSaved(next);
      setSavedNote("Saved");
    } catch (err) {
      applyUiTheme(previous);
      setErrors(putErrors(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Appearance">
      <Card variant="raised">
        <Field
          label="Theme"
          htmlFor="ui-theme"
          help={<>{UI_THEMES.find((t) => t.id === selected)?.hint} Light and dark stay as your system (or browser) sets them; the theme only changes colours, fonts, corners and shadows.</>}
          status={<>{errors.map((m) => (<span className="err" role="alert" key={m}>{m}</span>))}{savedNote ? <span className="hint">{savedNote}</span> : null}</>}
        >
          <Select
            id="ui-theme"
            data-testid="ui-theme"
            value={selected}
            disabled={saving}
            onChange={(e) => void pick(e.target.value as UiThemeId)}
          >
            {UI_THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
      </Card>
    </section>
  );
}
