/**
 * Extension version stamping (issue #350), kept in its own
 * dependency-free module so vitest can import it directly
 * (`packages/service/test/extension-version-350.test.ts`) and so both
 * `scripts/release.mjs` and `scripts/global-install-check.mjs` share the
 * one rule.
 *
 * Chrome accepts only 1–4 dot-separated integers, each 0–65535, as the
 * manifest `version`. Unvibe versions are `X.Y.Z` (releases) or
 * `X.Y.Z-preview.<slug>.<sha>` (previews; see `preview-lib.mjs`).
 *
 * Derivation rule (deterministic):
 * - release `X.Y.Z`            -> `version` = `X.Y.Z`, `version_name` = full string.
 * - any prerelease `X.Y.Z-...` -> `version` = `X.Y.Z.N`, `version_name` = full string,
 *   where N = FNV-1a-32(full version string) mod 65534 + 1 (range 1–65535).
 *   N >= 1 sorts above the base release (a missing fourth part compares
 *   as 0), and distinct version strings almost surely map to distinct N.
 *   It is deterministic but not monotonic across previews — ordering
 *   previews against each other was not required; telling any build apart
 *   on chrome://extensions was.
 */

/** `true` when `v` is a valid Chrome extension `version` (1–4 ints, each 0–65535, no leading zeros). */
export function isChromeExtensionVersion(v) {
  const parts = String(v ?? "").split(".");
  if (parts.length < 1 || parts.length > 4) return false;
  return parts.every((p) => /^(0|[1-9]\d*)$/.test(p) && Number(p) <= 65535);
}

/** FNV-1a 32-bit hash, unsigned. */
export function fnv1a32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Derive the manifest `{ version, version_name }` from an Unvibe version
 * string (`X.Y.Z` with optional `-prerelease`). Throws on anything else.
 */
export function extensionVersion(unvibeVersion) {
  const m = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/.exec(String(unvibeVersion ?? ""));
  if (!m) throw new Error(`bad Unvibe version ${JSON.stringify(unvibeVersion)} — want X.Y.Z with optional prerelease`);
  const [, x, y, z, pre] = m;
  for (const part of [x, y, z]) {
    if (Number(part) > 65535) throw new Error(`version part out of Chrome range: ${JSON.stringify(unvibeVersion)}`);
  }
  const base = `${Number(x)}.${Number(y)}.${Number(z)}`;
  if (!pre) return { version: base, version_name: String(unvibeVersion) };
  const n = (fnv1a32(String(unvibeVersion)) % 65534) + 1;
  return { version: `${base}.${n}`, version_name: String(unvibeVersion) };
}
