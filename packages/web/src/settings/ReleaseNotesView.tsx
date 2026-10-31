/**
 * Release-notes renderer (#330): plain text plus links only. Issue text
 * is never injected as HTML — every string renders as a React text node.
 */
import type { ReleaseNotes } from "@unvibe/shared";

export function ReleaseNotesView({ notes }: { notes: ReleaseNotes }): React.JSX.Element {
  return (
    <div data-testid="release-notes-view">
      <p className="hint">
        {notes.channel} · {notes.version}
        {notes.previousVersion ? ` · since ${notes.previousVersion}` : ""}
        {notes.dataResetNeeded ? " · data reset needed" : ""}
      </p>
      {notes.items.length === 0 ? <p className="hint">No changes listed.</p> : null}
      <ul style={{ margin: "6px 0", paddingLeft: 18 }}>
        {notes.items.map((item) => (
          <li key={item.number} style={{ marginBottom: 8 }}>
            <a href={item.url} target="_blank" rel="noreferrer">
              #{item.number}
            </a>{" "}
            <span>{item.summary}</span>
            {item.whatChanged ? (
              <div>
                <span className="hint">What changed: </span>
                <span>{item.whatChanged}</span>
              </div>
            ) : null}
            {item.whatToTry ? (
              <div>
                <span className="hint">What to try: </span>
                <span>{item.whatToTry}</span>
              </div>
            ) : null}
            {item.caveats ? (
              <div>
                <span className="hint">Caveats: </span>
                <span>{item.caveats}</span>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
