/**
 * Static demo flags (issue #334): the in-browser demo at `unvibe.xyz/demo`.
 *
 * The demo is a mock-mode web build (`VITE_MOCK=1`) with the fixture baked
 * in (`VITE_DEMO=1`). It talks to no service: the mock answers Ask/Explain
 * from the same replay recordings the service uses, comments persist in
 * localStorage, and anything GitHub-shaped is disabled with an install
 * pointer.
 */

/** True in the static demo build only (`VITE_DEMO=1` + `VITE_MOCK=1`). */
export const STATIC_DEMO: boolean =
  typeof import.meta !== "undefined" &&
  import.meta.env?.VITE_DEMO === "1" &&
  import.meta.env?.VITE_MOCK === "1";

/** Where the demo sends people who want to ask their own questions. */
export const DEMO_INSTALL_URL = "https://unvibe.xyz/#install";

/** localStorage key for the demo's user-authored comment threads. */
export const DEMO_COMMENTS_KEY = "unvibe.demo.comments.v1";

/** Clear the demo's stored state and reload it fresh. */
export function resetStaticDemo(): void {
  try {
    localStorage.removeItem(DEMO_COMMENTS_KEY);
  } catch {
    // Private mode: reloading still resets the in-memory state.
  }
  window.location.reload();
}
