import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDatabase, getSqlite } from '../database/client';
import { ResourceCutover } from '../database/resource-cutover';
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
    .where(
      and(
        eq(worktrees.repositoryId, repositoryId),
        eq(worktrees.kind, 'linked'),
      ),
    )
    .all();

export const listAllWorktrees = (): Worktree[] =>
  getDatabase()
    .select()
    .from(worktrees)
    .where(eq(worktrees.kind, 'linked'))
    .all();

export const getWorktreeById = (id: string): Worktree | undefined =>
  getDatabase().select().from(worktrees).where(eq(worktrees.id, id)).get();

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
  const worktreeId = nanoid();
  const worktree = new ResourceCutover(getSqlite()).writeWorktree(worktreeId, () => db
    .insert(worktrees)
    .values({
      id: worktreeId,
      repositoryId: repo.id,
      name: worktreeName,
      path: created.path,
      branchName: created.branchName,
      kind: 'linked',
      baseBranchName: created.baseBranchName,
      headCommitSha: created.headCommitSha,
      status: 'created',
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get());

  return { worktree, repository: updatedRepo };
};
