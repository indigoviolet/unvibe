export {
  D2_ENV_OVERRIDE,
  D2_INSTALL_HINTS,
  compareD2Versions,
  d2InstallHint,
  d2MissingMessage,
  d2UpdateHint,
  findD2OnPath,
  meetsD2MinVersion,
  parseD2Version,
  resolveD2Bin,
  D2_MIN,
} from "./bins.js";
export type { ResolvedD2Bin } from "./bins.js";
export {
  D2_MAX_CONNECTIONS,
  D2_MAX_SHAPES,
  RESERVED_SHAPE_NAMES,
  RESERVED_SHAPE_SUFFIX,
  precheckD2Source,
  renameReservedShapeKeys,
} from "./precheck.js";
export type { PrecheckResult } from "./precheck.js";
export {
  D2_INPUT_BYTE_CAP,
  D2_MAX_CONCURRENCY,
  D2_OUTPUT_BYTE_CAP,
  D2_THEME_DARK,
  D2_THEME_LIGHT,
  D2_TIMEOUT_MS,
  checkD2Source,
  probeD2Version,
  renderD2Theme,
} from "./render.js";
export type { RenderOpts, RenderResult } from "./render.js";
export {
  ICON_ALLOW_HOST,
  ICON_FETCH_TIMEOUT_MS,
  ICON_MAX_BYTES,
  defaultFetchIcon,
  extractIconUrls,
  stageIcons,
  validateIconUrl,
} from "./icons.js";
export type { IconFetchFail, IconFetchOk, IconFetcher, IconStrip, StagedIcons } from "./icons.js";
export {
  postProcessSvg,
  rewriteCitationAnchors,
  sanitizeSvg,
  scrubStyleBlock,
  stripTokenTitles,
  namespaceIds,
} from "./sanitize.js";
export type { CitationMap, CitationRewrite } from "./sanitize.js";
export { DiagramCache, MAX_CACHED_DIAGRAMS } from "./cache.js";
export type { DiagramTheme } from "./cache.js";
export { finalizeDiagramBlock } from "./pipeline.js";
export type { FinalizeDeps, FinalizedBlock } from "./pipeline.js";
