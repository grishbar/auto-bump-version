import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';

import {
  githubCheckVersionWorkflow,
  huskyPostRewriteScript,
  huskyPreCommitScript,
  parseInitCliArgs,
  promptDefaultBranch,
  writeInitFiles,
} from '../src/bumpVersionInit';

describe('parseInitCliArgs', () => {
  test('defaults to prompting', () => {
    expect(parseInitCliArgs([])).toEqual({ yes: false, baseBranch: undefined });
  });

  test('parses --yes / -y and --base-branch', () => {
    expect(parseInitCliArgs(['--yes'])).toEqual({ yes: true, baseBranch: undefined });
    expect(parseInitCliArgs(['-y', '--base-branch', 'develop'])).toEqual({
      yes: true,
      baseBranch: 'develop',
    });
  });
});

describe('promptDefaultBranch', () => {
  test('uses --base-branch when provided', async () => {
    await expect(
      promptDefaultBranch({ provided: 'develop', yes: true, isTty: true })
    ).resolves.toBe('develop');
  });

  test('uses main when --yes or stdin is not a TTY', async () => {
    await expect(promptDefaultBranch({ yes: true, isTty: true })).resolves.toBe('main');
    await expect(promptDefaultBranch({ isTty: false })).resolves.toBe('main');
  });

  test('asks and falls back to default on empty answer', async () => {
    await expect(
      promptDefaultBranch({
        isTty: true,
        ask: async () => '  master  ',
      })
    ).resolves.toBe('master');
    await expect(
      promptDefaultBranch({
        isTty: true,
        ask: async () => '',
      })
    ).resolves.toBe('main');
  });
});

describe('husky scripts', () => {
  test('embed the chosen base branch', () => {
    expect(huskyPreCommitScript('main')).toContain("--base-branch 'main'");
    expect(huskyPostRewriteScript('release/1.0')).toContain("--base-branch 'release/1.0'");
    expect(huskyPostRewriteScript('main')).toContain('--post-rebase');
  });
});

describe('githubCheckVersionWorkflow', () => {
  test('pins the chosen base branch on the reusable action', () => {
    const yaml = githubCheckVersionWorkflow('develop');
    expect(yaml).toContain('uses: grishbar/auto-bump-version@main');
    expect(yaml).toContain('base-branch: develop');
    expect(yaml).toContain('pull_request');
  });
});

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('writeInitFiles', () => {
  test('writes Husky hooks and skips existing files', () => {
    const tmpRoot = path.join(fileURLToPath(new URL('.', import.meta.url)), '.tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    const root = fs.mkdtempSync(path.join(tmpRoot, 'init-'));
    tmpDirs.push(root);

    const first = writeInitFiles(root, 'main');
    expect(first.written).toEqual([
      '.husky/pre-commit',
      '.husky/post-rewrite',
      '.github/workflows/check-version.yml',
    ]);
    expect(first.skipped).toEqual([]);
    expect(fs.readFileSync(path.join(root, '.husky/pre-commit'), 'utf-8')).toContain(
      "--base-branch 'main'"
    );
    expect(fs.readFileSync(path.join(root, '.github/workflows/check-version.yml'), 'utf-8')).toContain(
      'base-branch: main'
    );

    const second = writeInitFiles(root, 'develop');
    expect(second.written).toEqual([]);
    expect(second.skipped).toEqual([
      '.husky/pre-commit',
      '.husky/post-rewrite',
      '.github/workflows/check-version.yml',
    ]);
  });
});
