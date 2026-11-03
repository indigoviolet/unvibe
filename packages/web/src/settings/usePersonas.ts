/**
 * Enabled personas for the guide (issue #349 step 2).
 *
 * Card toolbars (the persona dropdown + version tabs) and thread avatars
 * all need the same list; one module-cached fetch serves every card on
 * the page. Mock mode answers from the step-1 fixture personas; the
 * service answers from settings. Persona colours are the fixed,
 * colour-blind-safe sequence — colour is never the only signal (names
 * ride with every dot).
 */
import { useEffect, useState } from "react";
import type { Persona } from "@unvibe/shared";
import { api } from "../api/client.js";

let cached: Persona[] | null = null;
let inflight: Promise<Persona[]> | null = null;

function load(): Promise<Persona[]> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = api
      .settings()
      .then((s) => {
        cached = (s.personas ?? []).filter((p) => p.enabled);
        return cached;
      })
      .catch(() => [] as Persona[])
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Enabled personas (empty while loading or when the backend has none). */
export function useEnabledPersonas(): Persona[] {
  const [personas, setPersonas] = useState<Persona[]>(cached ?? []);
  useEffect(() => {
    let cancelled = false;
    if (!cached) {
      void load().then((list) => {
        if (!cancelled) setPersonas(list);
      });
    }
    return () => {
      cancelled = true;
    };
  }, []);
  return personas;
}

/** Test seam: reset the module cache between tests. */
export function resetPersonasCache(): void {
  cached = null;
}
