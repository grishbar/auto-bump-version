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
  const branch = options.branch ?? 'develop';
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
    expect(result.stdout).toContain('1.0.0 → 1.0.1');
    expect(readVersion(workDir)).toBe('1.0.1');
    expect(git(workDir, ['diff', '--cached', '--name-only']).trim()).toBe('package.json');
  });

  test('is a no-op when version is already ahead of origin', () => {
    const { workDir } = createFixture({ originVersion: '1.0.0', localVersion: '1.0.1' });
    const before = fs.readFileSync(path.join(workDir, 'package.json'), 'utf-8');
    const result = runCli(workDir);

    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(workDir, 'package.json'), 'utf-8')).toBe(before);
    expect(git(workDir, ['diff', '--cached', '--name-only']).trim()).toBe('');
  });

  test('exits 1 when version is behind origin without --post-rebase', () => {
    const { workDir } = createFixture({ originVersion: '1.0.1', localVersion: '1.0.0' });
    const result = runCli(workDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is less than origin/develop');
    expect(readVersion(workDir)).toBe('1.0.0');
  });

  test('--check-only does not write package.json', () => {
    const { workDir } = createFixture({ originVersion: '1.0.0' });
    const before = fs.readFileSync(path.join(workDir, 'package.json'), 'utf-8');
    const result = runCli(workDir, ['--check-only']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('version OK');
    expect(fs.readFileSync(path.join(workDir, 'package.json'), 'utf-8')).toBe(before);
  });

  test('skips when REBASE_HEAD is present', () => {
    const { workDir } = createFixture({ originVersion: '1.0.0' });
    const gitDir = git(workDir, ['rev-parse', '--git-dir']).trim();
    fs.writeFileSync(path.join(workDir, gitDir, 'REBASE_HEAD'), 'dummy\n');
    const result = runCli(workDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('skip (rebase or cherry-pick in progress)');
    expect(readVersion(workDir)).toBe('1.0.0');
  });

  test('exits 1 when --check-only and --post-rebase are used together', () => {
    const { workDir } = createFixture({ originVersion: '1.0.0' });
    const result = runCli(workDir, ['--check-only', '--post-rebase']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--check-only and --post-rebase cannot be used together');
  });
});
