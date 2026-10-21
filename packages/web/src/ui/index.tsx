/** #201 shared components on Base UI (@base-ui/react) for behaviour, own CSS on theme variables. #225: Select is Base UI's (themed popup, Floating UI positioning). */
import { Button as BaseButton } from "@base-ui/react/button";
import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import type { PrReviewDecision, PrState } from "@unvibe/shared";
import "./ui.css";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" | "danger"; size?: "sm" | "md" | "lg" }>(function Button({ variant = "secondary", size = "md", className, ...p }, ref): React.JSX.Element {
  return <BaseButton ref={ref} data-variant={variant} data-size={size} {...p} className={className ? `ui-btn ${className}` : "ui-btn"} />;
});
export function Field({ label, htmlFor, help, status, children }: { label: string; htmlFor?: string; help?: ReactNode; status?: ReactNode; children: ReactNode }): React.JSX.Element {
  return <div className="ui-field"><label htmlFor={htmlFor}>{label}</label><div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>{children}{help ? <span className="ui-help">{help}</span> : null}{status}</div></div>;
}
export type CardVariant = "plain" | "raised" | "inset" | "interactive";
export type CardProps = {
  variant?: CardVariant;
  as?: "div" | "section" | "article" | "nav" | "li";
  header?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
} & HTMLAttributes<HTMLElement> & Record<`data-${string}`, unknown>;
export const Card = forwardRef<HTMLElement, CardProps>(function Card({ variant = "plain", as: Tag = "div", header, footer, className, children, ...rest }, ref): React.JSX.Element {
  const cls = `ui-card${className ? ` ${className}` : ""}`;
  const El = Tag as "div";
  return <El ref={ref as never} data-variant={variant} className={cls} {...rest}>{header ? <div className="ui-card-header">{header}</div> : null}{children}{footer ? <div className="ui-card-footer">{footer}</div> : null}</El>;
});
export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardHeader({ className, children, ...rest }, ref): React.JSX.Element {
  return <div ref={ref} className={`ui-card-header${className ? ` ${className}` : ""}`} {...rest}>{children}</div>;
});
export function CardBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={`ui-card-body${className ? ` ${className}` : ""}`} {...rest}>{children}</div>;
}
export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardFooter({ className, children, ...rest }, ref): React.JSX.Element {
  return <div ref={ref} className={`ui-card-footer${className ? ` ${className}` : ""}`} {...rest}>{children}</div>;
});
export function ListRow({ primary, meta, trailing, ...rest }: { primary: ReactNode; meta?: ReactNode; trailing?: ReactNode; [k: string]: unknown }): React.JSX.Element {
  return <div className="ui-row" {...rest}><div style={{ minWidth: 0 }}><div className="ui-row-primary">{primary}</div>{meta ? <div className="ui-row-meta">{meta}</div> : null}</div><div style={{ display: "flex", gap: 6, alignItems: "center" }}>{trailing}</div></div>;
}
export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "warn" | "error" | "merged"; children: ReactNode }): React.JSX.Element {
  return <span className="ui-badge" data-tone={tone}>{children}</span>;
}

const PR_STATE_BADGE: Record<PrState, { tone: "neutral" | "ok" | "warn" | "error" | "merged"; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  open: { tone: "ok", label: "Open" },
  merged: { tone: "merged", label: "Merged" },
  closed: { tone: "error", label: "Closed" },
};
const PR_DECISION_BADGE: Record<PrReviewDecision, { tone: "neutral" | "ok" | "warn" | "error" | "merged"; label: string }> = {
  approved: { tone: "ok", label: "Approved" },
  changes_requested: { tone: "error", label: "Changes requested" },
  review_required: { tone: "warn", label: "Review required" },
};

/** #224: PR state + review-decision badges. Branch reviews pass neither and show nothing. */
export function PrBadges({ prState, reviewDecision }: { prState?: PrState; reviewDecision?: PrReviewDecision }): React.JSX.Element | null {
  const state = prState ? PR_STATE_BADGE[prState] : null;
  const decision = reviewDecision ? PR_DECISION_BADGE[reviewDecision] : null;
  if (!state && !decision) return null;
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center", flex: "none" }} data-testid="pr-badges">
      {state ? <Badge tone={state.tone}>{state.label}</Badge> : null}
      {decision ? <Badge tone={decision.tone}>{decision.label}</Badge> : null}
    </span>
  );
}

/** The app's processing indicator (dots, as on the review page), without text. */
export function ProcessingDots(): React.JSX.Element {
  return (
    <span role="status" aria-label="Working">
      <span className="dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}
export function Checkbox({ checked, onChange, ariaLabel, id, testId, disabled }: { checked: boolean; onChange: (v: boolean) => void; ariaLabel?: string; id?: string; testId?: string; disabled?: boolean }): React.JSX.Element {
  return <BaseCheckbox.Root id={id} data-testid={testId} disabled={disabled} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="ui-checkbox" aria-label={ariaLabel}><BaseCheckbox.Indicator>{checked ? "✓" : ""}</BaseCheckbox.Indicator></BaseCheckbox.Root>;
}
export function Switch({ checked, onChange, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; ariaLabel?: string }): React.JSX.Element {
  return <BaseSwitch.Root checked={checked} onCheckedChange={(v) => onChange(v === true)} className="ui-switch" aria-label={ariaLabel}><BaseSwitch.Thumb className="ui-switch-thumb" /></BaseSwitch.Root>;
}
export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}
export interface SelectGroup {
  label: string;
  options: SelectOption[];
}
export type SelectEntry = SelectOption | SelectGroup;
function isGroup(entry: SelectEntry): entry is SelectGroup {
  return "options" in entry;
}
function findLabel(entries: SelectEntry[], value: string): ReactNode {
  for (const entry of entries) {
    if (isGroup(entry)) {
      const hit = entry.options.find((o) => o.value === value);
      if (hit) return hit.label;
    } else if (entry.value === value) {
      return entry.label;
    }
  }
  return undefined;
}

/**
 * #225: Base UI Select — themed trigger and popup in theme fonts,
 * positioned by Floating UI, with the library's keyboard and
 * screen-reader behaviour. Trigger keeps the shared Field look.
 */
export function Select({
  id,
  value,
  onValueChange,
  disabled,
  options,
  placeholder,
  className,
  ...rest
}: {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  options: SelectEntry[];
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
  title?: string;
  "data-testid"?: string;
}): React.JSX.Element {
  const selected = findLabel(options, value);
  const renderItem = (o: SelectOption): React.JSX.Element => (
    <BaseSelect.Item key={o.value} value={o.value} disabled={o.disabled} className="ui-select-item">
      <BaseSelect.ItemText>{o.label}</BaseSelect.ItemText>
      <BaseSelect.ItemIndicator className="ui-select-check">✓</BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  );
  return (
    <BaseSelect.Root
      id={id}
      value={value}
      disabled={disabled}
      onValueChange={(v) => {
        if (v !== null && v !== undefined) onValueChange(String(v));
      }}
    >
      <BaseSelect.Trigger
        className={className ? `ui-select ${className}` : "ui-select"}
        aria-label={rest["aria-label"]}
        title={rest.title}
        data-testid={rest["data-testid"]}
      >
        <BaseSelect.Value>{selected ?? placeholder ?? ""}</BaseSelect.Value>
        <BaseSelect.Icon className="ui-select-icon">
          <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} className="ui-select-positioner">
          <BaseSelect.Popup className="ui-select-popup">
            {options.map((entry) =>
              isGroup(entry) ? (
                <BaseSelect.Group key={entry.label} className="ui-select-group">
                  <BaseSelect.GroupLabel className="ui-select-grouplabel">{entry.label}</BaseSelect.GroupLabel>
                  {entry.options.map(renderItem)}
                </BaseSelect.Group>
              ) : (
                renderItem(entry)
              ),
            )}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
export function Input(p: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element { return <input className="ui-input" {...p} />; }
export function UiTabs({ label, tabs, active, onSelect, idPrefix }: { label: string; tabs: readonly { id: string; label: string }[]; active: string; onSelect: (id: string) => void; idPrefix: string }): React.JSX.Element {
  return <BaseTabs.Root value={active} onValueChange={(v) => onSelect(String(v))}><BaseTabs.List className="ui-tabs" aria-label={label}>{tabs.map((t) => <BaseTabs.Tab key={t.id} value={t.id} id={`${idPrefix}-tab-${t.id}`} className="ui-tab">{t.label}</BaseTabs.Tab>)}</BaseTabs.List></BaseTabs.Root>;
}
/** Human duration: 300000 -> "5 min", 60000 -> "1 min", 5000 -> "5 s". */
export function humanDuration(ms: number): string {
  if (!Number.isFinite(ms)) return String(ms);
  if (ms % 3600000 === 0) return `${ms / 3600000} hr`;
  if (ms % 60000 === 0) return `${ms / 60000} min`;
  if (ms >= 60000) return `${Math.round(ms / 60000)} min`;
  if (ms % 1000 === 0) return `${ms / 1000} s`;
  return `${ms} ms`;
}
export function shortStatus(s: string): string {
  return s.replace(/\s*\(running[^)]*\)/gi, "").replace(/\s+at\s+\/\S+/g, "").trim();
}
