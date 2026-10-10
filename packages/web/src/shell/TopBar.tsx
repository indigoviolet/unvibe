/** Top bar: title, Tips, Submit review slot, Source toggle. */
import { Link } from "react-router-dom";
import { TipsButton } from "./Tips.js";

interface Props {
  title: string;
  pendingCount: number;
  sourceOpen: boolean;
  onToggleSource: () => void;
  /** Review context: settings opens as `/settings?review=:id`. */
  reviewId?: string;
}

export function TopBar({ title, pendingCount, sourceOpen, onToggleSource, reviewId }: Props) {
  return (
    <header className="top">
      <div className="pr">
        <b>{title}</b>
      </div>
      <span className="pill">Scaffold · stubs</span>
      <TipsButton />
      <Link className="tbtn" to={reviewId ? `/settings?review=${encodeURIComponent(reviewId)}` : "/settings"}>
        Settings
      </Link>
      <span id="submitSlot">
        <button className="tbtn" type="button">
          Submit review{pendingCount > 0 && <span className="count">{pendingCount}</span>}
        </button>
      </span>
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


