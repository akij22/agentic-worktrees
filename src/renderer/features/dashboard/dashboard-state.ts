import type { Repository, Worktree } from '../../../shared/db/schema';
import type { CodingAgentSessionDto } from '../../../shared/ipc/schemas';

export type DashboardChatStatus = 'ready' | 'running' | 'completed' | 'error';

type DashboardChatSession = Pick<
  CodingAgentSessionDto,
  'status' | 'errorMessage' | 'hasUnviewedChanges'
>;

const RUNNING_CHAT_STATUSES = new Set([
  'creating',
  'busy',
  'aborting',
  'waiting_permission',
]);

export const getDashboardChatStatus = (
  session?: DashboardChatSession,
): DashboardChatStatus => {
  if (session?.errorMessage || session?.status === 'error') return 'error';
  if (session && RUNNING_CHAT_STATUSES.has(session.status)) return 'running';
  if (session?.status === 'idle' && session.hasUnviewedChanges) {
    return 'completed';
  }
  return 'ready';
};

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
