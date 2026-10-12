export type { Updater } from "./updater.js";
export {
  FakeUpdater,
  RealUpdaterPlaceholder,
  createUpdaterFromEnv,
  defaultFakeChannels,
  fakeFailMode,
  isNotWiredError,
  loadFakeSpecs,
  notWiredError,
  type FakeChannelSpec,
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
export { bundleDir, fakeBuildInfo, resolveBuildInfo, type BuildInfoInputs } from "./build-info.js";
export {
  describeHealth,
  healthMatchesTarget,
  runSwitchFlow,
  type HelperArgs,
  type HelperDeps,
  type ObservedHealth,
  type SwitchPlan,
} from "./helper.js";
