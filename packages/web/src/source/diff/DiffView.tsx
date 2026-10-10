/**
 * Diff slot. Owner: diff agent.
 * Placeholder: toolbar + file list + hunks per PRD §4.13.
 */
export function DiffView({ reviewId }: { reviewId: string }) {
  return (
    <div style={{ padding: "8px 12px" }}>
      <div className="dtool">
        <button className="tbtn" type="button">
          Files
        </button>
        <span className="seg" role="group" aria-label="Diff view">
          <button type="button" aria-pressed="true">
            Unified
          </button>
          <button type="button" aria-pressed="false">
            Split
          </button>
        </span>
        <button className="x" type="button" aria-pressed="true">
          ✓ Hide uninteresting
        </button>
      </div>
      <p className="hint">Scaffold placeholder for review {reviewId} (diff agent owns this).</p>
    </div>
  );
}
