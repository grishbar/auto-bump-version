import {
  bumpPatch,
  compareVersionForMinConstraint,
  DEFAULT_BASE_BRANCH,
  GIT_REBASE_OR_CHERRY_PICK_MARKERS,
  isRebaseOrCherryPickInProgress,
  nextVersionAgainstOrigin,
  parseBumpVersionCliArgs,
  parseProjectVersion,
  resolveBaseBranch,
} from '../src/bumpVersionPrecommit';

describe('parseBumpVersionCliArgs', () => {
  test('defaults flags when argv is empty', () => {
    expect(parseBumpVersionCliArgs([])).toEqual({
      checkOnly: false,
      postRebase: false,
      baseBranch: undefined,
    });
  });

  test('parses --base-branch as next arg or --base-branch=value', () => {
    expect(parseBumpVersionCliArgs(['--base-branch', 'master'])).toEqual({
      checkOnly: false,
      postRebase: false,
      baseBranch: 'master',
    });
    expect(parseBumpVersionCliArgs(['--base-branch=release/1.0'])).toEqual({
      checkOnly: false,
      postRebase: false,
      baseBranch: 'release/1.0',
    });
  });

  test('ignores empty --base-branch and treats it as unset', () => {
    expect(parseBumpVersionCliArgs(['--base-branch', '--check-only']).baseBranch).toBeUndefined();
    expect(parseBumpVersionCliArgs(['--base-branch=']).baseBranch).toBeUndefined();
    expect(parseBumpVersionCliArgs(['--base-branch', '  ']).baseBranch).toBeUndefined();
  });

  test('keeps other flags alongside --base-branch', () => {
    expect(parseBumpVersionCliArgs(['--post-rebase', '--base-branch', 'main'])).toEqual({
      checkOnly: false,
      postRebase: true,
      baseBranch: 'main',
    });
  });

  test('parses --check-only', () => {
    expect(parseBumpVersionCliArgs(['--check-only'])).toEqual({
      checkOnly: true,
      postRebase: false,
      baseBranch: undefined,
    });
  });

  test('parses both --check-only and --post-rebase', () => {
    expect(parseBumpVersionCliArgs(['--check-only', '--post-rebase'])).toEqual({
      checkOnly: true,
      postRebase: true,
      baseBranch: undefined,
    });
  });

  test('ignores unknown arguments', () => {
    expect(parseBumpVersionCliArgs(['--verbose', 'extra', '--check-only'])).toEqual({
      checkOnly: true,
      postRebase: false,
      baseBranch: undefined,
    });
  });
});

describe('resolveBaseBranch', () => {
  test('defaults to develop when nothing is passed', () => {
    expect(resolveBaseBranch()).toBe(DEFAULT_BASE_BRANCH);
    expect(resolveBaseBranch({})).toBe('develop');
  });

  test('uses the explicit CLI branch when provided', () => {
    expect(resolveBaseBranch({ cliBranch: 'master' })).toBe('master');
    expect(
      resolveBaseBranch({
        cliBranch: 'main',
        checkOnly: true,
        ciTargetBranch: 'develop',
      })
    ).toBe('main');
  });

  test('in --check-only falls back to CI env then VERSION_CHECK_BASE_BRANCH', () => {
    expect(
      resolveBaseBranch({
        checkOnly: true,
        ciTargetBranch: 'release',
      })
    ).toBe('release');
    expect(
      resolveBaseBranch({
        checkOnly: true,
        envBaseBranch: 'staging',
      })
    ).toBe('staging');
  });

  test('ignores CI env outside --check-only', () => {
    expect(
      resolveBaseBranch({
        checkOnly: false,
        ciTargetBranch: 'release',
        envBaseBranch: 'staging',
      })
    ).toBe('develop');
  });
});

describe('isRebaseOrCherryPickInProgress', () => {
  test('is false when no git markers exist', () => {
    expect(isRebaseOrCherryPickInProgress(() => false)).toBe(false);
  });

  test('detects cherry-pick and rebase markers', () => {
    expect(isRebaseOrCherryPickInProgress((m) => m === 'CHERRY_PICK_HEAD')).toBe(true);
    expect(isRebaseOrCherryPickInProgress((m) => m === 'REBASE_HEAD')).toBe(true);
    expect(isRebaseOrCherryPickInProgress((m) => m === 'rebase-merge')).toBe(true);
    expect(isRebaseOrCherryPickInProgress((m) => m === 'rebase-apply')).toBe(true);
  });

  test('ignores unrelated paths', () => {
    expect(isRebaseOrCherryPickInProgress((m) => m === 'MERGE_HEAD')).toBe(false);
    expect(GIT_REBASE_OR_CHERRY_PICK_MARKERS).not.toContain('MERGE_HEAD');
  });
});

describe('parseProjectVersion', () => {
  test('parses plain and suffixed versions', () => {
    expect(parseProjectVersion('14.2.1')).toEqual({
      parts: [14, 2, 1],
      suffix: null,
    });
    expect(parseProjectVersion('14.2.1-fix')).toEqual({
      parts: [14, 2, 1],
      suffix: 'fix',
    });
    expect(parseProjectVersion('1.a.0')).toBeNull();
    expect(parseProjectVersion('v1.0.0')).toBeNull();
  });

  test('parses two- and four-part versions', () => {
    expect(parseProjectVersion('1.0')).toEqual({ parts: [1, 0], suffix: null });
    expect(parseProjectVersion('1.2.3.4')).toEqual({ parts: [1, 2, 3, 4], suffix: null });
  });

  test('rejects empty string', () => {
    expect(parseProjectVersion('')).toBeNull();
  });

  test('keeps extra dashes in the suffix', () => {
    expect(parseProjectVersion('1.0.0-fix-hotfix')).toEqual({
      parts: [1, 0, 0],
      suffix: 'fix-hotfix',
    });
  });
});

describe('compareVersionForMinConstraint', () => {
  test('orders by numeric base', () => {
    expect(compareVersionForMinConstraint('14.2.0', '14.2.1')).toBe(-1);
    expect(compareVersionForMinConstraint('14.2.2', '14.2.1')).toBe(1);
    expect(compareVersionForMinConstraint('0.14.14', '0.14.9')).toBe(1);
  });

  test('allows MR suffix when origin is plain same base (TEL-4915 follow-up)', () => {
    expect(compareVersionForMinConstraint('14.2.1-fix', '14.2.1')).toBe(1);
    expect(compareVersionForMinConstraint('14.2.1', '14.2.1')).toBe(0);
  });

  test('treats equal suffixed strings as equal', () => {
    expect(compareVersionForMinConstraint('14.2.1-fix', '14.2.1-fix')).toBe(0);
  });

  test('treats 1.0 and 1.0.0 as equal', () => {
    expect(compareVersionForMinConstraint('1.0', '1.0.0')).toBe(0);
    expect(compareVersionForMinConstraint('1.0.0', '1.0')).toBe(0);
  });

  test('treats plain current as not older than origin with a suffix', () => {
    expect(compareVersionForMinConstraint('14.2.1', '14.2.1-fix')).toBe(1);
  });

  test('orders suffixes lexicographically', () => {
    expect(compareVersionForMinConstraint('14.2.1-a', '14.2.1-b')).toBe(-1);
    expect(compareVersionForMinConstraint('14.2.1-b', '14.2.1-a')).toBe(1);
  });

  test('returns null for invalid versions', () => {
    expect(compareVersionForMinConstraint('not-a-version', '1.0.0')).toBeNull();
    expect(compareVersionForMinConstraint('1.0.0', 'v1.0.0')).toBeNull();
  });
});

describe('bumpPatch', () => {
  test('increments last numeric segment', () => {
    expect(bumpPatch('14.2.1')).toBe('14.2.2');
    expect(bumpPatch('14.2.1-fix')).toBe('14.2.2-fix');
  });

  test('returns null for invalid input', () => {
    expect(bumpPatch('not-a-version')).toBeNull();
  });
});

describe('nextVersionAgainstOrigin', () => {
  test('keeps current when already ahead of origin', () => {
    expect(nextVersionAgainstOrigin('14.2.3', '14.2.1')).toEqual({
      cmp: 1,
      next: '14.2.3',
    });
  });

  test('bumps current patch when equal to origin', () => {
    expect(nextVersionAgainstOrigin('14.2.1', '14.2.1')).toEqual({
      cmp: 0,
      next: '14.2.2',
    });
    expect(nextVersionAgainstOrigin('14.2.1-fix', '14.2.1-fix')).toEqual({
      cmp: 0,
      next: '14.2.2-fix',
    });
  });

  test('jumps to origin patch+1 when behind (post-rebase)', () => {
    expect(nextVersionAgainstOrigin('14.2.1', '14.2.5')).toEqual({
      cmp: -1,
      next: '14.2.6',
    });
    expect(nextVersionAgainstOrigin('14.2.1-fix', '14.2.5')).toEqual({
      cmp: -1,
      next: '14.2.6-fix',
    });
  });

  test('returns null for invalid input', () => {
    expect(nextVersionAgainstOrigin('not-a-version', '14.2.1')).toBeNull();
    expect(nextVersionAgainstOrigin('14.2.1', 'not-a-version')).toBeNull();
  });

  test('bumps two-part versions', () => {
    expect(nextVersionAgainstOrigin('1.0', '1.0')).toEqual({
      cmp: 0,
      next: '1.1',
    });
  });
});
