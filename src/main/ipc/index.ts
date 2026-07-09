import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import {
  githubListBranchesRequestSchema,
  githubListReposRequestSchema,
  worktreeCreateRequestSchema,
  worktreeListRequestSchema,
} from '../../shared/ipc/schemas';
import { listRemoteRepositories } from '../github/repos';
import { listBranches } from '../github/branches';
import {
  createWorktree,
  listWorktreesForRepository,
} from '../worktrees/worktree-service';
import {
  getRepositoryById,
  listRepositories,
  upsertRepositoriesFromRemote,
} from '../repositories/repository-service';

const handleGithubListRepos = async (
  _event: IpcMainInvokeEvent,
  rawRequest: unknown,
) => {
  const request = githubListReposRequestSchema.parse(rawRequest ?? {});
  if (request.refresh) {
    const remote = await listRemoteRepositories();
    return upsertRepositoriesFromRemote(remote);
  }
  return listRepositories(false);
};

const handleGithubListBranches = async (
  _event: IpcMainInvokeEvent,
  rawRequest: unknown,
) => {
  const request = githubListBranchesRequestSchema.parse(rawRequest);
  const repo = getRepositoryById(request.repositoryId);
  if (!repo) {
    throw new Error(`Repository not found: ${request.repositoryId}`);
  }
  const [owner, repoName] = repo.fullName.split('/');
  return listBranches(owner, repoName);
};

const handleWorktreeCreate = async (
  _event: IpcMainInvokeEvent,
  rawRequest: unknown,
) => {
  const request = worktreeCreateRequestSchema.parse(rawRequest);
  return createWorktree(
    request.repositoryId,
    request.baseBranch,
    request.newBranchName,
    request.worktreeName,
  );
};

const handleWorktreeList = async (
  _event: IpcMainInvokeEvent,
  rawRequest: unknown,
) => {
  const request = worktreeListRequestSchema.parse(rawRequest);
  return listWorktreesForRepository(request.repositoryId);
};

export const registerIpcHandlers = (): void => {
  ipcMain.handle(IPC_CHANNELS.GITHUB_LIST_REPOS, handleGithubListRepos);
  ipcMain.handle(IPC_CHANNELS.GITHUB_LIST_BRANCHES, handleGithubListBranches);
  ipcMain.handle(IPC_CHANNELS.WORKTREE_CREATE, handleWorktreeCreate);
  ipcMain.handle(IPC_CHANNELS.WORKTREE_LIST, handleWorktreeList);
};