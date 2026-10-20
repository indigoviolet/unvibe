/**
 * Placeholder where agent-started content will land (issue #46): a dashed
 * card with a plain dots + fixed-label indicator. Replaced by the real
 * content when it arrives through a patch. Never streamed text.
 */
import { Card } from "../ui/index.js";

export function WorkingPlaceholder({ label }: { label: string }) {
  return (
    <Card as="section" variant="plain" className="child placeholder" aria-busy="true">
      <div className="working" role="status">
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>{label}</span>
      </div>
    </Card>
  );
}
