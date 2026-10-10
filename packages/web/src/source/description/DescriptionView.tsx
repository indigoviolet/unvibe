/**
 * PR description slot. Owner: description agent.
 * Placeholder: author description + Restated links + author editing.
 */
export function DescriptionView({ reviewId }: { reviewId: string }) {
  return (
    <div className="desc">
      <p className="hint">Scaffold placeholder for review {reviewId} (description agent owns this).</p>
    </div>
  );
}
