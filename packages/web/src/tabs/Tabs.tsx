/**
 * Shared tab strip (issues #60 debug page, #61 settings page): one tab row
 * in the prototype `.tabs` / `.tab` style with `tablist` / `tab` /
 * `tabpanel` roles, the selected tab in the `?tab=` query parameter
 * (other parameters kept, history replaced), and every panel kept mounted
 * behind `hidden` so per-tab state — form edits, open blocks, the jobs
 * live subscription — survives a tab switch.
 */
import { useCallback } from "react";
import { useSearchParams } from "react-router";

export interface TabDef {
  id: string;
  label: string;
}

/**
 * Pick the tab for a raw `?tab=` value: known ids win, anything else
 * (missing, empty, unknown) falls back to the default.
 */
export function parseTabId(
  raw: string | null,
  ids: readonly string[],
  fallback: string,
): string {
  if (raw !== null && ids.includes(raw)) return raw;
  return fallback;
}

/**
 * Map a `#hash` to a tab id, for the older section links
 * (`/settings#environment`). Returns null when the hash names no tab.
 */
export function tabIdFromHash(hash: string, ids: readonly string[]): string | null {
  const id = hash.startsWith("#") ? hash.slice(1) : hash;
  return id !== "" && ids.includes(id) ? id : null;
}

/** `?tab=` state for a tab strip: read the param, write it back in place. */
export function useQueryTab(ids: readonly string[], defaultId: string): [string, (id: string) => void] {
  const [params, setParams] = useSearchParams();
  const tab = parseTabId(params.get("tab"), ids, defaultId);
  const select = useCallback(
    (id: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", id);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [tab, select];
}

export function Tabs({
  label,
  tabs,
  active,
  onSelect,
  idPrefix,
}: {
  label: string;
  tabs: readonly TabDef[];
  active: string;
  onSelect: (id: string) => void;
  idPrefix: string;
}): React.JSX.Element {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          id={`${idPrefix}-tab-${t.id}`}
          className="tab"
          role="tab"
          type="button"
          aria-selected={active === t.id}
          aria-controls={`${idPrefix}-panel-${t.id}`}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({
  idPrefix,
  id,
  active,
  children,
}: {
  idPrefix: string;
  id: string;
  active: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${id}`}
      aria-labelledby={`${idPrefix}-tab-${id}`}
      hidden={!active}
    >
      {children}
    </div>
  );
}
