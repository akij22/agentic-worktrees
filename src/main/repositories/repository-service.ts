import path from 'node:path';
import { eq, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDatabase } from '../database/client';
import { repositories, type Repository } from '../../shared/db/schema';
import type { RemoteRepository } from '../github/repos';

export type LocalCloneStatus = 'none' | 'cloning' | 'cloned' | 'failed';

const getStableLocalGithubRepoId = (localRootPath: string): number => {
  let hash = 0;
  for (const char of localRootPath) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return -(hash + 1);
};

const getLocalRepositoryFullName = (
  ownerLogin: string,
  name: string,
  localRootPath: string,
): string => `${ownerLogin}/${name} (${localRootPath})`;

export const isLocalRepository = (
  repository: Pick<Repository, 'githubRepoId'>,
): boolean => repository.githubRepoId < 0;

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

export const upsertLocalRepository = ({
  localRootPath,
  defaultBranch,
}: {
  localRootPath: string;
  defaultBranch: string | null;
}): Repository => {
  const db = getDatabase();
  const now = new Date();
  const normalizedPath = path.resolve(localRootPath);
  const name = path.basename(normalizedPath);
  const ownerLogin = path.basename(path.dirname(normalizedPath)) || 'local';
  const githubRepoId = getStableLocalGithubRepoId(normalizedPath);
  const fullName = getLocalRepositoryFullName(ownerLogin, name, normalizedPath);
  const existing = db
    .select()
    .from(repositories)
    .where(
      or(
        eq(repositories.localRootPath, normalizedPath),
        eq(repositories.githubRepoId, githubRepoId),
      ),
    )
    .get();

  if (existing) {
    return db
      .update(repositories)
      .set({
        ownerLogin,
        name,
        fullName,
        defaultBranch,
        isPrivate: false,
        isArchived: false,
        cloneUrl: `file://${normalizedPath}`,
        sshUrl: null,
        htmlUrl: '',
        localRootPath: normalizedPath,
        localCloneStatus: 'cloned',
        lastLocalScanAt: now,
        updatedAt: now,
      })
      .where(eq(repositories.id, existing.id))
      .returning()
      .get();
  }

  return db
    .insert(repositories)
    .values({
      id: nanoid(),
      githubRepoId,
      ownerLogin,
      name,
      fullName,
      defaultBranch,
      isPrivate: false,
      isArchived: false,
      cloneUrl: `file://${normalizedPath}`,
      sshUrl: null,
      htmlUrl: '',
      localRootPath: normalizedPath,
      localCloneStatus: 'cloned',
      lastLocalScanAt: now,
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: now,
    })
    .returning()
    .get();
};

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
