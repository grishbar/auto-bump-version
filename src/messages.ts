/** User-facing CLI text (no internal prefix). */

export function msgConflictingFlags(): string {
  return 'Cannot run --check-only and --post-rebase together. Use one or the other.';
}

export function msgSkipRebaseOrCherryPick(): string {
  return 'Skipping the version bump because a rebase or cherry-pick is in progress.';
}

export function msgMissingOriginVersion(branch: string): string {
  return `Could not read the version from origin/${branch}. Fetch that branch and try again.`;
}

export function msgInvalidVersions(current: string, origin: string): string {
  return `Invalid version. Expected 1.2.3 or 1.2.3-suffix, got "${current}" vs "${origin}".`;
}

export function msgBehindOrigin(current: string, origin: string, branch: string): string {
  return `package.json version ${current} is behind origin/${branch} (${origin}). Rebase onto ${branch} or bump the version yourself.`;
}

export function msgCheckOnlyOk(current: string, origin: string, branch: string): string {
  return `Version looks good: ${current} is not behind ${origin} on origin/${branch}.`;
}

export function msgAlreadyAhead(current: string, origin: string, branch: string): string {
  return `Nothing to do: package.json ${current} is already ahead of origin/${branch} (${origin}).`;
}

export function msgBumped(current: string, next: string, branch: string, behind: boolean): string {
  const reason = behind
    ? `it was behind origin/${branch}`
    : `it matched origin/${branch}`;
  return `Bumped package.json ${current} → ${next} because ${reason}, and staged the file.`;
}

export function msgAmended(): string {
  return 'Amended the last commit with the new version.';
}

export function msgPackageJsonNotFound(): string {
  return 'package.json not found. Run this from your project, or set BUMP_VERSION_PROJECT_ROOT.';
}

export function msgPackageJsonOutsideGit(): string {
  return 'package.json is outside the git repository.';
}
