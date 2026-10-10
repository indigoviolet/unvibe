/**
 * Comments menu slot. Owner: comments agent.
 * Lists every comment; For PR filter with editable drafts; never posts.
 */
export function CommentsMenu({ reviewId }: { reviewId: string }) {
  return (
    <button className="tbtn" type="button" title={`Comments for ${reviewId}`}>
      Comments
    </button>
  );
}
