/**
 * Version section (Settings → Version, issue #36 step 2): the version
 * picker. Off by default behind `versionPickerEnabled` — when off, only
 * the toggle renders. When on: the running build, channels grouped
 * release / release-candidate / previews (source branch, short commit,
 * relative build time), refresh, and per-row Switch with an inline
 * confirm (the service restarts; data is backed up per channel).
 *
 * Switching survives the service going away: after the 202 the page polls
 * health + status until the new build reports (then reloads) or the
 * helper records a rollback (then the reason shows in place).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Settings,
  UpdateChannel,
  UpdateStatusResponse,
} from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { putErrors } from "./LimitsSection.js";
import { buildLine, groupChannels, outcomeLine, shortCommit, timeAgoIso } from "./versionFormat.js";

const SWITCH_TIMEOUT_MS = 180_000;
const SWITCH_POLL_MS = 1000;

export function VersionSection({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: (next: Settings) => void;
}): React.JSX.Element {
  const enabled = settings.versionPickerEnabled === true;
  const [status, setStatus] = useState<UpdateStatusResponse | null>(null);
  const [channels, setChannels] = useState<UpdateChannel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRef, setConfirmRef] = useState<string | null>(null);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [healthVersion, setHealthVersion] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const loadStatus = useCallback(async (): Promise<UpdateStatusResponse | null> => {
    try {
      const st = await api.updateStatus();
      if (!cancelled.current) {
        setStatus(st);
        setError(null);
      }
      return st;
    } catch (err) {
      if (!cancelled.current) setError(friendlyError(err));
      return null;
    }
  }, []);

  const loadChannels = useCallback(
    async (refresh?: boolean): Promise<void> => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await api.updateChannels(refresh);
        if (!cancelled.current) {
          setChannels(res.channels);
          setError(null);
        }
      } catch (err) {
        if (!cancelled.current) setError(friendlyError(err));
      } finally {
        if (!cancelled.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void (async () => {
      const st = await loadStatus();
      try {
        const h = await api.health();
        if (!cancelled.current) setHealthVersion(h.build?.version ?? h.version);
      } catch {
        // Status already carries the build; health is a fallback.
      }
      if ((st?.enabled ?? enabled) && !cancelled.current) void loadChannels();
    })();
  }, []);

  const toggle = useCallback(async () => {
    setToggling(true);
    setError(null);
    try {
      const next = await api.saveSettings({ versionPickerEnabled: !enabled });
      if (cancelled.current) return;
      onSaved(next);
      const st = await loadStatus();
      if (st?.enabled) void loadChannels();
      else setChannels(null);
    } catch (err) {
      if (!cancelled.current) setError(putErrors(err).join("; "));
    } finally {
      if (!cancelled.current) setToggling(false);
    }
  }, [enabled, loadChannels, loadStatus, onSaved]);

  /** Wait out a committed switch; reload on success, show the reason on rollback. */
  const waitForSwitch = useCallback(
    async (to: string, targetVersion: string | null, fromVersion: string | null, startedAt: string) => {
      const deadline = Date.now() + SWITCH_TIMEOUT_MS;
      for (;;) {
        if (cancelled.current) return;
        let seen: string | null = null;
        try {
          const h = await api.health();
          seen = h.build?.version ?? h.version;
          if (!cancelled.current) setHealthVersion(seen);
        } catch {
          // Service down mid-switch: keep waiting.
        }
        let st: UpdateStatusResponse | null = null;
        try {
          st = await api.updateStatus();
          if (!cancelled.current) setStatus(st);
        } catch {
          // Service down mid-switch: keep waiting.
        }
        if (st && !st.pending && st.outcome && st.outcome.finishedAt >= startedAt) {
          if (st.outcome.status === "ok") {
            window.location.reload();
            return;
          }
          if (!cancelled.current) setSwitchingTo(null);
          return;
        }
        const arrived =
          seen !== null && (targetVersion !== null ? seen === targetVersion : fromVersion !== null && seen !== fromVersion);
        if (arrived && st?.outcome?.status === "ok" && (st.outcome.finishedAt ?? "") >= startedAt) {
          window.location.reload();
          return;
        }
        if (Date.now() >= deadline) {
          if (!cancelled.current) {
            setSwitchingTo(null);
            setSwitchError(
              st?.pending
                ? `The switch to ${to} is still running after 3 minutes — keep this page open; it finishes on its own.`
                : `The service didn't come back within 3 minutes. Check that it is running, then reload this page.`,
            );
          }
          return;
        }
        await new Promise((r) => setTimeout(r, SWITCH_POLL_MS));
      }
    },
    [],
  );

  const commitSwitch = useCallback(
    async (ref: string) => {
      const target = channels?.find((c) => c.ref === ref)?.version ?? null;
      const fromVersion = status?.build?.version ?? healthVersion;
      const startedAt = new Date().toISOString();
      setConfirmRef(null);
      setSwitchError(null);
      setSwitchingTo(ref);
      try {
        await api.updateSwitch(ref);
      } catch (err) {
        if (!cancelled.current) {
          setSwitchingTo(null);
          setSwitchError(friendlyError(err));
        }
        return;
      }
      await waitForSwitch(ref, target, fromVersion, startedAt);
    },
    [channels, healthVersion, status, waitForSwitch],
  );

  const groups = channels ? groupChannels(channels) : null;

  return (
    <section aria-label="Version" id="version" style={{ scrollMarginTop: 12 }}>
      <div className="divider">Version</div>
      <div className="card" style={{ padding: "8px 14px" }}>
        <div className="setgrid">
          <label htmlFor="version-picker-toggle">Version picker</label>
          <div className="fld">
            <div className="frow" style={{ gap: 8, alignItems: "center" }}>
              <input
                id="version-picker-toggle"
                data-testid="version-picker-toggle"
                type="checkbox"
                checked={enabled}
                disabled={toggling}
                onChange={() => void toggle()}
              />
              <span className="hint">
                {enabled
                  ? `On — this build is ${status ? buildLine(status.build, healthVersion ?? "?") : "…"}`
                  : "Off — list preview builds and switch the installed app from here."}
              </span>
            </div>
            <span className="hint">Listing channels shells out through gh under your own login; switching restarts the service.</span>
          </div>
        </div>
        {error ? (
          <p className="err" role="alert">
            Couldn&apos;t load version info: {error}
          </p>
        ) : null}
        {!enabled ? null : loading && !channels ? (
          <p className="hint">Loading channels…</p>
        ) : channels && groups ? (
          <ChannelGroups
            groups={groups}
            confirmRef={confirmRef}
            switchingTo={switchingTo}
            onSwitch={(ref) => setConfirmRef(ref)}
            onCancel={() => setConfirmRef(null)}
            onConfirm={(ref) => void commitSwitch(ref)}
            onRefresh={() => void loadChannels(true)}
            refreshing={refreshing}
          />
        ) : null}
        {status?.pending && !switchingTo ? (
          <p className="warnline" data-testid="update-pending">
            A switch to {status.pending.to} is in progress (started {timeAgoIso(status.pending.startedAt) ?? "recently"}
            ).{" "}
            <button className="btn ghost" type="button" onClick={() => {
              const to = status.pending?.to;
              if (!to) return;
              const target = channels?.find((c) => c.ref === to)?.version ?? null;
              setSwitchError(null);
              setSwitchingTo(to);
              void waitForSwitch(to, target, status.build?.version ?? healthVersion, status.pending?.startedAt ?? new Date().toISOString());
            }}>
              Wait for it
            </button>
          </p>
        ) : null}
        {switchingTo ? (
          <p className="warnline" role="status" data-testid="update-switching">
            Switching to {switchingTo}… the service is restarting; this page reloads when the new build reports.
          </p>
        ) : null}
        {switchError ? (
          <p className="err" role="alert" data-testid="update-switch-error">
            {switchError}
          </p>
        ) : null}
        {status?.outcome && !switchingTo ? (
          <p className="hint" data-testid="update-outcome">
            Last switch: {outcomeLine(status.outcome)}
            {status.outcome.logPath ? (
              <>
                {" "}· log: <code>{status.outcome.logPath}</code>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ChannelGroups({
  groups,
  confirmRef,
  switchingTo,
  onSwitch,
  onCancel,
  onConfirm,
  onRefresh,
  refreshing,
}: {
  groups: ReturnType<typeof groupChannels>;
  confirmRef: string | null;
  switchingTo: string | null;
  onSwitch: (ref: string) => void;
  onCancel: () => void;
  onConfirm: (ref: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  const parts: { title: string; rows: UpdateChannel[] }[] = [
    { title: "Release", rows: groups.release },
    { title: "Release candidates", rows: groups.releaseRc },
    { title: "Previews", rows: groups.previews },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
      {parts.map((part) =>
        part.rows.length === 0 ? null : (
          <div key={part.title}>
            <div className="hint" style={{ marginBottom: 4 }}>{part.title}</div>
            {part.rows.map((c) => (
              <div className="frow" key={c.ref} data-testid="update-channel" data-ref={c.ref} style={{ gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <code>{c.ref}</code>
                {c.version ? <span className="hint">{c.version}</span> : null}
                {c.sourceBranch ? <span className="hint">from {c.sourceBranch}</span> : null}
                {c.commit ? (
                  <span className="hint" title={c.commit}>{shortCommit(c.commit)}</span>
                ) : null}
                {c.builtAt ? <span className="hint">built {timeAgoIso(c.builtAt) ?? c.builtAt}</span> : null}
                {c.current ? (
                  <span className="st" data-testid="update-current">current</span>
                ) : switchingTo ? (
                  <span className="hint">…</span>
                ) : confirmRef === c.ref ? (
                  <span className="frow" style={{ gap: 6, alignItems: "center" }}>
                    <span className="warnline">The service restarts; data is backed up before the switch.</span>
                    <button className="btn" type="button" onClick={() => onConfirm(c.ref)}>
                      Confirm switch to {c.ref}
                    </button>
                    <button className="btn ghost" type="button" onClick={onCancel}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button className="btn ghost" type="button" onClick={() => onSwitch(c.ref)}>
                    Switch to {c.ref}
                  </button>
                )}
              </div>
            ))}
          </div>
        ),
      )}
      <div className="frow" style={{ gap: 8 }}>
        <button className="btn ghost" type="button" disabled={refreshing} onClick={onRefresh} data-testid="update-refresh">
          {refreshing ? "Refreshing…" : "Refresh channels"}
        </button>
      </div>
    </div>
  );
}
