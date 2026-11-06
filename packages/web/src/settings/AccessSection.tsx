/**
 * Agent access (issue #160): the full-access opt-in. Off by default; the
 * review helper stays read-only until the switch is confirmed inline.
 * Enabling sends the acknowledgement timestamp with the update (the
 * service refuses without it); turning it off clears the
 * acknowledgement, so turning it on again asks again.
 *
 * The enable step is the shared inline confirm (#346: "Confirm full
 * access" ✓ ✕) with one short line for what it means; the full warning
 * lives in the button's tooltip and the pill's accessible description,
 * never as a visible paragraph.
 */
import { useState } from "react";
import type { Settings } from "@unvibe/shared";
import { FULL_ACCESS_WARNING } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { InlineConfirm } from "../ui/index.js";

/** The one short visible line for what enabling means (#346 follow-up). */
const ACCESS_SHORT_LINE = "The review helper can run shell commands, git and gh as you, and reach the web.";

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

  /** Enabling runs inside the inline confirm: a rejection stays in the pill. */
  const enable = async (): Promise<void> => {
    setSaving(true);
    try {
      onSaved(await api.saveSettings({ fullAccess: true, fullAccessAcknowledgedAt: Date.now() }));
    } finally {
      setSaving(false);
    }
  };

  /** Turning off is the safe direction: direct, with the error below. */
  const disable = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.saveSettings({ fullAccess: false }));
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
            className="ui-btn" data-variant="primary"
            type="button"
            disabled={saving}
            onClick={() => void disable()}
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
          <div className="frow" style={{ gap: 8 }}>
            {/* #346: the shared inline confirm (was Turn on/Cancel + the full warning). */}
            <InlineConfirm
              action="Turn on full access"
              confirmAction="full access"
              runningLabel="Turning on…"
              danger
              placement="stack"
              disabled={saving}
              open={confirming}
              onOpenChange={setConfirming}
              onConfirm={enable}
              formatError={friendlyError}
              detail={ACCESS_SHORT_LINE}
              announce={`${FULL_ACCESS_WARNING} Confirm full access, or cancel.`}
              testId="access-warning"
              title={FULL_ACCESS_WARNING}
            />
          </div>
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
