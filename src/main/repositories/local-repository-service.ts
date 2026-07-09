import { existsSync } from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { upsertLocalRepository } from './repository-service';
import type { Repository } from '../../shared/db/schema';

const assertGitMetadataExists = (repositoryPath: string): void => {
  const gitMetadataPath = path.join(repositoryPath, '.git');
  if (!existsSync(gitMetadataPath)) {
    throw new Error('The selected folder is not a Git repository: ".git" was not found.');
  }
};

const detectDefaultBranch = async (repositoryPath: string): Promise<string | null> => {
  const git = simpleGit(repositoryPath);

  try {
    const originHead = (await git.raw([
      'symbolic-ref',
      '--quiet',
      'refs/remotes/origin/HEAD',
    ])).trim();
    const branch = originHead.split('/').at(-1)?.trim();
    if (branch) {
      return branch;
    }
  } catch {
    // Fall back to the currently checked out branch when no origin HEAD exists.
  }

  try {
    const currentBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
    return currentBranch === 'HEAD' ? null : currentBranch;
  } catch {
    return null;
  }
};

export const importLocalRepository = async (
  selectedPath: string,
): Promise<Repository> => {
  const repositoryPath = path.resolve(selectedPath);
  assertGitMetadataExists(repositoryPath);

  const git = simpleGit(repositoryPath);
  const isWorkTree = (await git.revparse(['--is-inside-work-tree'])).trim();
  if (isWorkTree !== 'true') {
    throw new Error('The selected folder is not a valid Git working tree.');
  }

  const topLevelPath = (await git.revparse(['--show-toplevel'])).trim();
  if (path.resolve(topLevelPath) !== repositoryPath) {
    throw new Error('Select the repository root folder, not a nested directory.');
  }

  const defaultBranch = await detectDefaultBranch(repositoryPath);
  return upsertLocalRepository({
    localRootPath: repositoryPath,
    defaultBranch,
  });
};
