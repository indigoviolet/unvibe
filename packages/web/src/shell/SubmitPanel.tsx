/**
 * Submit review button + panel (comments owner; PRD §4.12).
 *
 * - The top-bar button shows the count of pending changes (Outbox threads
 *   plus the description edit).
 * - The panel lists every comment in the Outbox (location as the
 *   backend's preview computes it + draft text) and the description
 *   change, with Cancel and Submit. It shows the backend's preview
 *   (`dryRun`) so what the user sees is what is posted, including
 *   fallback notes for lines GitHub will not accept.
 * - Handles success (threads become posted, with links), head-moved (409:
 *   offer refresh), partial failure, and the disabled state with the
 *   reason for a branch without a PR. Already-posted threads are shown as
 *   posted and are not pending.
 */
import { useEffect, useState } from "react";
import type { SubmitPreview } from "@unvibe/shared";
import { api, apiErrorCode, friendlyError } from "../api/client.js";
import { toast } from "../floating/Toast.js";
import { refreshErrorNotice } from "../versions/versionUtils.js";
import { useViewer } from "../comments/viewer.js";
import { pendingCount } from "../comments/threads.js";
import { useIsReadOnlyVersion } from "../comments/readOnly.js";
import { useReview } from "../state/store.js";
import { Badge, Button } from "../ui/index.js";

const READ_ONLY_REASON = "Viewing an older version · read-only · back to current to submit";

function locationLabel(comment: SubmitPreview["comments"][number]): string {
  const loc = comment.location;
  if (loc.kind === "inline") {
    const name = loc.path.split("/").pop() ?? loc.path;
    const range =
      loc.startLine !== undefined && (loc.startLine !== loc.line || loc.startSide !== loc.side)
        ? `${loc.startLine}–${loc.line}`
        : `${loc.line}`;
    return `${name}:${range}`;
  }
  return "General PR comment";
}

type PanelState =
  | { status: "loading" }
  | { status: "ready"; preview: SubmitPreview }
  | { status: "submitting"; preview: SubmitPreview }
  | { status: "done"; commentCount: number; descriptionUpdated: boolean; reviewUrl?: string }
  | { status: "partial"; commentCount: number; reviewUrl?: string; error: string }
  | { status: "conflict"; error: string }
  | { status: "error"; error: string };

export function SubmitPanel({ reviewId, primary }: { reviewId: string; primary?: boolean }) {
  const snapshot = useReview((s) => s.snapshot);
  const readOnly = useIsReadOnlyVersion();
  const viewer = useViewer();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PanelState>({ status: "loading" });

  const count = readOnly ? 0 : pendingCount(snapshot);
  const submitLabel = viewer ? `Submit as ${viewer}` : "Submit review";

  useEffect(() => {
    if (!open) return;
    if (readOnly) {
      setState({
        status: "ready",
        preview: {
          comments: [],
          alreadyPosted: [],
          reviewBody: "",
          commitId: "",
          disabledReason: READ_ONLY_REASON,
        },
      });
      return;
    }
    setState({ status: "loading" });
    let cancelled = false;
    api
      .submit(reviewId, { dryRun: true })
      .then((res) => {
        if (cancelled) return;
        if (res.preview) setState({ status: "ready", preview: res.preview });
        else if (res.reason) {
          setState({
            status: "ready",
            preview: {
              comments: [],
              alreadyPosted: [],
              reviewBody: "",
              commitId: "",
              disabledReason: res.reason,
            },
          });
        } else setState({ status: "error", error: "Couldn't load the comments to submit." });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: "error", error: friendlyError(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, reviewId, readOnly]);

  // A successful post flips threads to posted through a patch; refresh the
  // preview when reopened. Live counts on the button follow the store.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open ]);

  const reloadPreview = (): void => {
    setState({ status: "loading" });
    api
      .submit(reviewId, { dryRun: true })
      .then((res) => {
        if (res.preview) setState({ status: "ready", preview: res.preview });
        else setState({ status: "error", error: res.reason ?? "Couldn't load the comments to submit." });
      })
      .catch((err: unknown) => {
        setState({ status: "error", error: friendlyError(err) });
      });
  };

  const doRefresh = (): void => {
    api
      .refresh(reviewId)
      .then(() => api.review(reviewId))
      .then((snap) => {
        useReview.getState().setSnapshot(snap);
        reloadPreview();
        toast("Review refreshed. Check the list before submitting.");
      })
      .catch((err: unknown) => {
        toast(refreshErrorNotice(err));
      });
  };

  const doSubmit = (preview: SubmitPreview): void => {
    setState({ status: "submitting", preview });
    api
      .submit(reviewId, { expectedCount: preview.comments.length })
      .then((res) => {
        if (res.preview) {
          // dryRun echo: shouldn't happen, but show it rather than break.
          setState({ status: "ready", preview: res.preview });
          return;
        }
        if (res.partial) {
          setState({
            status: "partial",
            commentCount: res.commentCount,
            reviewUrl: res.reviewUrl,
            error: res.reason ?? "The review was posted, but the description wasn't updated.",
          });
          return;
        }
        if (res.posted) {
          setState({
            status: "done",
            commentCount: res.commentCount,
            descriptionUpdated: res.descriptionUpdated,
            ...(res.reviewUrl ? { reviewUrl: res.reviewUrl } : {}),
          });
          // Converge on the posted snapshot (posted markers, cleared edit).
          api.review(reviewId).then((snap) => useReview.getState().setSnapshot(snap)).catch(() => {});
          return;
        }
        setState({ status: "error", error: res.reason ?? "Nothing was posted." });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        // Code first (finding 10); responses without one fall back to text.
        const code = apiErrorCode(err);
        if (/409/.test(message) && (code === "head-moved" || (code === undefined && /head moved|refresh/i.test(message)))) {
          setState({ status: "conflict", error: friendlyError(err) });
        } else {
          setState({ status: "error", error: friendlyError(err) });
        }
      });
  };

  // #92: no Submit while loading or failed (service 409s). After all hooks
  // so the hook order never changes.
  const ingestStatus = snapshot?.ingest.status ?? "ready";
  if (ingestStatus !== "ready") return null;

  return (
    <span id="submitSlot">
      <Button
        variant={primary ? "primary" : "secondary"}
        size="sm"
        type="button"
        data-submit=""
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Submit review{count > 0 ? <Badge tone="warn">{count}</Badge> : null}
      </Button>
      {open ? (
        <div className="submit" role="dialog" aria-label="Submit review">
          {state.status === "loading" ? <span className="hint">Loading…</span> : null}
          {state.status === "submitting" ? <span className="hint">Submitting…</span> : null}
          {state.status === "error" ? (
            <>
              <b>Couldn't submit</b>
              <span className="hint">{state.error}</span>
              <div className="frow" style={{ justifyContent: "flex-end" }}>
                <Button variant="secondary" size="sm" type="button" data-submitclose="" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" type="button" onClick={reloadPreview}>
                  Retry
                </Button>
              </div>
            </>
          ) : null}
          {state.status === "conflict" ? (
            <>
              <b>The PR has new commits</b>
              <span className="hint">{state.error}</span>
              <div className="frow" style={{ justifyContent: "flex-end" }}>
                <Button variant="secondary" size="sm" type="button" data-submitclose="" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" type="button" onClick={doRefresh}>
                  Refresh the review
                </Button>
              </div>
            </>
          ) : null}
          {state.status === "ready" || state.status === "submitting" ? (
            <PreviewBody
              preview={state.preview}
              disabled={state.status === "submitting"}
              submitLabel={submitLabel}
              onCancel={() => setOpen(false)}
              onSubmit={() => doSubmit(state.preview)}
            />
          ) : null}
          {state.status === "done" ? (
            <>
              <b>Review posted</b>
              <span className="hint">
                {state.commentCount} comment{state.commentCount === 1 ? "" : "s"}
                {state.descriptionUpdated ? " and the description update" : ""} reached GitHub.
              </span>
              {state.reviewUrl ? (
                <a href={state.reviewUrl} target="_blank" rel="noreferrer noopener">
                  View on GitHub
                </a>
              ) : null}
              <div className="frow" style={{ justifyContent: "flex-end" }}>
                <Button variant="secondary" size="sm" type="button" data-submitclose="" onClick={() => setOpen(false)}>
                  OK
                </Button>
              </div>
            </>
          ) : null}
          {state.status === "partial" ? (
            <>
              <b>Review posted, description not updated</b>
              <span className="hint">{state.error}</span>
              {state.reviewUrl ? (
                <a href={state.reviewUrl} target="_blank" rel="noreferrer noopener">
                  View on GitHub
                </a>
              ) : null}
              <div className="frow" style={{ justifyContent: "flex-end" }}>
                <Button variant="secondary" size="sm" type="button" data-submitclose="" onClick={() => setOpen(false)}>
                  Close
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  type="button"
                  onClick={() => {
                    // Retry posts nothing twice: posted threads are skipped.
                    api.review(reviewId).then((snap) => useReview.getState().setSnapshot(snap)).catch(() => {});
                    reloadPreview();
                  }}
                >
                  Retry the description
                </Button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}

function PreviewBody({
  preview,
  disabled,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  preview: SubmitPreview;
  disabled: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const n = preview.comments.length + (preview.description ? 1 : 0);
  if (preview.disabledReason) {
    return (
      <>
        <b>Submit review</b>
        <span className="hint">{preview.disabledReason}</span>
        <div className="frow" style={{ justifyContent: "flex-end" }}>
          <Button variant="secondary" size="sm" type="button" data-submitclose="" onClick={onCancel}>
            Close
          </Button>
        </div>
      </>
    );
  }
  return (
    <>
      <b>Submit review</b>
      {preview.alreadyPosted.length > 0 ? (
        <span className="hint">
          {preview.alreadyPosted.length} already on GitHub. They won't be posted again.
        </span>
      ) : null}
      {n > 0 ? (
        <ul>
          {preview.comments.map((c) => (
            <li key={c.threadId}>
              <span className="cw">{locationLabel(c)}</span> {c.text.slice(0, 90)}
              {c.location.kind === "inline" && c.location.fallbackNote ? (
                <div className="hint">{c.location.fallbackNote}</div>
              ) : null}
              {c.location.kind === "general" && c.location.reason ? (
                <div className="hint">{c.location.reason}</div>
              ) : null}
            </li>
          ))}
          {preview.description ? (
            <li>
              <span className="cw">PR description</span> updated text
            </li>
          ) : null}
        </ul>
      ) : (
        <span className="hint">Nothing to submit. Add comments to the Outbox or edit the description first.</span>
      )}
      <div className="frow" style={{ justifyContent: "flex-end" }}>
        <Button variant="secondary" size="sm" type="button" data-submitclose="" onClick={onCancel}>
          Cancel
        </Button>
        {n > 0 ? (
          <Button variant="primary" size="sm" type="button" data-submitgo="" disabled={disabled} onClick={onSubmit}>
            {submitLabel}
          </Button>
        ) : null}
      </div>
    </>
  );
}
