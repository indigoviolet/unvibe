/**
 * Update-channel helpers shared by service and web (issue #356).
 *
 * Lives in its own module (not the barrel) so the update switch helper
 * — which must stay dependency-lean (see the helper-bundle containment
 * test) — can import it without dragging the whole shared barrel into
 * `dist/update-helper.js`. The barrel re-exports these for convenience;
 * service code on size-sensitive paths imports `@unvibe/shared/channels`
 * directly.
 */

/**
 * A debug flavour of a channel: `release-debug`, or
 * `preview/<slug>-debug` for previews. Debug builds ship the
 * OpenTelemetry dependencies and can record performance traces.
 * Switching flavours is an ordinary channel switch.
 */
export function isDebugChannel(ref: string): boolean {
  return ref === "release-debug" || (ref.startsWith("preview/") && ref.endsWith("-debug"));
}

/**
 * Debug-flavour ref for a channel (issue #356): lean `release`
 * installs `release-debug`, lean `preview/x` installs `preview/x-debug`.
 * Already-debug channels map to themselves; unknown channels fall back
 * to `release-debug`.
 */
export function debugChannelFor(channel: string | null): string {
  if (typeof channel === "string" && channel !== "" && isDebugChannel(channel)) return channel;
  if (typeof channel === "string" && channel.startsWith("preview/")) return `${channel}-debug`;
  return "release-debug";
}
