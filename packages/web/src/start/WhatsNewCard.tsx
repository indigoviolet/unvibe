/**
 * "What's new in <version>" card (#330): shown once on the start page
 * after a successful switch to a build that shipped notes. Dismissal is
 * remembered per version in localStorage; no polling.
 */
import { useEffect, useState } from "react";
import type { ReleaseNotes } from "@unvibe/shared";
import { api } from "../api/client.js";
import { Button, Card } from "../ui/index.js";
import { ReleaseNotesView } from "../settings/ReleaseNotesView.js";

export const WHATS_NEW_DISMISSED_KEY = "unvibe.whatsnew.dismissed";

export function readDismissedVersion(): string | null {
  try {
    return localStorage.getItem(WHATS_NEW_DISMISSED_KEY);
  } catch {
    return null;
  }
}

export function WhatsNewCard(): React.JSX.Element | null {
  const [notes, setNotes] = useState<ReleaseNotes | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [status, res] = await Promise.all([api.updateStatus(), api.releaseNotes()]);
        if (cancelled || !res.notes) return;
        // Only after an update: a recorded successful switch onto this build.
        if (!status.outcome || status.outcome.status !== "ok") return;
        if (!status.build || status.build.version !== res.notes.version) return;
        if (readDismissedVersion() === res.notes.version) return;
        setNotes(res.notes);
      } catch {
        // No notes / no updater: the card stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!notes || dismissed) return null;
  return (
    <Card variant="raised">
      <div data-testid="whats-new-card" style={{ padding: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <strong>What&apos;s new in {notes.version}</strong>
          <Button
            variant="quiet"
            size="sm"
            type="button"
            data-testid="whats-new-dismiss"
            onClick={() => {
              try {
                localStorage.setItem(WHATS_NEW_DISMISSED_KEY, notes.version);
              } catch {
                // Remembering is best effort; hide for this page load.
              }
              setDismissed(true);
            }}
          >
            Dismiss
          </Button>
        </div>
        <ReleaseNotesView notes={notes} />
      </div>
    </Card>
  );
}
