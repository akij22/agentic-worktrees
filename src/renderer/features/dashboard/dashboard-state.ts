import type { Repository, Worktree } from '../../../shared/db/schema';

export const isLocalRepository = (repository: Repository): boolean =>
  repository.githubRepoId < 0;

export const getRepositoryLabel = (repository: Repository): string =>
  isLocalRepository(repository) ? repository.name : repository.fullName;

export const filterRepositories = (
  repositories: Repository[],
  query: string,
): Repository[] => {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return repositories;

  return repositories.filter((repository) =>
    [repository.name, repository.fullName, repository.localRootPath ?? '']
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalized),
  );
};

export const resolveSelectedRepositoryId = (
  repositories: Repository[],
  currentId?: string,
): string | undefined =>
  repositories.some((repository) => repository.id === currentId)
    ? currentId
    : repositories[0]?.id;

export const resolveSelectedWorktreeId = (
  worktrees: Worktree[],
  currentId?: string,
): string | undefined =>
  worktrees.some((worktree) => worktree.id === currentId)
    ? currentId
    : worktrees[0]?.id;
