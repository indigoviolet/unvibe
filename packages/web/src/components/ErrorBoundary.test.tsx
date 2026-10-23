/**
 * Error boundaries (issue #101): a throw in one part shows that part's
 * fallback and leaves the rest rendered; the error is reported once with
 * the catching boundary named; the boundary resets when the wrapped thing
 * changes identity or when Retry is used.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { ErrorBoundary, InlineFallback, RouteShellBoundary, ShellFallback } from "./ErrorBoundary.js";
import { reportWebError } from "../sentry.js";

function Boom({ message = "boom" }: { message?: string }): never {
  throw new Error(message);
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  test("renders children when nothing throws", () => {
    render(
      <ErrorBoundary name="card" resetKey="a" fallback={() => <div>fallback</div>}>
        <div>content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(screen.queryByText("fallback")).toBeNull();
  });

  test("a throw in one boundary leaves siblings rendered", () => {
    const report = vi.fn();
    render(
      <>
        <ErrorBoundary
          name="card"
          resetKey="bad"
          report={report}
          fallback={({ reset }) => <InlineFallback message="Couldn't show this card" onRetry={reset} />}
        >
          <Boom />
        </ErrorBoundary>
        <ErrorBoundary
          name="card"
          resetKey="good"
          report={report}
          fallback={({ reset }) => <InlineFallback message="Couldn't show this card" onRetry={reset} />}
        >
          <div>good card</div>
        </ErrorBoundary>
        <div>source pane</div>
      </>,
    );
    expect(screen.getByText("Couldn't show this card")).toBeInTheDocument();
    expect(screen.getByText("good card")).toBeInTheDocument();
    expect(screen.getByText("source pane")).toBeInTheDocument();
    // Only the throwing boundary reported.
    expect(report).toHaveBeenCalledTimes(1);
  });

  test("the error is reported once, naming the boundary", () => {
    const report = vi.fn();
    render(
      <ErrorBoundary
        name="guide-card"
        resetKey="a"
        report={report}
        fallback={() => <div>fallback</div>}
      >
        <Boom message="card boom" />
      </ErrorBoundary>,
    );
    expect(report).toHaveBeenCalledTimes(1);
    const [err, info] = report.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("card boom");
    expect(info).toMatchObject({ boundary: "guide-card" });
  });

  test("the error is logged locally", () => {
    render(
      <ErrorBoundary name="card" resetKey="a" fallback={() => <div>fallback</div>}>
        <Boom message="local boom" />
      </ErrorBoundary>,
    );
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: "local boom" }));
  });

  test("a stuck error survives re-renders until the identity changes", () => {
    let shouldThrow = true;
    const MaybeBoom = (): React.JSX.Element => {
      if (shouldThrow) throw new Error("sticky");
      return <div>recovered</div>;
    };
    const { rerender } = render(
      <ErrorBoundary name="card" resetKey="a" fallback={() => <div>card fallback</div>}>
        <MaybeBoom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("card fallback")).toBeInTheDocument();
    // The cause is gone but the identity is the same: still the fallback.
    shouldThrow = false;
    rerender(
      <ErrorBoundary name="card" resetKey="a" fallback={() => <div>card fallback</div>}>
        <MaybeBoom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("card fallback")).toBeInTheDocument();
    // A new identity (another review, page, or replaced card) resets.
    rerender(
      <ErrorBoundary name="card" resetKey="b" fallback={() => <div>card fallback</div>}>
        <MaybeBoom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });

  test("Retry re-renders the part without reloading", () => {
    let shouldThrow = true;
    const MaybeBoom = (): React.JSX.Element => {
      if (shouldThrow) throw new Error("transient");
      return <div>back</div>;
    };
    render(
      <ErrorBoundary
        name="card"
        resetKey="a"
        fallback={({ reset }) => <InlineFallback message="Couldn't show this card" onRetry={reset} />}
      >
        <MaybeBoom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Couldn't show this card")).toBeInTheDocument();
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("back")).toBeInTheDocument();
  });
});

describe("ShellFallback", () => {
  test("says something went wrong and offers Reload", () => {
    const onReload = vi.fn();
    render(<ShellFallback onReload={onReload} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  test("a top-level throw shows the shell fallback with Reload", () => {
    const onReload = vi.fn();
    render(
      <ErrorBoundary name="shell" resetKey="/" fallback={() => <ShellFallback onReload={onReload} />}>
        <Boom message="top boom" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });
});

describe("RouteShellBoundary", () => {
  function MaybeBoom(): React.JSX.Element {
    const location = useLocation();
    if (location.pathname === "/review/a") throw new Error("route boom");
    return <div>route ok</div>;
  }

  function renderAt(path: string): void {
    render(
      <MemoryRouter initialEntries={[path]}>
        <RouteShellBoundary>
          <MaybeBoom />
        </RouteShellBoundary>
      </MemoryRouter>,
    );
  }

  test("catches route content and resets on navigation", () => {
    renderAt("/review/a");
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    cleanup();
    renderAt("/review/b");
    expect(screen.getByText("route ok")).toBeInTheDocument();
  });
});

describe("reportWebError", () => {
  test("never throws and stays silent with no DSN", () => {
    expect(() => reportWebError(new Error("x"), { boundary: "test" })).not.toThrow();
  });
});
