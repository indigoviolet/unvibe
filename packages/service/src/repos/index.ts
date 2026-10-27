export { RepoStore, newRepoId } from "./store.js";
export {
  deriveIdentity,
  detectCheckouts,
  hasGitDir,
  isGitCheckout,
  parseGitHubRemote,
  remoteUrl,
  resolveRepoRoots,
  type DetectedCheckout,
} from "./detect.js";
export { repoChanges, type ChangesDeps, type ChangesOptions } from "./changes.js";
export { listWorktrees, resolveContextRepo } from "./worktrees.js";
export { pickFolder, type PickFolderOptions } from "./pick-folder.js";
export {
  addManagedRepo,
  assertManagedPath,
  CloneError,
  cloneArgv,
  cloneTargetState,
  ensureManagedClone,
  isPathInside,
  managedRepoDir,
  managedReposRoot,
  MANAGED_FETCH_FAIL_BACKOFF_MS,
  MANAGED_FETCH_FRESH_MS,
  MANAGED_FETCH_TIMEOUT_MS,
  mapCloneError,
  refreshManagedCheckout,
  removeRepo,
  resetManagedCloneStateForTests,
  type AddDeps,
  type CloneDeps,
  type RemovableRepos,
  type TargetState,
} from "./managed.js";
