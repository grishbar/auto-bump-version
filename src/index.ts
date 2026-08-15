export {
  bumpPatch,
  compareVersionForMinConstraint,
  DEFAULT_BASE_BRANCH,
  GIT_REBASE_OR_CHERRY_PICK_MARKERS,
  isRebaseOrCherryPickInProgress,
  nextVersionAgainstOrigin,
  parseBumpVersionCliArgs,
  parseProjectVersion,
  resolveBaseBranch,
  type BumpVersionCliFlags,
  type ParsedProjectVersion,
  type VersionAgainstOrigin,
} from './bumpVersionPrecommit.js';
export {
  githubCheckVersionWorkflow,
  huskyPostRewriteScript,
  huskyPreCommitScript,
  parseInitCliArgs,
  promptDefaultBranch,
  writeInitFiles,
} from './bumpVersionInit.js';
