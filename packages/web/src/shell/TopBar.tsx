/** Top bar: title, Tips, Submit review slot, Source toggle. */
import { Icon } from "../components/Icon.js";
import { SubmitPanel } from "./SubmitPanel.js";

interface Props {
  title: string;
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
      <button className="tbtn" type="button" title="Usage tips">
        Tips
      </button>
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

export function TipsButton() {
  return (
    <button className="tbtn" type="button">
      <Icon name="bulb" /> Tips
    </button>
  );
}
