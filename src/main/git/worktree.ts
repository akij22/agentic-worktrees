import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { getEnvConfig } from '../config/env';
import type { Repository } from '../../shared/db/schema';

export const sanitizeBranchName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/\/+/g, '/');

export const getRepoSourcePath = (repo: Repository): string => {
  const config = getEnvConfig();
  return path.join(
    config.workspaceRoot,
    repo.ownerLogin,
    `${repo.name}.git`,
  );
};

const getWorktreeRootPath = (repo: Repository): string => {
  const config = getEnvConfig();
  return path.join(
    config.workspaceRoot,
    repo.ownerLogin,
    `${repo.name}.worktrees`,
  );
};

const ensureDirFor = (filePath: string): void => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  if (!existsSync(path.dirname(filePath))) {
    throw new Error(`Cannot create directory for path: ${filePath}`);
  }
};

export const ensureClone = async (repo: Repository): Promise<string> => {
  if (repo.localRootPath && existsSync(repo.localRootPath)) {
    if (repo.githubRepoId < 0) {
      return repo.localRootPath;
    }
    const git = simpleGit(repo.localRootPath);
    await git.fetch(['origin', '--prune']);
    return repo.localRootPath;
  }

  const targetPath = getRepoSourcePath(repo);
  ensureDirFor(targetPath);

  await simpleGit().clone(repo.cloneUrl, targetPath, ['--bare']);

  return targetPath;
};

export interface CreatedWorktree {
  sourcePath: string;
  path: string;
  branchName: string;
  baseBranchName: string | null;
  headCommitSha: string | null;
}

export const createWorktreeFromBranch = async (
  repo: Repository,
  baseBranch: string,
  newBranchName: string,
  worktreeName: string,
): Promise<CreatedWorktree> => {
  const sourcePath = await ensureClone(repo);
  const git: SimpleGit = simpleGit(sourcePath);

  const worktreeRoot = getWorktreeRootPath(repo);
  const worktreePath = path.join(worktreeRoot, sanitizeBranchName(worktreeName));
  ensureDirFor(worktreePath);

  if (repo.githubRepoId < 0) {
    await git.raw(['worktree', 'add', '-b', newBranchName, worktreePath, baseBranch]);
  } else {
    await git.raw(['fetch', 'origin', baseBranch]);
    await git.raw([
      'worktree',
      'add',
      '-b',
      newBranchName,
      worktreePath,
      `origin/${baseBranch}`,
    ]);
  }

  let headCommitSha: string | null = null;
  try {
    headCommitSha = (await git.revparse([`refs/heads/${newBranchName}`])).trim();
  } catch {
    headCommitSha = null;
  }

  return {
    sourcePath,
    path: worktreePath,
    branchName: newBranchName,
    baseBranchName: baseBranch,
    headCommitSha,
  };
};
