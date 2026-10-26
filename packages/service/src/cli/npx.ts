/**
 * npx guards (issue #277): `setup` and `update` (CLI and in-app) refuse
 * when the running CLI comes from an npx cache, which npm owns and can
 * delete at any time.
 *
 * Detection is from the resolved script path (`process.argv[1]` after
 * realpath): npx layouts contain a `/_npx/` segment
 * (`<npmcache>/_npx/<hash>/node_modules/unvibe/...`). Never from an env
 * var the user could miss.
 */

export const SETUP_NPX_MESSAGE =
  "You're running Unvibe from an npx cache, which npm can delete at any time, so `setup` can't register it to start at login. " +
  "Install it globally first: `npm install -g github:indigoviolet/unvibe#release`, then run `unvibe setup`.";

export const UPDATE_NPX_MESSAGE =
  "Updates need the global install (`npm install -g github:indigoviolet/unvibe#release`); this copy is running from an npx cache.";

/** True when a CLI script path points inside an npx cache. */
export function isNpxCachePath(scriptPath: string | undefined | null): boolean {
  if (!scriptPath) return false;
  const normalized = scriptPath.replace(/\\/g, "/");
  return normalized.includes("/_npx/");
}
