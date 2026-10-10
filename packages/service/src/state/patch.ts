/**
 * Immer patches → RFC 6902 ops (the WS `patch` event shape in
 * `packages/shared/src/api.ts`).
 *
 * `ReviewStore.mutate` runs the recipe through immer's
 * `produceWithPatches` and converts each patch `{op, path, value?}` to a
 * `StatePatchOp` with an RFC 6901 JSON-Pointer path. Array indices are
 * positional (immer emits numeric segments; the web store splices them),
 * so ops must be applied in order — which the bus preserves per review.
 */
import type { Patch } from "immer";
import type { StatePatchOp } from "@unvibe/shared";

function escapeSegment(seg: string | number): string {
  return String(seg).replace(/~/g, "~0").replace(/\//g, "~1");
}

export function pointerFromPath(path: ReadonlyArray<string | number>): string {
  return `/${path.map(escapeSegment).join("/")}`;
}

/** Convert immer patches to WS-ready RFC 6902 ops. Pure. */
export function immerPatchesToOps(patches: Patch[]): StatePatchOp[] {
  return patches.map((p) => {
    const path = pointerFromPath(p.path);
    switch (p.op) {
      case "add":
        return { op: "add", path, value: p.value };
      case "remove":
        return { op: "remove", path };
      case "replace":
        return { op: "replace", path, value: p.value };
    }
  });
}
