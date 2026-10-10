/** Top bar: title, Tips, Submit review slot, Source toggle. */
import { Icon } from "../components/Icon.js";

interface Props {
  title: string;
  pendingCount: number;
  sourceOpen: boolean;
  onToggleSource: () => void;
}

export function TopBar({ title, pendingCount, sourceOpen, onToggleSource }: Props) {
  return (
    <header className="top">
      <div className="pr">
        <b>{title}</b>
      </div>
      <span className="pill">Scaffold · stubs</span>
      <button className="tbtn" type="button" title="Usage tips">
        Tips
      </button>
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

export function TipsButton() {
  return (
    <button className="tbtn" type="button">
      <Icon name="bulb" /> Tips
    </button>
  );
}
