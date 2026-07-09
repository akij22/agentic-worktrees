import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { getEnvConfig } from '../config/env';
import { getInstallationAccessToken } from '../github/octokit';
import type { Repository } from '../../shared/db/schema';

const GIT_COMMAND_TIMEOUT_MS = 120_000;

const createGitClient = (
  baseDir?: string,
  installationToken?: string,
): SimpleGit => {
  const basicAuth = installationToken
    ? Buffer.from(`x-access-token:${installationToken}`).toString('base64')
    : null;
  const git = simpleGit({
    ...(baseDir ? { baseDir } : {}),
    timeout: { block: GIT_COMMAND_TIMEOUT_MS },
    // The config value is generated internally and carries the GitHub App
    // token without putting it in the command-line arguments.
    ...(basicAuth ? { unsafe: { allowUnsafeConfigEnvCount: true } } : {}),
  });

  // Electron has no terminal to display a credential prompt. Failing instead
  // of prompting prevents an IPC request from remaining pending indefinitely.
  // Keep the access token out of command arguments and therefore out of Git
  // error messages that are returned across the IPC boundary.
  return git.env({
    GIT_TERMINAL_PROMPT: '0',
    ...(basicAuth
      ? {
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'http.extraHeader',
          GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basicAuth}`,
        }
      : {}),
  });
};

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
  const installationToken =
    repo.githubRepoId < 0 ? undefined : await getInstallationAccessToken();

  if (repo.localRootPath && existsSync(repo.localRootPath)) {
    if (repo.githubRepoId < 0) {
      return repo.localRootPath;
    }
    const git = createGitClient(repo.localRootPath, installationToken);
    await git.fetch(['origin', '--prune']);
    return repo.localRootPath;
  }

  const targetPath = getRepoSourcePath(repo);
  ensureDirFor(targetPath);

  if (existsSync(targetPath)) {
    const git = createGitClient(targetPath, installationToken);
    const isBareRepository =
      (await git.raw(['rev-parse', '--is-bare-repository'])).trim() === 'true';
    if (!isBareRepository) {
      throw new Error(`Existing clone is not a bare Git repository: ${targetPath}`);
    }
    await git.fetch(['origin', '--prune']);
    return targetPath;
  }

  await createGitClient(undefined, installationToken).clone(
    repo.cloneUrl,
    targetPath,
    ['--bare'],
  );

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
  const installationToken =
    repo.githubRepoId < 0 ? undefined : await getInstallationAccessToken();
  const git = createGitClient(sourcePath, installationToken);

  const worktreeRoot = getWorktreeRootPath(repo);
  const worktreePath = path.join(worktreeRoot, sanitizeBranchName(worktreeName));
  ensureDirFor(worktreePath);

  if (repo.githubRepoId < 0) {
    await git.raw(['worktree', 'add', '-b', newBranchName, worktreePath, baseBranch]);
  } else {
    // Bare clones store branches in refs/heads rather than origin/<branch>.
    // Fetch the selected branch into that local ref before adding the worktree.
    await git.raw([
      'fetch',
      'origin',
      `+refs/heads/${baseBranch}:refs/heads/${baseBranch}`,
    ]);
    await git.raw([
      'worktree',
      'add',
      '-b',
      newBranchName,
      worktreePath,
      baseBranch,
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
