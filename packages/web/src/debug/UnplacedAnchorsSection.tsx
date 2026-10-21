/**
 * Unplaced anchors (issue #206): highlight passes that gave up retrying
 * record the anchors they could not place, with the reason (host block
 * not on the page, or quote not found in its host). IDs and reason
 * only — no quote text. Empty when every anchor placed.
 */
import { useUnplacedAnchors } from "../guide/unplacedAnchors.js";

export function UnplacedAnchorsSection(): React.JSX.Element {
  const unplaced = useUnplacedAnchors();
  return (
    <section data-unplaced-anchors>
      <h2>Unplaced anchors</h2>
      {unplaced.length === 0 ? (
        <p className="hint">Every anchor was placed.</p>
      ) : (
        <ul>
          {unplaced.map((u) => (
            <li key={`${u.source}:${u.id}`}>
              <code>{u.id}</code> · {u.kind} · <code>{u.host}</code> ·{" "}
              {u.reason === "host-missing" ? "host not on the page" : "quote not found in its host"} · {u.source}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
