#!/usr/bin/env node

/**
 * Pre-commit: ensure package.json version is not less than origin/<base> (default develop).
 * Override the base with `--base-branch <name>` (or `--base-branch=<name>`).
 * If it equals origin, bumps patch and stages package.json.
 * Always reads the baseline from origin/<branch> only (not the local branch tip).
 *
 * Suffix after "-" is allowed on the MR side (e.g. 14.2.1-fix vs 14.2.1 on develop) — not treated as older.
 *
 * Local pre-commit skips entirely during rebase / cherry-pick so `--continue` is not blocked
 * when the in-progress commit still has a version below origin/develop.
 *
 * After rebase: run with --post-rebase (Husky `.husky/post-rewrite`, only when "$1" is rebase).
 * If version is equal to or behind origin, bumps to origin patch+1 and amends HEAD
 * (`git commit --amend --no-edit --no-verify`). Skip the hook when "$1" is amend to avoid a loop.
 *
 * CI: run with --check-only (uses --base-branch if set, else CI_MERGE_REQUEST_TARGET_BRANCH_NAME; shallow fetch).
 * Local pre-commit: full fetch (no --depth=1) so the repo stays non-shallow.
 *
 * Resolves the host package from process.cwd() (nearest package.json upward), so the script works when
 * installed under node_modules. Override with BUMP_VERSION_PROJECT_ROOT or VERSION_CHECK_ROOT if needed.
 */

import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  isRebaseOrCherryPickInProgress,
  nextVersionAgainstOrigin,
  parseBumpVersionCliArgs,
  resolveBaseBranch,
} from './bumpVersionPrecommit.js';

const { checkOnly: CHECK_ONLY, postRebase: POST_REBASE, baseBranch: CLI_BASE_BRANCH } =
  parseBumpVersionCliArgs(process.argv.slice(2));

function resolveHostProjectRoot(): string {
  const fromEnv = process.env.BUMP_VERSION_PROJECT_ROOT ?? process.env.VERSION_CHECK_ROOT;
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  let dir = path.resolve(process.cwd());
  const root = path.parse(dir).root;
  while (dir !== root) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error(
    'bump-version-precommit: package.json not found (walk up from process.cwd() or set BUMP_VERSION_PROJECT_ROOT)'
  );
}

/** Path to package.json as in `git show ref:<path>` (posix, relative to repo root). */
function packageJsonPathInGitRepo(projectRoot: string): string {
  const gitRoot = execSync('git rev-parse --show-toplevel', {
    encoding: 'utf-8',
    cwd: projectRoot,
  }).trim();
  const absPkg = path.join(projectRoot, 'package.json');
  const rel = path.relative(gitRoot, absPkg);
  if (rel.startsWith('..')) {
    throw new Error('bump-version-precommit: package.json is outside the git repository');
  }
  return rel.split(path.sep).join('/');
}

function resolveCliBaseBranch(): string {
  return resolveBaseBranch({
    cliBranch: CLI_BASE_BRANCH,
    checkOnly: CHECK_ONLY,
    ciTargetBranch: process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME,
    envBaseBranch: process.env.VERSION_CHECK_BASE_BRANCH,
  });
}

function tryFetchOriginBranch(branch: string, cwd: string): void {
  // --depth=1 only in CI (--check-only): on dev machines it would shallow the whole repo
  const fetchArgs = ['fetch', 'origin', branch, ...(CHECK_ONLY ? ['--depth=1'] : [])];
  // Failures are intentionally ignored: offline or no remote means use last fetched origin/<branch>.
  spawnSync('git', fetchArgs, {
    cwd,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
}

/** Skip version gate during rebase/cherry-pick so git `--continue` can finish. */
function shouldSkipForRebaseOrCherryPick(cwd: string): boolean {
  try {
    const gitDirRaw = execSync('git rev-parse --git-dir', {
      encoding: 'utf-8',
      cwd,
    }).trim();
    const gitDir = path.resolve(cwd, gitDirRaw);
    return isRebaseOrCherryPickInProgress((marker) => fs.existsSync(path.join(gitDir, marker)));
  } catch {
    return false;
  }
}

function getOriginBranchPackageVersion(branch: string, projectRoot: string, packageJsonGitPath: string): string | null {
  const ref = `origin/${branch}`;
  try {
    const out = execSync(`git show ${ref}:${packageJsonGitPath}`, {
      encoding: 'utf-8',
      cwd: projectRoot,
    });
    const data = JSON.parse(out) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

type PackageJson = Record<string, unknown> & { version?: string };

function amendHeadWithStagedVersion(cwd: string): void {
  const amendResult = spawnSync('git', ['commit', '--amend', '--no-edit', '--no-verify'], {
    cwd,
    stdio: 'inherit',
  });
  if (amendResult.status !== 0) {
    process.exit(1);
  }
}

function main(): void {
  if (CHECK_ONLY && POST_REBASE) {
    console.error('bump-version-precommit: --check-only and --post-rebase cannot be used together');
    process.exit(1);
  }

  const rootDir = resolveHostProjectRoot();
  const packagePath = path.join(rootDir, 'package.json');
  const pkgGitPath = packageJsonPathInGitRepo(rootDir);

  // Local pre-commit / post-rebase: do not run while rebase/cherry-pick is still in progress.
  // CI --check-only must still enforce the version constraint.
  if (!CHECK_ONLY && shouldSkipForRebaseOrCherryPick(rootDir)) {
    console.log('bump-version-precommit: skip (rebase or cherry-pick in progress)');
    process.exit(0);
  }

  const baseBranch = resolveCliBaseBranch();
  tryFetchOriginBranch(baseBranch, rootDir);

  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8')) as PackageJson;
  const currentVersion = pkg.version;
  if (!currentVersion) process.exit(0);

  const originVersion = getOriginBranchPackageVersion(baseBranch, rootDir, pkgGitPath);
  if (originVersion == null) {
    console.error(
      `bump-version-precommit: could not read version from origin/${baseBranch} (fetch and try again)`
    );
    process.exit(1);
  }

  const decision = nextVersionAgainstOrigin(currentVersion, originVersion);
  if (decision == null) {
    console.error(
      'bump-version-precommit: invalid version (expected N.N.N or N.N.N-suffix):',
      currentVersion,
      'vs',
      originVersion
    );
    process.exit(1);
  }

  const { cmp, next: newVersion } = decision;

  if (cmp < 0 && !POST_REBASE) {
    console.error(
      `bump-version-precommit: package.json version ${currentVersion} is less than origin/${baseBranch} (${originVersion}). Rebase or bump the version.`
    );
    process.exit(1);
  }

  if (CHECK_ONLY) {
    console.log(
      `bump-version-precommit: version OK (${currentVersion} >= ${originVersion} on origin/${baseBranch})`
    );
    process.exit(0);
  }

  if (cmp > 0) {
    process.exit(0);
  }

  pkg.version = newVersion;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8');
  const reason = cmp < 0 ? `was behind origin/${baseBranch}` : `matched origin/${baseBranch}`;
  console.log(`bump-version-precommit: ${currentVersion} → ${newVersion} (${reason})`);

  const addResult = spawnSync('git', ['add', packagePath], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  if (addResult.status !== 0) {
    process.exit(1);
  }

  if (POST_REBASE) {
    amendHeadWithStagedVersion(rootDir);
  }

  process.exit(0);
}

main();
