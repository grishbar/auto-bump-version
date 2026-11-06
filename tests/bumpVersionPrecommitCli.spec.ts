import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';

const cliPath = fileURLToPath(new URL('../src/bumpVersionPrecommitCli.ts', import.meta.url));
const tsxBin = path.resolve('node_modules/.bin/tsx');
const fixtures: string[] = [];

afterEach(() => {
  for (const dir of fixtures.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${result.stderr}\n${result.stdout}`);
  }
  return result.stdout;
}

function writePkg(dir: string, version: string): void {
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify({ name: 'host-app', version }, null, 2)}\n`
  );
}

function readVersion(dir: string): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')) as {
    version: string;
  };
  return pkg.version;
}

function createFixture(options: {
  originVersion: string;
  localVersion?: string;
  branch?: string;
}): { root: string; workDir: string } {
  const branch = options.branch ?? 'main';
  const tmpRoot = path.join(fileURLToPath(new URL('.', import.meta.url)), '.tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(tmpRoot, 'auto-bump-'));
  fixtures.push(root);

  const originDir = path.join(root, 'origin.git');
  const workDir = path.join(root, 'work');
  fs.mkdirSync(originDir);
  fs.mkdirSync(workDir);

  git(originDir, ['init', '--bare', '--template=']);
  git(workDir, ['init', '-b', branch, '--template=']);
  git(workDir, ['config', 'user.email', 'test@example.com']);
  git(workDir, ['config', 'user.name', 'Test']);
  writePkg(workDir, options.originVersion);
  git(workDir, ['add', 'package.json']);
  git(workDir, ['commit', '-m', 'init']);
  git(workDir, ['remote', 'add', 'origin', originDir]);
  git(workDir, ['push', '-u', 'origin', branch]);

  if (options.localVersion != null && options.localVersion !== options.originVersion) {
    writePkg(workDir, options.localVersion);
    git(workDir, ['add', 'package.json']);
  }

  return { root, workDir };
}

function runCli(
  cwd: string,
  args: string[] = [],
  env: NodeJS.ProcessEnv = {}
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(tsxBin, [cliPath, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe('bumpVersionPrecommit CLI', () => {
  test('bumps patch and stages package.json when version equals origin', () => {
    const { workDir } = createFixture({ originVersion: '1.0.0' });
    const result = runCli(workDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Bumped package.json 1.0.0 → 1.0.1');
    expect(readVersion(workDir)).toBe('1.0.1');
    expect(git(workDir, ['diff', '--cached', '--name-only']).trim()).toBe('package.json');
  });

  test('is a no-op when version is already ahead of origin', () => {
    const { workDir } = createFixture({ originVersion: '1.0.0', localVersion: '1.0.1' });
    const before = fs.readFileSync(path.join(workDir, 'package.json'), 'utf-8');
    const result = runCli(workDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Nothing to do');
    expect(fs.readFileSync(path.join(workDir, 'package.json'), 'utf-8')).toBe(before);
    expect(git(workDir, ['diff', '--cached', '--name-only']).trim()).toBe('package.json');
  });

  test('exits 1 when version is behind origin without --post-rebase', () => {
    const { workDir } = createFixture({ originVersion: '1.0.1', localVersion: '1.0.0' });
    const result = runCli(workDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is behind origin/main');
    expect(readVersion(workDir)).toBe('1.0.0');
  });

  test('--check-only does not write package.json', () => {
    const { workDir } = createFixture({ originVersion: '1.0.0' });
    const before = fs.readFileSync(path.join(workDir, 'package.json'), 'utf-8');
    const result = runCli(workDir, ['--check-only']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Version looks good');
    expect(fs.readFileSync(path.join(workDir, 'package.json'), 'utf-8')).toBe(before);
  });

  test('skips when REBASE_HEAD is present', () => {
    const { workDir } = createFixture({ originVersion: '1.0.0' });
    const gitDir = git(workDir, ['rev-parse', '--git-dir']).trim();
    fs.writeFileSync(path.join(workDir, gitDir, 'REBASE_HEAD'), 'dummy\n');
    const result = runCli(workDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Skipping the version bump because a rebase or cherry-pick is in progress');
    expect(readVersion(workDir)).toBe('1.0.0');
  });

  test('exits 1 when --check-only and --post-rebase are used together', () => {
    const { workDir } = createFixture({ originVersion: '1.0.0' });
    const result = runCli(workDir, ['--check-only', '--post-rebase']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Cannot run --check-only and --post-rebase together');
  });

  test('uses the staged version and preserves unstaged fields', () => {
    const { workDir } = createFixture({ originVersion: '1.0.0' });
    fs.writeFileSync(path.join(workDir, 'package.json'), JSON.stringify({ version: '9.0.0', private: true }));
    expect(runCli(workDir).status).toBe(0);
    const indexed = JSON.parse(git(workDir, ['show', ':package.json']));
    expect(indexed.version).toBe('1.0.1');
    expect(indexed.private).toBeUndefined();
    expect(readVersion(workDir)).toBe('9.0.0');
  });

  test('skips cherry-pick even when the staged version is behind', () => {
    const { workDir } = createFixture({ originVersion: '2.0.0', localVersion: '1.0.0' });
    fs.writeFileSync(path.join(workDir, '.git', 'CHERRY_PICK_HEAD'), 'dummy');
    expect(runCli(workDir).status).toBe(0);
    expect(readVersion(workDir)).toBe('1.0.0');
  });

  test('post-rebase amends HEAD despite rebase markers and preserves staged edits', () => {
    const { workDir } = createFixture({ originVersion: '1.0.0' });
    fs.mkdirSync(path.join(workDir, '.git', 'rebase-merge'));
    fs.writeFileSync(path.join(workDir, 'extra.txt'), 'pending');
    git(workDir, ['add', 'extra.txt']);
    fs.writeFileSync(path.join(workDir, 'package.json'), JSON.stringify({ name: 'host-app', version: '1.0.0', private: true }));
    git(workDir, ['add', 'package.json']);
    const result = runCli(workDir, ['--post-rebase']);
    expect(result.status, result.stderr).toBe(0);
    const committed = JSON.parse(git(workDir, ['show', 'HEAD:package.json']));
    expect(committed.version).toBe('1.0.1');
    expect(committed.private).toBeUndefined();
    expect(git(workDir, ['ls-tree', '--name-only', 'HEAD'])).not.toContain('extra.txt');
    expect(JSON.parse(git(workDir, ['show', ':package.json'])).private).toBe(true);
    expect(git(workDir, ['diff', '--cached', '--name-only'])).toContain('extra.txt');
    expect(git(workDir, ['log', '-1', '--format=%s']).trim()).toBe('init');
  });

  test('a real rebase automatically bumps the last commit through post-rewrite', () => {
    const { workDir } = createFixture({ originVersion: '1.0.0' });
    git(workDir, ['checkout', '-b', 'feature']);
    fs.writeFileSync(path.join(workDir, 'feature.txt'), 'feature');
    git(workDir, ['add', 'feature.txt']);
    git(workDir, ['commit', '-m', 'feature']);
    git(workDir, ['checkout', 'main']);
    writePkg(workDir, '1.0.1');
    git(workDir, ['add', 'package.json']);
    git(workDir, ['commit', '-m', 'base update']);
    git(workDir, ['push', 'origin', 'main']);
    git(workDir, ['checkout', 'feature']);
    const hooks = path.join(workDir, '.git', 'hooks');
    fs.mkdirSync(hooks, { recursive: true });
    fs.writeFileSync(path.join(hooks, 'post-rewrite'),
      `#!/bin/sh\nif [ "$1" = rebase ]; then\n  "${tsxBin}" "${cliPath}" --post-rebase\nfi\n`, { mode: 0o755 });
    git(workDir, ['rebase', 'main']);
    expect(JSON.parse(git(workDir, ['show', 'HEAD:package.json'])).version).toBe('1.0.2');
    expect(git(workDir, ['log', '-1', '--format=%s']).trim()).toBe('feature');
    expect(git(workDir, ['status', '--porcelain']).trim()).toBe('');
  });

  test('init --yes writes Husky hooks for main', () => {
    const { workDir } = createFixture({ originVersion: '1.0.0' });
    const result = runCli(workDir, ['init', '--yes']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Using base branch: main');
    expect(result.stdout).toContain('Wrote .husky/pre-commit');
    expect(fs.readFileSync(path.join(workDir, '.husky/pre-commit'), 'utf-8')).toContain(
      "--base-branch 'main'"
    );
    expect(fs.readFileSync(path.join(workDir, '.husky/post-rewrite'), 'utf-8')).toContain(
      '--post-rebase'
    );
    expect(fs.existsSync(path.join(workDir, '.github/workflows/check-version.yml'))).toBe(true);
  });

  test('init --base-branch records the chosen branch', () => {
    const { workDir } = createFixture({ originVersion: '1.0.0' });
    const result = runCli(workDir, ['init', '--yes', '--base-branch', 'develop']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Using base branch: develop');
    expect(fs.readFileSync(path.join(workDir, '.husky/pre-commit'), 'utf-8')).toContain(
      "--base-branch 'develop'"
    );
  });
});
