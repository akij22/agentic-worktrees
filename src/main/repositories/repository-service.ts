import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDatabase } from '../database/client';
import { repositories, type Repository } from '../../shared/db/schema';
import type { RemoteRepository } from '../github/repos';

export type LocalCloneStatus = 'none' | 'cloning' | 'cloned' | 'failed';

export const upsertRepositoriesFromRemote = (
  remoteRepos: RemoteRepository[],
): Repository[] => {
  const db = getDatabase();
  const now = new Date();

  return db.transaction((tx) => {
    const result: Repository[] = [];
    for (const remote of remoteRepos) {
      const existing = tx
        .select()
        .from(repositories)
        .where(eq(repositories.githubRepoId, remote.githubRepoId))
        .get();

      if (existing) {
        const updated = tx
          .update(repositories)
          .set({
            ownerLogin: remote.ownerLogin,
            name: remote.name,
            fullName: remote.fullName,
            defaultBranch: remote.defaultBranch,
            isPrivate: remote.isPrivate,
            isArchived: remote.isArchived,
            cloneUrl: remote.cloneUrl,
            sshUrl: remote.sshUrl,
            htmlUrl: remote.htmlUrl,
            updatedAt: now,
            lastSyncedAt: now,
          })
          .where(eq(repositories.id, existing.id))
          .returning()
          .get();
        result.push(updated);
      } else {
        const created = tx
          .insert(repositories)
          .values({
            id: nanoid(),
            githubRepoId: remote.githubRepoId,
            ownerLogin: remote.ownerLogin,
            name: remote.name,
            fullName: remote.fullName,
            defaultBranch: remote.defaultBranch,
            isPrivate: remote.isPrivate,
            isArchived: remote.isArchived,
            cloneUrl: remote.cloneUrl,
            sshUrl: remote.sshUrl,
            htmlUrl: remote.htmlUrl,
            localRootPath: null,
            localCloneStatus: 'none',
            createdAt: now,
            updatedAt: now,
            lastSyncedAt: now,
          })
          .returning()
          .get();
        result.push(created);
      }
    }

    return result;
  });
};

export const listRepositories = (onlyVisible = true): Repository[] =>
  onlyVisible
    ? getDatabase()
        .select()
        .from(repositories)
        .where(eq(repositories.isArchived, false))
        .all()
    : getDatabase().select().from(repositories).all();

export const getRepositoryById = (id: string): Repository | undefined =>
  getDatabase()
    .select()
    .from(repositories)
    .where(eq(repositories.id, id))
    .get();

export const setRepositoryCloneStatus = (
  id: string,
  status: LocalCloneStatus,
  localRootPath?: string,
): Repository | undefined =>
  getDatabase()
    .update(repositories)
    .set({
      localCloneStatus: status,
      ...(localRootPath !== undefined
        ? { localRootPath }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, id))
    .returning()
    .get();