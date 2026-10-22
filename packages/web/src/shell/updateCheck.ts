/**
 * Top-bar update check (issue #231): the session-cached answer to "is a
 * newer release out than the running build". Checked on app load
 * (status + channels — the same listing the Version panel already
 * knows, so no new `gh` calls) and recomputed when Settings → Version
 * refreshes. No polling, no error UI: anything that cannot run resolves
 * to "no update".
 */
import type { UpdateBuildInfo, UpdateChannel } from "@unvibe/shared";
import { api } from "../api/client.js";
import { findUpdateAvailable } from "../settings/versionFormat.js";

export interface UpdateCheckState {
  checked: boolean;
  /** The release channel carrying the update, or null when up to date / unknown. */
  update: UpdateChannel | null;
}

let cached: UpdateCheckState | null = null;
let inflight: Promise<UpdateCheckState> | null = null;
const listeners = new Set<(s: UpdateCheckState) => void>();

function store(next: UpdateCheckState): UpdateCheckState {
  cached = next;
  for (const l of listeners) l(next);
  return next;
}

/**
 * Recompute from data Settings → Version already fetched (its Refresh
 * bypasses the server cache with `?refresh=1`): no extra fetch, and the
 * top bar updates without a reload. Call only on a successful listing —
 * a failed check keeps the previous answer and shows no error.
 */
export function noteChannelsForUpdateCheck(
  build: UpdateBuildInfo | null,
  channels: UpdateChannel[],
): UpdateCheckState {
  return store({ checked: true, update: findUpdateAvailable(build, channels) });
}

/** Session-cached check; failures resolve to no-update and never throw. */
export async function getUpdateAvailable(refresh = false): Promise<UpdateCheckState> {
  if (!refresh) {
    if (cached) return cached;
    if (inflight) return inflight;
  }
  const call = (async (): Promise<UpdateCheckState> => {
    try {
      const [status, res] = await Promise.all([
        api.updateStatus(),
        api.updateChannels(refresh ? true : undefined),
      ]);
      return store({ checked: true, update: findUpdateAvailable(status.build, res.channels) });
    } catch {
      // No error UI by design (#231): a check that cannot run shows nothing.
      return store({ checked: true, update: null });
    }
  })();
  if (!refresh) {
    inflight = call;
    try {
      return await call;
    } finally {
      inflight = null;
    }
  }
  return call;
}

export function subscribeUpdateCheck(listener: (s: UpdateCheckState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
