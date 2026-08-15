/**
 * Pure version helpers for bumpVersionPrecommit (imported by CLI and tests).
 */

export const DEFAULT_BASE_BRANCH = 'main';

export type BumpVersionCliFlags = {
  checkOnly: boolean;
  postRebase: boolean;
  /** Explicit `--base-branch`; undefined means use the default / CI env fallback. */
  baseBranch: string | undefined;
};

/**
 * Parse argv after node/script (`process.argv.slice(2)`).
 * Supports `--check-only`, `--post-rebase`, `--base-branch <name>` and `--base-branch=<name>`.
 */
export function parseBumpVersionCliArgs(argv: string[]): BumpVersionCliFlags {
  const checkOnly = argv.includes('--check-only');
  const postRebase = argv.includes('--post-rebase');
  let baseBranch: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--base-branch') {
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        baseBranch = next;
        i += 1;
      }
      continue;
    }
    if (arg.startsWith('--base-branch=')) {
      baseBranch = arg.slice('--base-branch='.length);
    }
  }

  const trimmed = baseBranch?.trim();
  return { checkOnly, postRebase, baseBranch: trimmed || undefined };
}

/**
 * Branch to compare against: CLI `--base-branch` wins, then CI env in `--check-only`, else `main`.
 */
export function resolveBaseBranch(options: {
  cliBranch?: string | null;
  checkOnly?: boolean;
  ciTargetBranch?: string | null;
  githubBaseBranch?: string | null;
  envBaseBranch?: string | null;
} = {}): string {
  const fromCli = options.cliBranch?.trim();
  if (fromCli) return fromCli;

  if (options.checkOnly) {
    const fromCi = options.ciTargetBranch?.trim();
    if (fromCi) return fromCi;
    const fromGithub = options.githubBaseBranch?.trim();
    if (fromGithub) return fromGithub;
    const fromEnv = options.envBaseBranch?.trim();
    if (fromEnv) return fromEnv;
  }

  return DEFAULT_BASE_BRANCH;
}

/** Marker names under `.git` that mean rebase or cherry-pick is in progress. */
export const GIT_REBASE_OR_CHERRY_PICK_MARKERS = [
  'CHERRY_PICK_HEAD',
  'REBASE_HEAD',
  'rebase-merge',
  'rebase-apply',
] as const;

/**
 * True when a rebase or cherry-pick is in progress (so pre-commit must not block `--continue`).
 * `markerExists` should check paths under the repo's git dir (e.g. `fs.existsSync(path.join(gitDir, name))`).
 */
export function isRebaseOrCherryPickInProgress(markerExists: (marker: string) => boolean): boolean {
  return GIT_REBASE_OR_CHERRY_PICK_MARKERS.some((marker) => markerExists(marker));
}

export type ParsedProjectVersion = {
  parts: number[];
  suffix: string | null;
};

export function parseProjectVersion(v: string): ParsedProjectVersion | null {
  const m = String(v).match(/^(\d+(?:\.\d+)*)(?:-(.+))?$/);
  if (!m) return null;
  const parts = m[1].split('.').map((x) => Number(x));
  if (parts.some((n) => Number.isNaN(n))) return null;
  return { parts, suffix: m[2] ?? null };
}

export function compareVersionForMinConstraint(
  current: string,
  origin: string
): -1 | 0 | 1 | null {
  const a = parseProjectVersion(current);
  const b = parseProjectVersion(origin);
  if (!a || !b) return null;

  const len = Math.max(a.parts.length, b.parts.length);
  for (let i = 0; i < len; i++) {
    const na = a.parts[i] ?? 0;
    const nb = b.parts[i] ?? 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }

  const sa = a.suffix;
  const sb = b.suffix;
  if (sa == null && sb == null) return 0;
  if (sa != null && sb == null) return 1;
  if (sa == null && sb != null) return 1;
  if (sa === sb) return 0;
  return sa!.localeCompare(sb!, undefined, { numeric: true, sensitivity: 'base' }) < 0 ? -1 : 1;
}

export function bumpPatch(version: string): string | null {
  const parsed = parseProjectVersion(version);
  if (!parsed) return null;
  const { parts, suffix } = parsed;
  const last = parts[parts.length - 1];
  if (Number.isNaN(last)) return null;
  parts[parts.length - 1] = last + 1;
  const base = parts.join('.');
  return suffix != null ? `${base}-${suffix}` : base;
}

export type VersionAgainstOrigin = {
  cmp: -1 | 0 | 1;
  /** Current version when already ahead; otherwise origin patch+1 (keeps the MR suffix). */
  next: string;
};

/**
 * Version to write so it is strictly greater than origin.
 * Equal → bump current (keeps suffix). Behind → origin patch+1 with current suffix.
 */
export function nextVersionAgainstOrigin(current: string, origin: string): VersionAgainstOrigin | null {
  const cmp = compareVersionForMinConstraint(current, origin);
  if (cmp === null) return null;
  if (cmp > 0) return { cmp, next: current };
  if (cmp === 0) {
    const next = bumpPatch(current);
    return next ? { cmp, next } : null;
  }

  const originParsed = parseProjectVersion(origin);
  const currentParsed = parseProjectVersion(current);
  if (!originParsed || !currentParsed) return null;
  const parts = [...originParsed.parts];
  parts[parts.length - 1] += 1;
  const base = parts.join('.');
  const next = currentParsed.suffix != null ? `${base}-${currentParsed.suffix}` : base;
  return { cmp, next };
}
