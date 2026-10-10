/** Top bar: title, Tips, Submit review slot, Source toggle. */
import { Link } from "react-router-dom";
import { SubmitPanel } from "./SubmitPanel.js";
import { TipsButton } from "./Tips.js";

interface Props {
  title: string;
  /** Review context: settings opens as `/settings?review=:id`; submit posts it. */
  reviewId: string;
  pendingCount: number;
  sourceOpen: boolean;
  onToggleSource: () => void;
}

export function TopBar({ title, reviewId, pendingCount, sourceOpen, onToggleSource }: Props) {
  void pendingCount;
  return (
    <header className="top">
      <div className="pr">
        <b>{title}</b>
      </div>
      <span className="pill">Scaffold · stubs</span>
      <TipsButton />
      <Link className="tbtn" to={`/settings?review=${encodeURIComponent(reviewId)}`}>
        Settings
      </Link>
      <SubmitPanel reviewId={reviewId} />
      <button
        className="tbtn"
        id="toggleRight"
        type="button"
        aria-pressed={sourceOpen}
        onClick={onToggleSource}
      >
        Source
      </button>
    </header>
  );
}


