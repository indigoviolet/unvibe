/**
 * Tracing stub for lean web builds (issue #356, debug flavour).
 *
 * When `__UNVIBE_TRACES__` is false the build aliases every OTel
 * package (and zone.js) to this module, so the dynamic imports in
 * `beacon.ts` resolve to nothing and no tracing code ships. The beacon
 * checks the flag before importing, so this module is never really
 * loaded — it only satisfies the bundler.
 */
export {};
