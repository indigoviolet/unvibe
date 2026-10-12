export type { Updater } from "./updater.js";
export {
  FakeUpdater,
  RealUpdater,
  createUpdaterFromEnv,
  defaultFakeChannels,
  fakeFailMode,
  loadFakeSpecs,
  type FakeChannelSpec,
  type RealUpdaterOptions,
  type UpdaterFromEnvOptions,
} from "./updater.js";
export {
  clearPendingSwitch,
  currentRefPath,
  fakeChannelsPath,
  hasAnySubmitLease,
  isSwitchPending,
  outcomePath,
  pendingPath,
  readCurrentRef,
  readPendingSwitch,
  readSwitchOutcome,
  updateDir,
  writeCurrentRef,
  writePendingSwitch,
  writeSwitchOutcome,
} from "./state.js";
export { fakeBuildInfo, resolveBuildInfo, type BuildInfoInputs } from "./build-info.js";
export {
  describeHealth,
  healthMatchesTarget,
  runSwitchFlow,
  type HelperArgs,
  type HelperDeps,
  type ObservedHealth,
  type SwitchPlan,
} from "./helper.js";
