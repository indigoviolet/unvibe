/**
 * Start page (`/`): repo picker slot.
 * Owner: start-page agent. Placeholder wired into the router.
 */
import { Link } from "react-router-dom";

export function StartPage() {
  return (
    <div className="app">
      <header className="top">
        <div className="pr">
          <b>Unvibe</b>
        </div>
      </header>
      <main className="col" style={{ padding: 24 }}>
        <div className="doc">
          <h1 className="title">Open a review</h1>
          <p className="hint">
            Scaffold placeholder. The start-page agent owns this directory: repo picker, recent
            repos, PRs (authoring / review-requested), branches, previous reviews.
          </p>
          <p>
            <Link to="/review/demo">Open the demo review shell →</Link>
          </p>
          <p>
            <Link to="/settings">Settings →</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
