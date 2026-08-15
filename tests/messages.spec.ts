import {
  msgAlreadyAhead,
  msgBehindOrigin,
  msgBumped,
  msgCheckOnlyOk,
  msgConflictingFlags,
  msgSkipRebaseOrCherryPick,
} from '../src/messages';

describe('CLI messages', () => {
  test('explain bump, skip, and failure in plain language', () => {
    expect(msgBumped('1.0.0', '1.0.1', 'main', false)).toBe(
      'Bumped package.json 1.0.0 → 1.0.1 because it matched origin/main, and staged the file.'
    );
    expect(msgBehindOrigin('1.0.0', '1.0.5', 'main')).toContain('is behind origin/main');
    expect(msgCheckOnlyOk('1.0.1', '1.0.0', 'main')).toContain('Version looks good');
    expect(msgAlreadyAhead('1.0.2', '1.0.0', 'main')).toContain('Nothing to do');
    expect(msgSkipRebaseOrCherryPick()).toContain('rebase or cherry-pick');
    expect(msgConflictingFlags()).toContain('Use one or the other');
  });
});
