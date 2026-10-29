/**
 * Version section (Settings → Version, issue #36 step 2, layout #73,
 * toggle meaning #231): the version picker. Releases are always listed
 * and switchable; the `versionPickerEnabled` checkbox ("Show previews")
 * gates preview channels only. The card shows one aligned row per
 * version (name · short commit · built · action) under a
 * Versions/Refresh header, the installed channel marked by its Installed
 * badge, and the last switch outcome at the bottom. Switch asks for
 * confirmation inside the row itself (the
 * service restarts; switching keeps your database and backs it up first).
 *
 * Switching survives the service going away: after the 202 the page polls
 * health + status until the new build reports (then reloads) or the
 * helper records a rollback (then the reason shows in place). Every
 * successful listing feeds the top-bar update check (#231), so it
 * refreshes without a reload.
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
import { compareDataFormat, dataFormatResetWarning } from "@unvibe/shared";
import { downloadOutboxMarkdown } from "../data-format/outboxDownload.js";
import { noteChannelsForUpdateCheck } from "../shell/updateCheck.js";
import { putErrors } from "./LimitsSection.js";
import { Badge, Button, Card, Checkbox, ListRow } from "../ui/index.js";
import { blockedJobLine, channelRowMiddle, channelRowState, isNewerAvailable, outcomeLine, sortVersionsByRecency, timeAgoIso } from "./versionFormat.js";

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
    async (build: UpdateBuildInfo | null, refresh?: boolean): Promise<void> => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await api.updateChannels(refresh);
        if (!cancelled.current) {
          setChannels(res.channels);
          setError(null);
          // The top-bar update check (#231) follows this listing.
          noteChannelsForUpdateCheck(build, res.channels);
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
      // Releases are always listed (#231), regardless of the toggle.
      if (!cancelled.current) void loadChannels(st?.build ?? null);
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
      // Releases stay listed either way; the toggle only hides/shows previews (#231).
      void loadChannels(st?.build ?? null);
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
      // #311: the confirm panel already showed the reset warning for a
      // format-changing target; say so on the switch so the service
      // does not refuse it. The service re-checks either way.
      const targetChannel = channels?.find((c) => c.ref === ref);
      const acceptDataReset =
        compareDataFormat(status?.build?.dataFormat ?? 1, targetChannel?.dataFormat) === "changed";
      try {
        const res = await api.updateSwitch(ref, force ? true : undefined, acceptDataReset ? true : undefined);
        if (res.unchanged) {
          if (!cancelled.current) {
            setSwitchingTo(null);
            setDoneNote(`Already on the latest build of ${ref}`);
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
  // row shares the same columns. The installed channel is marked by its
  // Installed badge in the list (#246: no separate Installed line).
  const rows = channels ? sortVersionsByRecency(channels) : null;

  return (
    <section aria-label="Version" id="version" style={{ scrollMarginTop: 12 }}>
      {/* No title here: the Settings tab names the section (#61). */}
      <Card variant="raised">
        <div className="ver-toggle">
          <Checkbox
            id="version-picker-toggle"
            testId="version-picker-toggle"
            ariaLabel="Show previews"
            checked={enabled}
            disabled={toggling}
            onChange={() => void toggle()}
          />
          <label htmlFor="version-picker-toggle">Show previews</label>
        </div>
        {error ? (
          <p className="err" role="alert">
            Couldn&apos;t load version info: {error}
          </p>
        ) : null}
        {status && !status.build ? (
          <p className="warnline" data-testid="update-not-installed">
            Switching only works when Unvibe was installed with npm. This service runs from a source checkout or an older build, so you can only list channels here. To switch, run <code>unvibe update</code> in a terminal.
          </p>
        ) : null}
        {loading && !channels ? <p className="hint">Loading channels…</p> : null}
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
            onRefresh={() => void loadChannels(status?.build ?? null, true)}
            refreshing={refreshing}
          />
        ) : null}
        {status?.pending && !switchingTo ? (
          <p className="warnline" data-testid="update-pending">
            A switch to {status.pending.to} is in progress (started {timeAgoIso(status.pending.startedAt) ?? "recently"}
            ).{" "}
            <Button variant="secondary" size="sm" type="button" onClick={() => {
              const to = status.pending?.to;
              if (!to) return;
              const target = channels?.find((c) => c.ref === to)?.version ?? null;
              setSwitchError(null);
              setSwitchingTo(to);
              void waitForSwitch(to, target, status.build?.version ?? healthVersion, status.pending?.startedAt ?? new Date().toISOString());
            }}>
              Wait for it
            </Button>
          </p>
        ) : null}
        {switchingTo ? (
          <p className="warnline" role="status" data-testid="update-switching">
            Switching to {switchingTo}… The service is restarting. This page reloads when it is back.
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
      </Card>
    </section>
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
    <div className="ver-list ui-list">
      <div className="ver-listhead">
        <span className="hint">Channels</span>
        <Button variant="secondary" size="sm" type="button" disabled={refreshing} onClick={onRefresh} data-testid="update-refresh">
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
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
 * One version as a shared ListRow (name · sha/built · action slot). The
 * note — the confirm warning, the jobs refusal — renders below the row
 * inside the list, so it never touches the next row.
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
  const rowState = channelRowState(c, build);
  const confirming = confirmRef === c.ref;
  const isBlocked = blocked?.ref === c.ref;
  const verb = newerAvailable ? "update" : "switch";
  const built = c.builtAt ? (timeAgoIso(c.builtAt) ?? c.builtAt) : null;
  const trailing = (
    <>
      {rowState === "installed" ? (
        <span data-testid="update-current"><Badge tone="ok">Installed</Badge></span>
      ) : rowState === "update-available" ? (
        <span data-testid="update-available"><Badge tone="warn">Update available</Badge></span>
      ) : switchingTo ? (
        <span className="hint">…</span>
      ) : null}
      {confirming ? (
        <>
          <Button variant="primary" size="sm" type="button" aria-label={`Confirm ${verb} to ${c.ref}`} onClick={() => onConfirm(c.ref)}>
            Confirm
          </Button>
          <Button variant="secondary" size="sm" type="button" aria-label={`Cancel ${verb} to ${c.ref}`} onClick={onCancel}>
            Cancel
          </Button>
        </>
      ) : newerAvailable && build && c.current && !switchingTo ? (
        <Button variant="secondary" size="sm" type="button" aria-label={`Update ${c.ref}`} onClick={() => onSwitch(c.ref)}>
          Update
        </Button>
      ) : !c.current && !switchingTo && !isBlocked ? (
        <Button variant="secondary" size="sm" type="button" aria-label={`Switch to ${c.ref}`} onClick={() => onSwitch(c.ref)}>
          Switch
        </Button>
      ) : null}
    </>
  );
  return (
    <>
      <ListRow
        data-testid="update-channel"
        data-ref={c.ref}
        primary={
          <>
            <code className="ver-name" title={c.version ?? c.ref}>
              {c.ref}
            </code>
            {" · "}
            <span className="ver-sha" title={c.kind === "release" && c.version ? c.version : (c.commit ?? undefined)}>{channelRowMiddle(c)}</span>
            {" · "}
            <span className="ver-built">{built ? `built ${built}` : "—"}</span>
          </>
        }
        trailing={trailing}
      />
      {confirming ? (
        <ConfirmNote channel={c} build={build} verb={verb} />
      ) : isBlocked && blocked ? (
        <div className="ver-note">
          <BlockedPanel blocked={blocked} onForceConfirm={onForceConfirm} onCancel={onCancel} />
        </div>
      ) : null}
    </>
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
        from the review afterwards. Interrupted jobs stay with this channel&apos;s data — switch back to
        resume or retry them.
      </span>
      {blocked.jobs.length > 0 ? (
        <span className="hint" data-testid="update-blocked-jobs">
          {blocked.jobs.map((j) => blockedJobLine(j)).join(" · ")}
          {more > 0 ? ` · +${more} more` : ""}
        </span>
      ) : null}
      {/* Buttons stay together on one line when the panel wraps. */}
      <span style={{ display: "inline-flex", gap: 6 }}>
        <Button variant="primary" size="sm" type="button" onClick={() => onForceConfirm(blocked.ref)}>
          Switch anyway
        </Button>
        <Button
          variant="secondary" size="sm"
          type="button"
          aria-label={`Cancel switch to ${blocked.ref}`}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </span>
    </span>
  );
}

/**
 * Switch confirmation (#311): a target whose data format differs gets
 * the reset warning and an Export Outbox first button; anything else
 * keeps the plain restart note.
 */
function ConfirmNote({
  channel,
  build,
  verb,
}: {
  channel: UpdateChannel;
  build: UpdateBuildInfo | null;
  verb: string;
}): React.JSX.Element {
  const [exported, setExported] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const changed = compareDataFormat(build?.dataFormat ?? 1, channel.dataFormat) === "changed";
  if (!changed) {
    return <p className="ver-note warnline">The service restarts. Your data is kept and backed up first.</p>;
  }
  return (
    <div className="ver-note" data-testid="update-data-reset-warning">
      <p className="warnline" style={{ margin: "0 0 6px" }}>
        {dataFormatResetWarning(build?.dataFormat ?? 1, channel.dataFormat ?? 0)} The service restarts on the
        new build, which will ask for that reset before it can open.
      </p>
      <span className="frow" style={{ gap: 6, alignItems: "center" }}>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={exporting}
          onClick={() => {
            setExporting(true);
            void api
              .dataFormatOutbox()
              .then((out) => {
                downloadOutboxMarkdown(out.markdown);
                setExported(out.count);
              })
              .catch(() => setExported(-1))
              .finally(() => setExporting(false));
          }}
        >
          {exporting ? "Exporting…" : "Export Outbox first"}
        </Button>
        {exported !== null && exported >= 0 ? (
          <span className="hint">Exported {exported} draft{exported === 1 ? "" : "s"}.</span>
        ) : exported !== null ? (
          <span className="hint">Couldn&apos;t export — open the app and copy the Outbox instead.</span>
        ) : null}
        <span className="hint">Then Confirm to {verb} anyway, or Cancel.</span>
      </span>
    </div>
  );
}
