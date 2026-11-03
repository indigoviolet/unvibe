/** #201 shared components on Base UI (@base-ui/react) for behaviour, own CSS on theme variables. #225: Select is Base UI's (themed popup, Floating UI positioning). */
import { Button as BaseButton } from "@base-ui/react/button";
import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { forwardRef, useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import type { PrReviewDecision, PrState } from "@unvibe/shared";
import { Icon, type IconName } from "../components/Icon.js";
import "./ui.css";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" | "danger"; size?: "sm" | "md" | "lg" }>(function Button({ variant = "secondary", size = "md", className, ...p }, ref): React.JSX.Element {
  return <BaseButton ref={ref} data-variant={variant} data-size={size} {...p} className={className ? `ui-btn ${className}` : "ui-btn"} />;
});
export function Field({ label, htmlFor, help, status, children }: { label: string; htmlFor?: string; help?: ReactNode; status?: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <div className="ui-field">
      <div className="ui-field-text">
        <label className="ui-field-label" htmlFor={htmlFor}>{label}</label>
        {help ? <span className="ui-help">{help}</span> : null}
      </div>
      <div className="ui-field-control">
        {children}
        {status}
      </div>
    </div>
  );
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
export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "warn" | "error" | "merged" | "outline"; children: ReactNode }): React.JSX.Element {
  return <span className="ui-badge" data-tone={tone}>{children}</span>;
}

const PR_STATE_ICON: Record<PrState, { icon: IconName; color: string; label: string }> = {
  draft: { icon: "pr-draft", color: "var(--text-secondary)", label: "Draft" },
  open: { icon: "pr-open", color: "var(--accent)", label: "Open" },
  merged: { icon: "pr-merged", color: "var(--note)", label: "Merged" },
  closed: { icon: "pr-closed", color: "var(--warn)", label: "Closed" },
};
const PR_DECISION_ICON: Record<PrReviewDecision, { icon: IconName; color: string; label: string }> = {
  approved: { icon: "check", color: "var(--accent)", label: "Approved" },
  changes_requested: { icon: "request-changes", color: "var(--warn)", label: "Changes requested" },
};

/**
 * #224: PR state + review-decision icons. One small icon each, in the
 * state's chip colour (the `ui-badge` tone variables), with the state's
 * name as the tooltip (the app's shared `data-tip`) and accessible
 * label. No text. Branch reviews pass neither and show nothing.
 * #234: no icon when the PR is open — open is the normal case, so only
 * other states get an icon (decisions still show).
 */
export function PrBadges({ prState, reviewDecision }: { prState?: PrState; reviewDecision?: PrReviewDecision }): React.JSX.Element | null {
  // #234: open is the normal case — no state icon for it.
  const state = prState && prState !== "open" ? PR_STATE_ICON[prState] : null;
  const decision = reviewDecision ? PR_DECISION_ICON[reviewDecision] : null;
  if (!state && !decision) return null;
  // A lookup miss (a stored value outside the type) is undefined, not
  // null — filter both out so it renders nothing instead of crashing.
  // A lookup miss (a stored value outside the type) is undefined, not
  // null — filter both out so it renders nothing instead of crashing.
  const icons = [state, decision].filter((i): i is NonNullable<typeof i> => i != null);
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center", flex: "none" }} data-testid="pr-badges">
      {icons.map((i) => (
        <span
          key={i.label}
          role="img"
          aria-label={i.label}
          data-tip={i.label}
          style={{ color: i.color, display: "inline-flex", flex: "none" }}
        >
          <Icon name={i.icon} />
        </span>
      ))}
    </span>
  );
}

/**
 * #224: one shared diff stat (`+N −M`) for the PR list, diff file
 * headers, hunk headers and the file tree. Plain coloured text, no
 * pill; thousands separators per the glossary; zero sides stay
 * (`+N −0`); null when neither side is known. The style lives in
 * `ui.css` (`.ui-diffstat`), so a restyle is a one-line edit.
 */
export function DiffStat({ added, removed }: { added?: number | null; removed?: number | null }): React.JSX.Element | null {
  const num = (n: number | null | undefined): string | null =>
    typeof n === "number" && Number.isFinite(n) && n >= 0 ? n.toLocaleString("en-US") : null;
  const a = num(added);
  const r = num(removed);
  if (a === null && r === null) return null;
  return (
    <span className="ui-diffstat">
      {a !== null ? <span className="a">+{a}</span> : null}
      {a !== null && r !== null ? " " : null}
      {/* U+2212 minus, as in the diff pane. */}
      {r !== null ? <span className="d">−{r}</span> : null}
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

/**
 * Shared loading state for the review panes while a review is being
 * prepared (issue #232): the processing indicator plus a short
 * label at body size. The indicator is the only "working" signal — no
 * trailing ellipses, no commentary sentences.
 *
 * #284: the guide-building state shows the disco ball swinging gently
 * on its own (`variant="guide"`); the diff-loading state shows the
 * ball's pink glints on their own (`variant="diff"`). The follow-up
 * makes both hero-sized: the ball derives from the start page's ball
 * (see `ui.css`), stacked above the label with the group centred in
 * the pane. No variant keeps the legacy dots for every other working state (Ask/Explain "Writing answer" and
 * so on), which is unchanged. The art is decorative (`aria-hidden`);
 * the visible label stays the accessible text via `role="status"`.
 */
export function PaneLoading({ label, variant }: { label: string; variant?: "guide" | "diff" }): React.JSX.Element {
  if (variant === "guide") {
    return (
      <p className="pane-loading" data-variant="guide" role="status">
        <span className="guide-scene" aria-hidden="true">
          <img className="guide-ball" src={`${import.meta.env.BASE_URL}disco-ball.svg`} alt="" />
        </span>
        <span>{label}</span>
      </p>
    );
  }
  if (variant === "diff") {
    return (
      <p className="pane-loading" data-variant="diff" role="status">
        <LoadingGlints />
        <span>{label}</span>
      </p>
    );
  }
  return (
    <p className="pane-loading">
      <ProcessingDots />
      <span>{label}</span>
    </p>
  );
}

/**
 * #284: the disco ball's pink four-point sparkles, reused from
 * `packages/web/public/disco-ball.svg` (exact path data, the art's
 * pinks) as tiny inline SVGs. Shown only in the ball-less diff state,
 * staggered in a loose cluster as if the ball were just out of frame
 * up-left — never a straight row, so they never read as the old dots.
 * Same 2.5s cycle and easing as the swing, drifting and twinkling in
 * the same rhythm. Decorative.
 */
function LoadingGlints(): React.JSX.Element {
  return (
    <span className="loading-glints loose" aria-hidden="true">
      <svg viewBox="52.5 19.5 11.5 19.8">
        <path
          d="m58.02 20.21c-0.26 8.54 0.35 8.98-5.21 9.13 5.57 0.2 4.96 0.43 5.22 9.27 0.36-9.05-0.41-9.15 5.26-9.27-5.67-0.13-5.01-0.63-5.27-9.13z"
          fill="#FF38E9"
        />
      </svg>
      <svg viewBox="60 57 6.2 10.7">
        <path
          d="m62.81 57.66c-0.16 4.66 0.07 4.62-2.52 4.76 2.62 0.12 2.38 0.09 2.54 4.75 0.11-4.78-0.15-4.73 2.95-4.76-3.17-0.13-2.8 0.01-2.97-4.75z"
          fill="#FF48F1"
        />
      </svg>
      <svg viewBox="52.5 19.5 11.5 19.8">
        <path
          d="m58.02 20.21c-0.26 8.54 0.35 8.98-5.21 9.13 5.57 0.2 4.96 0.43 5.22 9.27 0.36-9.05-0.41-9.15 5.26-9.27-5.67-0.13-5.01-0.63-5.27-9.13z"
          fill="#FF38E9"
        />
      </svg>
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

/** Every phase of the inline confirm's state machine (#346). */
export type InlineConfirmPhase = "idle" | "confirming" | "running" | "confirmed" | "error";

/** An open confirm with no interaction reverts to idle after this long. */
const INLINE_CONFIRM_REVERT_MS = 4500;
/** How long "✓ Confirmed" shows before the action's result takes over. */
const INLINE_CONFIRM_DONE_MS = 900;

function inlineConfirmMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return "Something went wrong.";
}

/**
 * #346 inline confirm: a button that expands in place into
 * "Confirm <action>" with a ✓ (confirm) and a ✕ (cancel) segment,
 * then flashes "✓ Confirmed" once the action succeeds.
 *
 * - Idle renders a plain button (`action`). Clicking it opens the pill
 *   in place (an overlay anchored to the button, so neighbouring
 *   layout never shifts) and moves focus to ✓.
 * - Enter or ✓ runs `onConfirm`; the pill shows `runningLabel`
 *   disabled while it is in flight, then "✓ Confirmed" briefly before
 *   closing and calling `onDone` (the parent's result — removing the
 *   row, updating counts — takes over from there).
 * - Escape, ✕, a click outside, or about 4–5 s without interaction
 *   cancels back to idle (focus returns to the action button when it
 *   was inside). A rejected action shows the error inline with
 *   `role="alert"` and stays until the user retries or cancels — an
 *   error must be read and acted on, never timed out.
 * - `open`/`onOpenChange` make the idle↔confirming gate controlled so
 *   a list keeps only one confirm open at a time; without them the
 *   gate is local. `onConfirm` rejections stay inside the pill, shown
 *   through `formatError`.
 * - The expanded group carries an `aria-label` ("Confirm <action>:
 *   confirm or cancel" by default) on a polite live region, and both
 *   segments are buttons with names. `danger` keeps a warn-coloured
 *   edge on the pill for destructive actions.
 */
export function InlineConfirm({
  action,
  confirmAction,
  runningLabel,
  confirmedLabel = "Confirmed",
  danger,
  disabled,
  size = "sm",
  variant = "secondary",
  open,
  onOpenChange,
  onConfirm,
  onDone,
  formatError = inlineConfirmMessage,
  detail,
  announce,
  testId,
  title,
  idleAriaLabel,
  idleRender,
}: {
  /** Idle button label, e.g. "Remove". */
  action: string;
  /** Verb phrase for "Confirm <action>", e.g. "remove review". */
  confirmAction: string;
  /** Shown disabled while the action runs; defaults to "<action>…". */
  runningLabel?: string;
  /** Shown after success; defaults to "Confirmed" (with a green ✓). */
  confirmedLabel?: string;
  /** Destructive actions keep a warn-coloured edge on the pill. */
  danger?: boolean;
  /** Disables the idle button (e.g. another row is busy). */
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "secondary" | "quiet" | "danger";
  /** Controlled gate (a list passes one open id); local when absent. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The confirmed work; reject to show the error inline. */
  onConfirm: () => void | Promise<void>;
  /** Called after the confirmed flash, when the result takes over. */
  onDone?: () => void;
  formatError?: (err: unknown) => string;
  /** Question or hint shown in flow while open, e.g. what is lost. */
  detail?: ReactNode;
  /** Expanded-state announcement; defaults to "Confirm <action>: confirm or cancel". */
  announce?: string;
  testId?: string;
  title?: string;
  idleAriaLabel?: string;
  /**
   * Custom idle control (e.g. a toolbar icon button): receives the
   * focus ref, the expanded flag, the disabled flag and the opener.
   * It renders inside a slot that stays hidden-but-mounted while the
   * pill is open, so the pill anchors to it and focus restores to it
   * on cancel — the same contract as the default text button.
   */
  idleRender?: (controls: {
    ref: Ref<HTMLButtonElement>;
    expanded: boolean;
    disabled: boolean;
    onOpen: () => void;
  }) => ReactNode;
}): React.JSX.Element {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const idleRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const doneTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    // StrictMode mounts, unmounts and remounts in dev: the cleanup must
    // not permanently disarm the async paths, so setup re-arms them.
    alive.current = true;
    return () => {
      alive.current = false;
      window.clearTimeout(doneTimer.current);
    };
  }, []);

  const [uncontrolled, setUncontrolled] = useState(false);
  const gateOpen = open ?? uncontrolled;
  const setGate = useCallback(
    (v: boolean) => {
      if (open === undefined) setUncontrolled(v);
      onOpenChange?.(v);
    },
    [open, onOpenChange],
  );
  const [stage, setStage] = useState<"confirming" | "running" | "confirmed" | "error">("confirming");
  const [errorText, setErrorText] = useState<string | null>(null);
  const phase: InlineConfirmPhase = gateOpen ? stage : "idle";

  // A closed gate always resets the inner stage, so reopening starts clean.
  useEffect(() => {
    if (!gateOpen) {
      setStage("confirming");
      setErrorText(null);
    }
  }, [gateOpen]);

  const [refocusIdle, setRefocusIdle] = useState(false);
  useEffect(() => {
    if (phase === "idle" && refocusIdle) {
      setRefocusIdle(false);
      idleRef.current?.focus();
    }
  }, [phase, refocusIdle]);

  const cancel = useCallback(() => {
    const ae = document.activeElement;
    setRefocusIdle(ae instanceof Node && !!wrapRef.current?.contains(ae));
    setStage("confirming");
    setErrorText(null);
    setGate(false);
  }, [setGate]);
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;

  const confirm = useCallback(() => {
    if (disabled || stage === "running" || stage === "confirmed") return;
    setStage("running");
    setErrorText(null);
    let result: void | Promise<void>;
    try {
      result = onConfirm();
    } catch (err) {
      if (!alive.current) return;
      setErrorText(formatError(err));
      setStage("error");
      return;
    }
    void Promise.resolve(result)
      .then(() => {
        if (!alive.current) return;
        setStage("confirmed");
        window.clearTimeout(doneTimer.current);
        doneTimer.current = window.setTimeout(() => {
          if (!alive.current) return;
          setGate(false);
          onDone?.();
        }, INLINE_CONFIRM_DONE_MS);
      })
      .catch((err: unknown) => {
        if (!alive.current) return;
        setErrorText(formatError(err));
        setStage("error");
      });
  }, [disabled, stage, onConfirm, formatError, setGate, onDone]);

  // Focus moves to ✓ when the pill opens.
  const prevPhase = useRef<InlineConfirmPhase>(phase);
  useEffect(() => {
    if (phase === "confirming" && prevPhase.current === "idle") confirmRef.current?.focus();
    prevPhase.current = phase;
  }, [phase]);

  // Escape, or a click outside the pill, cancels (not while running).
  useEffect(() => {
    if (phase !== "confirming" && phase !== "error") return;
    const onPointer = (e: PointerEvent): void => {
      const n = e.target as Node;
      if (!wrapRef.current?.contains(n)) cancelRef.current();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") cancelRef.current();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [phase]);

  // No interaction for a while reverts an open (not errored) confirm.
  useEffect(() => {
    if (phase !== "confirming") return;
    let timer = window.setTimeout(() => cancelRef.current(), INLINE_CONFIRM_REVERT_MS);
    const poke = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => cancelRef.current(), INLINE_CONFIRM_REVERT_MS);
    };
    const el = wrapRef.current;
    el?.addEventListener("pointerdown", poke);
    el?.addEventListener("keydown", poke);
    el?.addEventListener("focusin", poke);
    return () => {
      window.clearTimeout(timer);
      el?.removeEventListener("pointerdown", poke);
      el?.removeEventListener("keydown", poke);
      el?.removeEventListener("focusin", poke);
    };
  }, [phase]);

  const openNow = phase !== "idle";
  const busy = runningLabel ?? `${action}…`;
  const openIdle = (): void => setGate(true);
  return (
    <span ref={wrapRef} className="uic" data-phase={phase} data-size={size} data-danger={danger || undefined} data-testid={testId}>
      <span className="uic-slot">
        <span className="uic-idlehold" style={openNow ? { visibility: "hidden" } : undefined}>
          {idleRender ? (
            idleRender({ ref: idleRef, expanded: openNow, disabled: disabled || openNow, onOpen: openIdle })
          ) : (
            <Button
              ref={idleRef}
              variant={variant}
              size={size}
              type="button"
              aria-label={idleAriaLabel ?? action}
              aria-expanded={openNow}
              title={title}
              disabled={disabled || openNow}
              onClick={openIdle}
            >
              {action}
            </Button>
          )}
        </span>
        {openNow ? (
          <span className="uic-pill" role="group" aria-label={announce ?? `Confirm ${confirmAction}: confirm or cancel`} aria-live="polite">
            {phase === "running" ? (
              <span className="uic-busy">
                <span>{busy}</span>
                <ProcessingDots />
              </span>
            ) : phase === "confirmed" ? (
              <span className="uic-done" role="status">
                <span className="uic-tick" aria-hidden="true">
                  ✓
                </span>{" "}
                {confirmedLabel}
              </span>
            ) : (
              <>
                <span className="uic-label">Confirm {confirmAction}</span>
                <button ref={confirmRef} className="uic-yes" type="button" aria-label={`Confirm ${confirmAction}`} disabled={disabled} onClick={confirm}>
                  <span aria-hidden="true">✓</span>
                </button>
                <button className="uic-no" type="button" aria-label="Cancel" disabled={disabled} onClick={() => cancelRef.current()}>
                  <span aria-hidden="true">✕</span>
                </button>
              </>
            )}
          </span>
        ) : null}
      </span>
      {openNow && detail ? <span className="uic-detail">{detail}</span> : null}
      {phase === "error" && errorText ? (
        <span className="uic-error" role="alert">
          {errorText}
        </span>
      ) : null}
    </span>
  );
}
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
