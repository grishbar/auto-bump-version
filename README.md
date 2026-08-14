# auto-bump-version

[![npm version](https://img.shields.io/npm/v/auto-bump-version.svg)](https://www.npmjs.com/package/auto-bump-version)
[![CI](https://github.com/grishbar/auto-bump-version/actions/workflows/ci.yml/badge.svg)](https://github.com/grishbar/auto-bump-version/actions/workflows/ci.yml)

Pre-commit, post-rebase, and CI helper that keeps `package.json` version **not below** `origin/<base>`.

If the local version equals origin, it bumps the patch and stages `package.json`. If it is behind, the hook fails (unless you run `--post-rebase`, which jumps to origin patch+1 and amends HEAD). Baseline is always `origin/<branch>`, never the local branch tip.

This GitHub repository uses `main`. The tool’s default comparison branch is **`develop`** (override with `--base-branch`).

## Install

```bash
npm i -D auto-bump-version
```

## Husky

Pre-commit (same pattern as a typical `node …/bumpVersionPrecommitCli.js` hook):

```sh
# .husky/pre-commit
npx auto-bump-version
```

After rebase, bump and amend only when the hook argument is `rebase` (skip `amend` to avoid a loop):

```sh
# .husky/post-rewrite
if [ "$1" = "rebase" ]; then
  npx auto-bump-version --post-rebase
fi
```

## CI

```bash
npx auto-bump-version --check-only
```

`--check-only` does not write files. In GitLab MRs it uses `CI_MERGE_REQUEST_TARGET_BRANCH_NAME` when `--base-branch` is not set. Fetch is shallow (`--depth=1`) only in this mode so local clones stay non-shallow.

## Flags

| Flag | Meaning |
| --- | --- |
| `--check-only` | Verify `current >= origin`; no writes. Incompatible with `--post-rebase`. |
| `--post-rebase` | If equal or behind origin, bump to origin patch+1, stage, and `git commit --amend --no-edit --no-verify`. |
| `--base-branch <name>` | Compare against `origin/<name>` instead of `develop`. Also `--base-branch=<name>`. |

## Environment

| Variable | Meaning |
| --- | --- |
| `BUMP_VERSION_PROJECT_ROOT` | Directory that contains the host `package.json` (takes precedence). |
| `VERSION_CHECK_ROOT` | Same as `BUMP_VERSION_PROJECT_ROOT`. |
| `VERSION_CHECK_BASE_BRANCH` | Fallback base branch in `--check-only` when CLI and CI target are unset. |
| `CI_MERGE_REQUEST_TARGET_BRANCH_NAME` | GitLab MR target; used in `--check-only` after CLI `--base-branch`. |

Without those, the CLI walks up from `process.cwd()` to the nearest `package.json`, so it works when installed under `node_modules`.

## Version rules

- Accepted forms: `N.N.N` or `N.N.N-suffix` (any number of numeric segments, e.g. `1.0` or `1.2.3.4`).
- A suffix on the MR side is **not older** than the same numeric base on origin (`14.2.1-fix` > `14.2.1`).
- During rebase or cherry-pick (`REBASE_HEAD`, `CHERRY_PICK_HEAD`, `rebase-merge`, `rebase-apply`), local pre-commit / post-rebase **skip** so `git --continue` is not blocked. `--check-only` still enforces the constraint.

## Programmatic API

```ts
import {
  bumpPatch,
  compareVersionForMinConstraint,
  nextVersionAgainstOrigin,
  parseProjectVersion,
  resolveBaseBranch,
} from 'auto-bump-version';

bumpPatch('14.2.1'); // '14.2.2'
nextVersionAgainstOrigin('14.2.1', '14.2.5'); // { cmp: -1, next: '14.2.6' }
```

Also exported: `parseBumpVersionCliArgs`, `isRebaseOrCherryPickInProgress`, `DEFAULT_BASE_BRANCH`, `GIT_REBASE_OR_CHERRY_PICK_MARKERS`.

## License

MIT
