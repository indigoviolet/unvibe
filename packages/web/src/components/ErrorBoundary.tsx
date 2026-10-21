/**
 * Error boundaries (issue #101): before this, any exception during render
 * or commit unmounted the whole tree and left a white page.
 *
 * - `ErrorBoundary` renders its children directly (no wrapper element), so
 *   prototype.css child selectors (`.doc > .ui-card`, `.doc.finding > .ui-card`)
 *   keep matching. Each placement passes its own fallback shaped like the
 *   thing it replaces (a card-sized section, a file-shaped div, …).
 * - `name` identifies the placement in the report; `resetKey` identifies
 *   the thing wrapped (review + page, card id + revision, review + pane
 *   tab, review + file). When the key changes the error clears, so one bad
 *   render does not stick after navigation or a replacement.
 * - Caught errors are reported through the same dev-only path as the rest
 *   of the web app (`reportWebError`, dropped from the built bundle) and
 *   logged with `console.error` so they stay visible locally. The fallback
 *   never shows a raw stack.
 * - `report` is injectable so tests can assert reporting without Sentry.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { reportWebError } from "../sentry.js";
import { Button } from "../ui/index.js";

export interface BoundaryReport {
  boundary: string;
  componentStack: string | undefined;
}

interface Props {
  /** Placement name, carried into the report (which boundary caught it). */
  name: string;
  /** Identity of the thing wrapped: a change clears a stuck error. */
  resetKey: string;
  fallback: (props: { reset: () => void }) => ReactNode;
  report?: (error: unknown, info: BoundaryReport) => void;
  children?: ReactNode;
}

interface State {
  error: unknown | null;
  reported: unknown | null;
  resetKey: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, reported: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) {
      return { error: null, reported: null, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Always visible locally, even with no reporting backend.
    console.error(error);
    // Report once per error instance: a retry that throws again reports
    // again only when it throws a new object.
    if (this.state.reported !== error) {
      this.setState({ reported: error });
      const report = this.props.report ?? reportWebError;
      try {
        report(error, { boundary: this.props.name, componentStack: info.componentStack ?? undefined });
      } catch {
        // reporting is best-effort
      }
    }
  }

  private reset = (): void => {
    this.setState({ error: null, reported: null });
  };

  render(): ReactNode {
    if (this.state.error !== null) {
      return this.props.fallback({ reset: this.reset });
    }
    return this.props.children;
  }
}

/** Small inline notice for a failed part: hint text plus a retry button. */
export function InlineFallback({ message, onRetry }: { message: string; onRetry: () => void }): React.JSX.Element {
  return (
    <div className="hint" role="alert">
      <span>{message}</span>{" "}
      <button className="x" type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

interface ShellFallbackProps {
  /** Override the reload (tests); defaults to a full page reload. */
  onReload?: () => void;
}

/** Full-page fallback for the shell boundary: notice plus Reload. */
export function ShellFallback({ onReload }: ShellFallbackProps): React.JSX.Element {
  return (
    <div className="app">
      <div className="doc" role="alert">
        <h1 className="title">Something went wrong</h1>
        <p className="hint">Couldn&apos;t show this page: something went wrong — reload to try again.</p>
        <Button
          variant="primary"
          type="button"
          onClick={() => (onReload ?? ((): void => window.location.reload()))()}
        >
          Reload
        </Button>
      </div>
    </div>
  );
}

/**
 * Shell boundary for the route tree: catches everything, including routes
 * other than the review, and resets on navigation.
 */
export function RouteShellBoundary({ children }: { children: ReactNode }): React.JSX.Element {
  const location = useLocation();
  return (
    <ErrorBoundary name="shell" resetKey={location.pathname} fallback={() => <ShellFallback />}>
      {children}
    </ErrorBoundary>
  );
}
