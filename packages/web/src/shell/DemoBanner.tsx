/**
 * Demo banner (issue #341): a slim one-line bar above the guide on every
 * demo review page — the in-app replay demo and the static demo alike.
 * It says what the demo is, that answers are replayed and nothing is
 * posted, and links the install page. On the static site it also carries
 * the Reset demo control.
 */
import { useEffect, useState } from "react";
import { DEMO_INSTALL_URL, STATIC_DEMO, resetStaticDemo } from "../demo.js";
import { api } from "../api/client.js";

export function DemoBanner({ reviewId }: { reviewId: string }): React.JSX.Element | null {
  // The demo id lives on the summary (`demo`); the snapshot carries the
  // fixture's repo path — prefer the summary, like the toolbar does.
  const [isDemo, setIsDemo] = useState<boolean>(STATIC_DEMO);
  useEffect(() => {
    let cancelled = false;
    api
      .reviews()
      .then((rs) => {
        if (!cancelled) setIsDemo(rs.reviews.some((r) => r.id === reviewId && r.repoId === "demo"));
      })
      .catch(() => {
        if (!cancelled) setIsDemo(STATIC_DEMO);
      });
    return () => {
      cancelled = true;
    };
  }, [reviewId]);
  if (!isDemo) return null;
  return (
    <div className="demo-banner" role="note" data-testid="demo-banner">
      <span className="demo-banner-text">
        Demo: a recorded Unvibe review of urllib3#5020. Answers are replayed, not live, and nothing is posted to
        GitHub. <a href={DEMO_INSTALL_URL}>Install Unvibe</a> to review your own PRs.
      </span>
      {STATIC_DEMO ? (
        <button type="button" className="ui-btn" data-variant="quiet" data-size="sm" onClick={resetStaticDemo}>
          Reset demo
        </button>
      ) : null}
    </div>
  );
}
