/**
 * File-key aliases for citation targets (web-guide owner).
 *
 * The urllib3#5020 fixture keeps the recordings' short citation keys
 * (`conn`, `tconn`, …; see `fixtures/urllib3-5020/meta.json`) while the
 * snapshot files carry canonical keys. Live snapshots carry no aliases.
 * The snapshot itself should eventually carry the alias map (integration
 * report); until then the mock loader provides it and live mode resolves
 * exact keys and paths only.
 */
import { MOCK_MODE } from "../mock/index.js";
import { MOCK_KEY_ALIASES } from "../mock/guide.js";

/** Active alias map: fixture aliases in mock mode, empty otherwise. */
export function activeAliases(): Record<string, string> {
  return MOCK_MODE ? { ...MOCK_KEY_ALIASES } : {};
}
