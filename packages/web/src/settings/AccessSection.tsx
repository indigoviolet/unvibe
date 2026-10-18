/**
 * Agent access (issue #160): the full-access opt-in. Off by default; the
 * review helper stays read-only until the warning below is acknowledged.
 * Enabling sends the acknowledgement timestamp with the update (the
 * service refuses without it); turning it off clears the acknowledgement,
 * so turning it on again asks again.
 */
import { useState } from "react";
import type { Settings } from "@unvibe/shared";
import { FULL_ACCESS_WARNING } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";

export function AccessSection({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: (next: Settings) => void;
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const on = settings.fullAccess === true;

  const save = async (patch: Partial<Settings>): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.saveSettings(patch));
      setConfirming(false);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Agent access">
      <h2>Agent access</h2>
      {on ? (
        <>
          <p data-testid="access-state">
            <strong>Full access is on.</strong> The review helper can run shell commands, git, and gh
            as you, and fetch pages from the web. The limits in the review instructions are requests
            it is asked to follow, not enforced rules.
          </p>
          <p className="hint">
            Only keep this on for code you trust. Turning it off clears the acknowledgement: turning
            it on again asks again.
          </p>
          <p className="hint">Automatic hunk summaries always run locked down.</p>
          <button
            className="btn"
            type="button"
            disabled={saving}
            onClick={() => void save({ fullAccess: false })}
          >
            Turn off full access
          </button>
        </>
      ) : (
        <>
          <p data-testid="access-state">
            <strong>Read-only.</strong> The review helper can read files and look up review details.
            It cannot run commands, use git or gh, reach the web, or change files.
          </p>
          {!confirming ? (
            <button className="btn" type="button" disabled={saving} onClick={() => setConfirming(true)}>
              Turn on full access…
            </button>
          ) : (
            <div className="card" data-testid="access-warning" style={{ padding: "4px 14px" }}>
              <p>{FULL_ACCESS_WARNING}</p>
              <div className="frow" style={{ gap: 8 }}>
                <span className="sp" />
                <button className="btn ghost" type="button" disabled={saving} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    void save({ fullAccess: true, fullAccessAcknowledgedAt: Date.now() })
                  }
                >
                  I understand, turn on full access
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {error ? (
        <p className="err" role="alert">
          Couldn&apos;t save: {error}
        </p>
      ) : null}
    </section>
  );
}
