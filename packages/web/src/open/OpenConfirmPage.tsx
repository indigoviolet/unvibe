/**
 * In-app confirm page for plain `/open?pr=…` links (#335).
 *
 * `GET /open` never mutates (any site can link to it and the token cookie
 * rides along), so a PR with no review yet redirects here instead of
 * starting one. The page renders inside the normal app frame — same top
 * bar and styling as the start page — and its Start button POSTs to
 * `/open` from the app origin (same protection as the app's other
 * mutations), then navigates to the review. The extension button never
 * lands here: the worker opens `/review/<id>` directly.
 */
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { parseOpenPrUrl } from "@unvibe/shared";
import { friendlyError, getToken } from "../api/client.js";
import { ScreenTopBar } from "../shell/ScreenTopBar.js";
import { Button } from "../ui/index.js";

export function OpenConfirmPage(): React.JSX.Element {
  const [params] = useSearchParams();
  const raw = params.get("pr") ?? "";
  let parsed = null;
  let parseError: string | null = null;
  try {
    parsed = parseOpenPrUrl(raw);
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (!parsed) return;
    setStarting(true);
    setError(null);
    try {
      const token = getToken();
      // Same-origin: the token cookie rides along too, so this works
      // even when localStorage holds no token yet (plain-link arrival).
      const res = await fetch("/open", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: new URLSearchParams({ pr: parsed.url }).toString(),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`POST /open: ${res.status} ${body}`);
      }
      // The service answers 303 to the review; fetch follows it, so the
      // final URL is the review itself.
      window.location.assign(res.url);
    } catch (err) {
      setStarting(false);
      setError(`Couldn't start the review: ${friendlyError(err)}`);
    }
  };

  const name = parsed ? `${parsed.owner}/${parsed.name}#${parsed.prNumber}` : null;

  return (
    <div className="app start">
      <ScreenTopBar showBadge />
      <main className="col" style={{ padding: 24 }}>
        <div className="doc" style={{ maxWidth: 720 }} data-testid="open-confirm">
          {parsed && name ? (
            <>
              <h1>Review {name} in Unvibe?</h1>
              <p>
                This will start a new review of this pull request in Unvibe. If Unvibe doesn&apos;t have{" "}
                {parsed.owner}/{parsed.name} yet, it clones that repo into its own storage first. Opening a
                review runs the guide pipeline, which can use agent tokens.
              </p>
              <div className="frow" style={{ gap: 8, alignItems: "center" }}>
                <Button
                  variant="primary"
                  type="button"
                  onClick={() => void start()}
                  disabled={starting}
                  data-testid="open-confirm-start"
                >
                  {starting ? "Starting…" : "Start review"}
                </Button>
                <Link className="ib bd" to="/">
                  Cancel
                </Link>
              </div>
              {error ? (
                <p className="hint" role="alert" style={{ marginTop: 12 }}>
                  {error}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <h1>Can&apos;t open that link</h1>
              <p>{parseError ?? "Missing pr: expected /open?pr=https://github.com/owner/name/pull/123."}</p>
              <div className="frow" style={{ gap: 8, alignItems: "center" }}>
                <Link className="ib bd" to="/">
                  Back to the start page
                </Link>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
