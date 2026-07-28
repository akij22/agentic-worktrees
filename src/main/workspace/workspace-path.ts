import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { Worktree } from '../../shared/db/schema';
import { getWorktreeById } from '../worktrees/worktree-service';

export type WorkspacePathWorktree = Pick<Worktree, 'id' | 'path'>;

export type WorkspacePathDependencies = {
  getWorktree: (worktreeId: string) => WorkspacePathWorktree | undefined;
};

const productionDependencies: WorkspacePathDependencies = {
  getWorktree: getWorktreeById,
};

const isInsideRoot = (rootPath: string, targetPath: string): boolean =>
  targetPath === rootPath ||
  targetPath.startsWith(`${rootPath}${path.sep}`);

const normalizeRelativePath = (relativePath: string): string => {
  if (/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/.test(relativePath)) {
    throw new Error('Path must stay inside the worktree.');
  }
  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  if (segments.includes('..')) {
    throw new Error('Path must stay inside the worktree.');
  }
  return segments.join(path.sep);
};

export const resolveWorkspacePath = async (
  worktreeId: string,
  relativePath: string,
  dependencies: WorkspacePathDependencies = productionDependencies,
): Promise<{
  worktree: WorkspacePathWorktree;
  rootPath: string;
  targetPath: string;
}> => {
  const worktree = dependencies.getWorktree(worktreeId);
  if (!worktree) {
    throw new Error('Worktree not found.');
  }

  const rootPath = await realpath(worktree.path);
  const candidatePath = path.resolve(
    rootPath,
    normalizeRelativePath(relativePath) || '.',
  );
  if (!isInsideRoot(rootPath, candidatePath)) {
    throw new Error('Path must stay inside the worktree.');
  }

  const targetPath = await realpath(candidatePath);
  if (!isInsideRoot(rootPath, targetPath)) {
    throw new Error('Path must stay inside the worktree.');
  }

  return { worktree, rootPath, targetPath };
};
