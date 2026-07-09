import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDatabase } from '../database/client';
import {
  worktrees,
  type Repository,
  type Worktree,
} from '../../shared/db/schema';
import {
  setRepositoryCloneStatus,
  getRepositoryById,
} from '../repositories/repository-service';
import { createWorktreeFromBranch } from '../git/worktree';

export const listWorktreesForRepository = (
  repositoryId: string,
): Worktree[] =>
  getDatabase()
    .select()
    .from(worktrees)
    .where(eq(worktrees.repositoryId, repositoryId))
    .all();

export const createWorktree = async (
  repositoryId: string,
  baseBranch: string,
  newBranchName: string,
  worktreeName: string,
): Promise<{ worktree: Worktree; repository: Repository }> => {
  const repo = getRepositoryById(repositoryId);
  if (!repo) {
    throw new Error(`Repository not found: ${repositoryId}`);
  }

  const now = new Date();

  setRepositoryCloneStatus(repo.id, 'cloning');
  let created;
  try {
    created = await createWorktreeFromBranch(
      repo,
      baseBranch,
      newBranchName,
      worktreeName,
    );
  } catch (error) {
    setRepositoryCloneStatus(repo.id, 'failed');
    throw error;
  }

  const updatedRepo =
    setRepositoryCloneStatus(repo.id, 'cloned', created.sourcePath) ?? repo;

  const db = getDatabase();
  const worktree = db
    .insert(worktrees)
    .values({
      id: nanoid(),
      repositoryId: repo.id,
      name: worktreeName,
      path: created.path,
      branchName: created.branchName,
      baseBranchName: created.baseBranchName,
      headCommitSha: created.headCommitSha,
      status: 'created',
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return { worktree, repository: updatedRepo };
};
