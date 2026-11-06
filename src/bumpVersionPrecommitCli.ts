#!/usr/bin/env node

/**
 * Pre-commit: ensure package.json version is not less than origin/<base> (default main).
 * Override the base with `--base-branch <name>` (or `--base-branch=<name>`).
 * If it equals origin, bumps patch and stages package.json.
 * Always reads the baseline from origin/<branch> only (not the local branch tip).
 *
 * Suffix after "-" is allowed on the MR side (e.g. 14.2.1-fix vs 14.2.1 on main) — not treated as older.
 *
 * Local pre-commit skips entirely during rebase / cherry-pick so `--continue` is not blocked
 * when the in-progress commit still has a version below origin/main.
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

import { execFileSync, execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'node:os';

import {
  isRebaseOrCherryPickInProgress,
  nextVersionAgainstOrigin,
  parseBumpVersionCliArgs,
  resolveBaseBranch,
} from './bumpVersionPrecommit.js';
import { runInit } from './bumpVersionInit.js';
import {
  msgAlreadyAhead,
  msgAmended,
  msgBehindOrigin,
  msgBumped,
  msgCheckOnlyOk,
  msgConflictingFlags,
  msgInvalidVersions,
  msgMissingOriginVersion,
  msgPackageJsonNotFound,
  msgPackageJsonOutsideGit,
  msgSkipRebaseOrCherryPick,
} from './messages.js';

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
  throw new Error(msgPackageJsonNotFound());
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
    throw new Error(msgPackageJsonOutsideGit());
  }
  return rel.split(path.sep).join('/');
}

function resolveCliBaseBranch(): string {
  return resolveBaseBranch({
    cliBranch: CLI_BASE_BRANCH,
    checkOnly: CHECK_ONLY,
    ciTargetBranch: process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME,
    githubBaseBranch: process.env.GITHUB_BASE_REF,
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

function main(): void {
  const argv = process.argv.slice(2);
  if (argv[0] === 'init') {
    const rootDir = (() => {
      try {
        return resolveHostProjectRoot();
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
      }
    })();
    void runInit(argv.slice(1), { projectRoot: rootDir }).catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
    return;
  }

  if (CHECK_ONLY && POST_REBASE) {
    console.error(msgConflictingFlags());
    process.exit(1);
  }

  const rootDir = resolveHostProjectRoot();
  const packagePath = path.join(rootDir, 'package.json');
  const pkgGitPath = packageJsonPathInGitRepo(rootDir);

  // post-rewrite runs before Git removes rebase markers; only pre-commit skips those.
  // CI --check-only must still enforce the version constraint.
  const cherryPickPath = execFileSync('git', ['rev-parse', '--git-path', 'CHERRY_PICK_HEAD'], { cwd: rootDir, encoding: 'utf-8' }).trim();
  if (!CHECK_ONLY && ((!POST_REBASE && shouldSkipForRebaseOrCherryPick(rootDir)) ||
    fs.existsSync(path.resolve(rootDir, cherryPickPath)))) {
    console.log(msgSkipRebaseOrCherryPick());
    process.exit(0);
  }

  const baseBranch = resolveCliBaseBranch();
  tryFetchOriginBranch(baseBranch, rootDir);

  const source = CHECK_ONLY ? fs.readFileSync(packagePath, 'utf-8') :
    execFileSync('git', ['show', `${POST_REBASE ? 'HEAD' : ''}:${pkgGitPath}`], { cwd: rootDir, encoding: 'utf-8' });
  const pkg = JSON.parse(source) as PackageJson;
  const currentVersion = pkg.version;
  if (!currentVersion) process.exit(0);

  const originVersion = getOriginBranchPackageVersion(baseBranch, rootDir, pkgGitPath);
  if (originVersion == null) {
    console.error(msgMissingOriginVersion(baseBranch));
    process.exit(1);
  }

  const decision = nextVersionAgainstOrigin(currentVersion, originVersion);
  if (decision == null) {
    console.error(msgInvalidVersions(currentVersion, originVersion));
    process.exit(1);
  }

  const { cmp, next: newVersion } = decision;

  if (cmp < 0 && !POST_REBASE) {
    console.error(msgBehindOrigin(currentVersion, originVersion, baseBranch));
    process.exit(1);
  }

  if (CHECK_ONLY) {
    console.log(msgCheckOnlyOk(currentVersion, originVersion, baseBranch));
    process.exit(0);
  }

  if (cmp > 0) {
    console.log(msgAlreadyAhead(currentVersion, originVersion, baseBranch));
    process.exit(0);
  }

  pkg.version = newVersion;
  const updated = `${JSON.stringify(pkg, null, 2)}\n`;
  const git = (args: string[], env = process.env, input?: string) =>
    execFileSync('git', args, { cwd: rootDir, env, input, encoding: 'utf-8' });
  const mode = git(['ls-files', '--stage', '--', pkgGitPath]).split(' ')[0];
  const blob = git(['hash-object', '-w', '--stdin'], process.env, updated).trim();
  const stage = (env: NodeJS.ProcessEnv) => git(['update-index', '--add', '--cacheinfo', mode, blob, pkgGitPath], env);

  if (POST_REBASE) {
    // Isolate the amend from anything the user has staged.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-bump-'));
    const env = { ...process.env, GIT_INDEX_FILE: path.join(tempDir, 'index') };
    try {
      git(['read-tree', 'HEAD'], env);
      stage(env);
      git(['-c', 'core.hooksPath=/dev/null', 'commit', '--amend', '--no-edit', '--no-verify'], env);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    // Preserve staged edits to other package fields as well.
    const indexed = JSON.parse(git(['show', `:${pkgGitPath}`])) as PackageJson;
    if (indexed.version === currentVersion) {
      indexed.version = newVersion;
      const indexBlob = git(['hash-object', '-w', '--stdin'], process.env, `${JSON.stringify(indexed, null, 2)}\n`).trim();
      git(['update-index', '--cacheinfo', mode, indexBlob, pkgGitPath]);
    }
    console.log(msgAmended());
  } else {
    stage(process.env);
  }

  // Only synchronize the version in the working copy; never stage its other edits.
  try {
    const working = JSON.parse(fs.readFileSync(packagePath, 'utf-8')) as PackageJson;
    if (working.version === currentVersion) {
      working.version = newVersion;
      fs.writeFileSync(packagePath, `${JSON.stringify(working, null, 2)}\n`, 'utf-8');
    }
  } catch {
    // A deleted or temporarily invalid working copy does not affect the index.
  }
  console.log(msgBumped(currentVersion, newVersion, baseBranch, cmp < 0));

  process.exit(0);
}

main();
