/**
 * `auto-bump-version init` — write Husky hooks and remember the base branch.
 */

import fs from 'fs';
import path from 'path';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { DEFAULT_BASE_BRANCH, parseBumpVersionCliArgs } from './bumpVersionPrecommit.js';

export type InitCliFlags = {
  yes: boolean;
  baseBranch: string | undefined;
};

export function parseInitCliArgs(argv: string[]): InitCliFlags {
  const yes = argv.includes('--yes') || argv.includes('-y');
  const { baseBranch } = parseBumpVersionCliArgs(argv);
  return { yes, baseBranch };
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function huskyPreCommitScript(baseBranch: string): string {
  return `#!/usr/bin/env sh
npx auto-bump-version --base-branch ${shellSingleQuote(baseBranch)}
`;
}

export function huskyPostRewriteScript(baseBranch: string): string {
  return `#!/usr/bin/env sh
if [ "$1" = "rebase" ]; then
  npx auto-bump-version --post-rebase --base-branch ${shellSingleQuote(baseBranch)}
fi
`;
}

export async function promptDefaultBranch(options: {
  defaultBranch?: string;
  provided?: string;
  yes?: boolean;
  isTty?: boolean;
  ask?: (question: string) => Promise<string>;
}): Promise<string> {
  const fallback = options.defaultBranch ?? DEFAULT_BASE_BRANCH;
  const fromCli = options.provided?.trim();
  if (fromCli) return fromCli;
  if (options.yes || !options.isTty) return fallback;

  const question = `Default git branch to compare against [${fallback}]: `;
  const ask =
    options.ask ??
    (async (q: string) => {
      const rl = readline.createInterface({ input, output });
      try {
        return await rl.question(q);
      } finally {
        rl.close();
      }
    });
  const answer = (await ask(question)).trim();
  return answer || fallback;
}

export type InitWriteResult = {
  written: string[];
  skipped: string[];
};

export function writeInitFiles(projectRoot: string, baseBranch: string): InitWriteResult {
  const huskyDir = path.join(projectRoot, '.husky');
  fs.mkdirSync(huskyDir, { recursive: true });

  const files: { rel: string; contents: string }[] = [
    { rel: path.join('.husky', 'pre-commit'), contents: huskyPreCommitScript(baseBranch) },
    { rel: path.join('.husky', 'post-rewrite'), contents: huskyPostRewriteScript(baseBranch) },
  ];

  const written: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const abs = path.join(projectRoot, file.rel);
    if (fs.existsSync(abs)) {
      skipped.push(file.rel);
      continue;
    }
    fs.writeFileSync(abs, file.contents, { encoding: 'utf-8', mode: 0o755 });
    written.push(file.rel);
  }

  return { written, skipped };
}

export async function runInit(argv: string[], options: { projectRoot: string; isTty?: boolean } ): Promise<void> {
  const flags = parseInitCliArgs(argv);
  const baseBranch = await promptDefaultBranch({
    provided: flags.baseBranch,
    yes: flags.yes,
    isTty: options.isTty ?? Boolean(process.stdin.isTTY),
  });

  const { written, skipped } = writeInitFiles(options.projectRoot, baseBranch);

  console.log(`Using base branch: ${baseBranch}`);
  for (const rel of written) {
    console.log(`Wrote ${rel}`);
  }
  for (const rel of skipped) {
    console.log(`Skipped ${rel} (already exists)`);
  }
  console.log('If Husky is not installed yet: npm i -D husky && npx husky');
}
