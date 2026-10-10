/**
 * GitHub viewer login (comments owner).
 *
 * `GET /api/viewer` is fetched once per page load and shared: the Submit
 * panel says "Submit as <user>" and the description tab applies the
 * author rule with it. `undefined` = not loaded yet, `null` = unknown
 * (gh not logged in or the endpoint 501s in old snapshots).
 */
import { useEffect, useState } from "react";
import { api } from "../api/client.js";

let cached: string | null | undefined;
let inflight: Promise<string | null> | null = null;

function load(): Promise<string | null> {
  if (cached !== undefined) {
    const login: string | null = cached;
    return Promise.resolve(login);
  }
  if (!inflight) {
    const pending: Promise<string | null> = api
      .viewer()
      .then((res) => {
        const login: string | null = res.login;
        cached = login;
        return login;
      })
      .catch(() => {
        cached = null;
        const login: string | null = null;
        return login;
      });
    inflight = pending;
    void pending.finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** Test-only: reset the module cache. */
export function resetViewerCache(): void {
  cached = undefined;
  inflight = null;
}

export function useViewer(): string | null | undefined {
  const [viewer, setViewer] = useState<string | null | undefined>(cached);
  useEffect(() => {
    let cancelled = false;
    void load().then((login) => {
      if (!cancelled) setViewer(login);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return viewer;
}
