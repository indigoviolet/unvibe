/**
 * Issue #430: the guide stopped early and the repair is still
 * incomplete. One line under the guide title, in the existing hint
 * style, carrying the existing Re-do flow (its icon button plus the
 * shared inline confirm) — so the partial guide is never presented as
 * done. Shown when the latest reader job carries the shared
 * stopped-early reason; this compares against the shared constant from
 * `@unvibe/shared`, never the message text.
 */
import { READER_STOPPED_EARLY_MESSAGE } from "@unvibe/shared";
import { RedoGuideButton } from "../shell/RedoGuideButton.js";
import { useReview } from "../state/store.js";

export function StoppedEarlyNotice({ reviewId }: { reviewId: string }): React.JSX.Element | null {
  const stoppedEarly = useReview(
    (s) =>
      [...(s.snapshot?.jobs ?? [])].reverse().find((j) => j.kind === "reader")?.degradedReason ===
      READER_STOPPED_EARLY_MESSAGE,
  );
  if (!stoppedEarly) return null;
  return (
    <p className="hint" data-testid="reader-stopped-early">
      {READER_STOPPED_EARLY_MESSAGE} <RedoGuideButton reviewId={reviewId} />
    </p>
  );
}
