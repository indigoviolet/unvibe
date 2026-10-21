/** #201 shared components on Base UI (@base-ui/react) for behaviour, own CSS on theme variables. Select stays native (see write-up). */
import { Button as BaseButton } from "@base-ui/react/button";
import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import "./ui.css";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" | "danger"; size?: "sm" | "md" | "lg" }>(function Button({ variant = "secondary", size = "md", ...p }, ref): React.JSX.Element {
  return <BaseButton ref={ref} data-variant={variant} data-size={size} className="ui-btn" {...p} />;
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
export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "warn" | "error"; children: ReactNode }): React.JSX.Element {
  return <span className="ui-badge" data-tone={tone}>{children}</span>;
}
export function Checkbox({ checked, onChange, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; ariaLabel?: string }): React.JSX.Element {
  return <BaseCheckbox.Root checked={checked} onCheckedChange={(v) => onChange(v === true)} className="ui-checkbox" aria-label={ariaLabel}><BaseCheckbox.Indicator>{checked ? "✓" : ""}</BaseCheckbox.Indicator></BaseCheckbox.Root>;
}
export function Switch({ checked, onChange, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; ariaLabel?: string }): React.JSX.Element {
  return <BaseSwitch.Root checked={checked} onCheckedChange={(v) => onChange(v === true)} className="ui-switch" aria-label={ariaLabel}><BaseSwitch.Thumb className="ui-switch-thumb" /></BaseSwitch.Root>;
}
export function Select(p: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element { return <select className="ui-select" {...p} />; }
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
