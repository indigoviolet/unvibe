/**
 * Version section (Settings → Version, issue #36 step 2, layout #73):
 * the version picker. Off by default behind `versionPickerEnabled` —
 * the enable checkbox sits above the card, top right of the section
 * header. When on, the card shows the current version on top, one
 * aligned row per version (name · short commit · built · action) under
 * a Versions/Refresh header, and the last switch outcome at the bottom.
 * Switch asks for confirmation inside the row itself (the service
 * restarts; switching keeps your database and backs it up first).
 *
 * Switching survives the service going away: after the 202 the page polls
 * health + status until the new build reports (then reloads) or the
 * helper records a rollback (then the reason shows in place).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Settings,
  UpdateBlockedJob,
  UpdateBuildInfo,
  UpdateChannel,
  UpdateStatusResponse,
} from "@unvibe/shared";
import { api, friendlyError, UpdateJobsBlockedError } from "../api/client.js";
import { putErrors } from "./LimitsSection.js";
import { blockedJobLine, isNewerAvailable, outcomeLine, shortCommit, sortVersionsByRecency, timeAgoIso } from "./versionFormat.js";

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
  /**
   * Running-jobs refusal for one row (#36 follow-up): the inline panel
   * names the blocking jobs with a "Switch anyway" action (re-posts with
   * `force: true`) instead of a bare error. Replaces the generic confirm
   * for that row so the user is not asked twice for the same thing.
   */
  const [blocked, setBlocked] = useState<{
    ref: string;
    activeJobs: number;
    jobs: UpdateBlockedJob[];
  } | null>(null);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [doneNote, setDoneNote] = useState<string | null>(null);
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
    async (ref: string, force = false) => {
      const target = channels?.find((c) => c.ref === ref)?.version ?? null;
      const fromVersion = status?.build?.version ?? healthVersion;
      const startedAt = new Date().toISOString();
      setConfirmRef(null);
      setBlocked(null);
      setSwitchError(null);
      setDoneNote(null);
      setSwitchingTo(ref);
      try {
        const res = await api.updateSwitch(ref, force ? true : undefined);
        if (res.unchanged) {
          if (!cancelled.current) {
            setSwitchingTo(null);
            setDoneNote(`Already on the latest published build of ${ref} — nothing to do.`);
            void loadStatus();
          }
          return;
        }
      } catch (err) {
        if (!cancelled.current) {
          setSwitchingTo(null);
          if (err instanceof UpdateJobsBlockedError) {
            setBlocked({ ref, activeJobs: err.activeJobs, jobs: err.jobs });
          } else {
            setSwitchError(friendlyError(err));
          }
        }
        return;
      }
      await waitForSwitch(ref, target, fromVersion, startedAt);
    },
    [channels, healthVersion, loadStatus, status, waitForSwitch],
  );

  // One flat list, newest build first — no per-group blocks, so every
  // row shares the same columns.
  const rows = channels ? sortVersionsByRecency(channels) : null;
  const currentRow = rows?.find((c) => c.current) ?? null;

  return (
    <section aria-label="Version" id="version" style={{ scrollMarginTop: 12 }}>
      {/* No title here: the Settings tab names the section (#61). */}
      <div className="ver-head">
        <label
          className="ver-toggle"
          htmlFor="version-picker-toggle"
          title="Listing versions shells out through gh under your own login; switching restarts the service."
        >
          <input
            id="version-picker-toggle"
            data-testid="version-picker-toggle"
            type="checkbox"
            checked={enabled}
            disabled={toggling}
            onChange={() => void toggle()}
          />
          Enable
        </label>
      </div>
      <div className="card" style={{ padding: "8px 14px" }}>
        {error ? (
          <p className="err" role="alert">
            Couldn&apos;t load version info: {error}
          </p>
        ) : null}
        {!enabled ? (
          <p className="hint">Turn it on to list available versions and switch the installed app from here.</p>
        ) : (
          <>
            <CurrentVersion row={currentRow} build={status?.build ?? null} fallback={healthVersion} />
            {status && !status.build ? (
              <p className="warnline" data-testid="update-not-installed">
                Switching needs the installed app — this service runs from a checkout or an old build, so only
                listing works here. From the dev checkout, use <code>unvibe update</code> instead.
              </p>
            ) : null}
            {loading && !channels ? <p className="hint">Loading versions…</p> : null}
            {rows ? (
              <VersionList
                rows={rows}
                build={status?.build ?? null}
                confirmRef={confirmRef}
                blocked={blocked}
                switchingTo={switchingTo}
                onSwitch={(ref) => {
                  setBlocked(null);
                  setConfirmRef(ref);
                }}
                onCancel={() => {
                  setConfirmRef(null);
                  setBlocked(null);
                }}
                onConfirm={(ref) => void commitSwitch(ref)}
                onForceConfirm={(ref) => void commitSwitch(ref, true)}
                onRefresh={() => void loadChannels(true)}
                refreshing={refreshing}
              />
            ) : null}
          </>
        )}
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
        {doneNote && !switchingTo ? (
          <p className="hint" data-testid="update-done-note">
            {doneNote}
          </p>
        ) : null}
        {status?.outcome && !switchingTo ? (
          <p className="hint ver-outcome" data-testid="update-outcome">
            Last switch: {outcomeLine(status.outcome)}
            {status.outcome.logPath ? (
              <>
                {" "}· log: <code className="ver-logpath">{status.outcome.logPath}</code>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The running version in one line: the current row's ref when one is
 * marked, else the build version from status/health. The long version
 * string rides on the name's `title`, not as a second column.
 */
function CurrentVersion({
  row,
  build,
  fallback,
}: {
  row: UpdateChannel | null;
  build: UpdateBuildInfo | null;
  fallback: string | null;
}): React.JSX.Element | null {
  const name = row?.ref ?? build?.version ?? fallback;
  if (!name) return null;
  const sha = shortCommit(row?.commit ?? build?.commit);
  const builtAt = row?.builtAt ?? build?.builtAt;
  const built = builtAt ? (timeAgoIso(builtAt) ?? builtAt) : null;
  const branch = row?.sourceBranch ?? build?.sourceBranch;
  return (
    <p className="ver-current" data-testid="update-current-version">
      Current version:{" "}
      <code className="ver-name" title={row?.version ?? name}>
        {name}
      </code>
      {sha ? <> · {sha}</> : null}
      {built ? <> · built {built}</> : null}
      {branch ? <> · from {branch}</> : null}
    </p>
  );
}

function VersionList({
  rows,
  build,
  confirmRef,
  blocked,
  switchingTo,
  onSwitch,
  onCancel,
  onConfirm,
  onForceConfirm,
  onRefresh,
  refreshing,
}: {
  rows: UpdateChannel[];
  build: UpdateBuildInfo | null;
  confirmRef: string | null;
  blocked: { ref: string; activeJobs: number; jobs: UpdateBlockedJob[] } | null;
  switchingTo: string | null;
  onSwitch: (ref: string) => void;
  onCancel: () => void;
  onConfirm: (ref: string) => void;
  onForceConfirm: (ref: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  return (
    <div className="ver-list">
      <div className="ver-listhead">
        <span className="hint">Versions</span>
        <button className="btn ghost" type="button" disabled={refreshing} onClick={onRefresh} data-testid="update-refresh">
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {rows.map((c) => (
        <VersionRow
          key={c.ref}
          row={c}
          build={build}
          confirmRef={confirmRef}
          blocked={blocked}
          switchingTo={switchingTo}
          onSwitch={onSwitch}
          onCancel={onCancel}
          onConfirm={onConfirm}
          onForceConfirm={onForceConfirm}
        />
      ))}
    </div>
  );
}

/**
 * One version as a grid row (name · sha · built · action). The note —
 * the confirm warning, the jobs refusal, the newer-build note — spans
 * the full row width inside this row, so it never touches the next row.
 */
function VersionRow({
  row: c,
  build,
  confirmRef,
  blocked,
  switchingTo,
  onSwitch,
  onCancel,
  onConfirm,
  onForceConfirm,
}: {
  row: UpdateChannel;
  build: UpdateBuildInfo | null;
  confirmRef: string | null;
  blocked: { ref: string; activeJobs: number; jobs: UpdateBlockedJob[] } | null;
  switchingTo: string | null;
  onSwitch: (ref: string) => void;
  onCancel: () => void;
  onConfirm: (ref: string) => void;
  onForceConfirm: (ref: string) => void;
}): React.JSX.Element {
  // Publish → try → fix → publish loop: the installed commit behind the
  // published one gets an Update action (same switch flow, from === to,
  // no DB swap).
  const newerAvailable = isNewerAvailable(c, build);
  const confirming = confirmRef === c.ref;
  const isBlocked = blocked?.ref === c.ref;
  const verb = newerAvailable ? "update" : "switch";
  const built = c.builtAt ? (timeAgoIso(c.builtAt) ?? c.builtAt) : null;
  return (
    <div className="ver-row" data-testid="update-channel" data-ref={c.ref}>
      <code className="ver-name" title={c.version ?? c.ref}>
        {c.ref}
      </code>
      <span className="ver-sha" title={c.commit ?? undefined}>
        {shortCommit(c.commit) ?? "—"}
      </span>
      <span className="ver-built">{built ? `built ${built}` : "—"}</span>
      <span className="ver-action">
        {c.current ? (
          <span className="st" data-testid="update-current">
            current
          </span>
        ) : switchingTo ? (
          <span className="hint">…</span>
        ) : null}
        {confirming ? (
          <>
            <button className="btn" type="button" aria-label={`Confirm ${verb} to ${c.ref}`} onClick={() => onConfirm(c.ref)}>
              Confirm
            </button>
            <button
              className="btn ghost"
              type="button"
              aria-label={`Cancel ${verb} to ${c.ref}`}
              onClick={onCancel}
            >
              Cancel
            </button>
          </>
        ) : newerAvailable && build && c.current && !switchingTo ? (
          <button className="btn ghost" type="button" aria-label={`Update ${c.ref}`} onClick={() => onSwitch(c.ref)}>
            Update
          </button>
        ) : !c.current && !switchingTo && !isBlocked ? (
          <button
            className="btn ghost"
            type="button"
            aria-label={`Switch to ${c.ref}`}
            onClick={() => onSwitch(c.ref)}
          >
            Switch
          </button>
        ) : null}
      </span>
      {confirming ? (
        <span className="ver-note warnline">
          The service restarts. Switching keeps your database and backs it up first.
        </span>
      ) : isBlocked && blocked ? (
        <span className="ver-note">
          <BlockedPanel blocked={blocked} onForceConfirm={onForceConfirm} onCancel={onCancel} />
        </span>
      ) : newerAvailable && build && c.current && !switchingTo ? (
        <span className="ver-note warnline" data-testid="update-available">
          Newer build available (installed {shortCommit(build.commit)} vs {shortCommit(c.commit)}
          {c.builtAt ? `, built ${timeAgoIso(c.builtAt) ?? c.builtAt}` : ""})
        </span>
      ) : null}
    </div>
  );
}

/**
 * Running-jobs refusal for one row (#36 follow-up): which jobs (up to the
 * service cap, "+N more"), what switching does to them, and "Switch
 * anyway" (re-posts with `force: true`) + Cancel. Reuses the row's
 * quiet classes; visually it sits where the generic confirm would.
 */
function BlockedPanel({
  blocked,
  onForceConfirm,
  onCancel,
}: {
  blocked: { ref: string; activeJobs: number; jobs: UpdateBlockedJob[] };
  onForceConfirm: (ref: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const more = blocked.activeJobs - blocked.jobs.length;
  return (
    <span className="frow" style={{ gap: 6, alignItems: "center" }} data-testid="update-blocked" data-ref={blocked.ref}>
      <span className="warnline">
        {blocked.activeJobs} running job{blocked.activeJobs === 1 ? "" : "s"} — switching stops{" "}
        {blocked.activeJobs === 1 ? "it" : "them"}. Stopped jobs show as interrupted; resume or retry them
        from the review afterwards. On a different version they stay with this version&apos;s data.
      </span>
      {blocked.jobs.length > 0 ? (
        <span className="hint" data-testid="update-blocked-jobs">
          {blocked.jobs.map((j) => blockedJobLine(j)).join(" · ")}
          {more > 0 ? ` · +${more} more` : ""}
        </span>
      ) : null}
      {/* Buttons stay together on one line when the panel wraps. */}
      <span style={{ display: "inline-flex", gap: 6 }}>
        <button className="btn" type="button" onClick={() => onForceConfirm(blocked.ref)}>
          Switch anyway
        </button>
        <button
          className="btn ghost"
          type="button"
          aria-label={`Cancel switch to ${blocked.ref}`}
          onClick={onCancel}
        >
          Cancel
        </button>
      </span>
    </span>
  );
}
