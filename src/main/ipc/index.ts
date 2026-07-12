import {
  BrowserWindow,
  dialog,
  ipcMain,
  IpcMainInvokeEvent,
  type OpenDialogOptions,
} from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import {
  codingAgentModelsRequestSchema,
  codingAgentPermissionResponseSchema,
  codingAgentSessionAbortRequestSchema,
  codingAgentSessionCreateRequestSchema,
  codingAgentSessionGetRequestSchema,
  codingAgentSessionListRequestSchema,
  codingAgentSessionSendRequestSchema,
  codingAgentSessionModelUpdateSchema,
  githubListBranchesRequestSchema,
  githubListReposRequestSchema,
  repositoryImportRemoteRequestSchema,
  worktreeCreateRequestSchema,
  worktreeListRequestSchema,
} from '../../shared/ipc/schemas';
import { listRemoteRepositories } from '../github/repos';
import { listBranches } from '../github/branches';
import { listLocalBranches } from '../git/local-branches';
import {
  createWorktree,
  listAllWorktrees,
  listWorktreesForRepository,
} from '../worktrees/worktree-service';
import {
  getRepositoryById,
  isLocalRepository,
  listRepositories,
  upsertRepositoriesFromRemote,
} from '../repositories/repository-service';
import { importLocalRepository } from '../repositories/local-repository-service';
import {
  abortAgentSession,
  autoDiscoverOpenCode,
  configureOpenCode,
  createAgentSession,
  getAgentInstallationStatus,
  getAgentSessionSnapshot,
  listAgentModels,
  listAgentSessions,
  listAgentWorktrees,
  respondToAgentPermission,
  sendAgentMessage,
  setAgentSessionModel,
  subscribeToAgentEvents,
} from '../coding-agents/coding-agent-service';

const handleGithubListRepos = async (
  _event: IpcMainInvokeEvent,
  rawRequest: unknown,
) => {
  const request = githubListReposRequestSchema.parse(rawRequest ?? {});
  if (request.refresh) {
    const remote = await listRemoteRepositories();
    upsertRepositoriesFromRemote(remote);
    return listRepositories(false);
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
  if (isLocalRepository(repo)) {
    if (!repo.localRootPath) {
      throw new Error(`Local repository path not found: ${repo.id}`);
    }
    return listLocalBranches(repo.localRootPath);
  }

  const [owner, repoName] = repo.fullName.split('/');
  return listBranches(owner, repoName);
};

const handleGithubListRemoteRepos = async () => listRemoteRepositories();

const handleRepositoryImportLocal = async () => {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  const dialogOptions: OpenDialogOptions = {
    title: 'Select a local Git repository',
    properties: ['openDirectory'],
  };
  const result = focusedWindow
    ? await dialog.showOpenDialog(focusedWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return importLocalRepository(result.filePaths[0]);
};

const handleRepositoryImportRemote = async (
  _event: IpcMainInvokeEvent,
  rawRequest: unknown,
) => {
  const request = repositoryImportRemoteRequestSchema.parse(rawRequest);
  const remoteRepositories = await listRemoteRepositories();
  const selectedIds = new Set(request.repositoryIds);
  const selectedRepositories = remoteRepositories.filter((repository) =>
    selectedIds.has(repository.githubRepoId),
  );

  if (selectedRepositories.length !== request.repositoryIds.length) {
    throw new Error('One or more selected GitHub repositories are unavailable.');
  }

  return upsertRepositoriesFromRemote(selectedRepositories);
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

const handleCodingAgentSelectExecutable = async () => {
  const discovered = await autoDiscoverOpenCode();
  if (discovered) return discovered;

  const focusedWindow = BrowserWindow.getFocusedWindow();
  const options: OpenDialogOptions = {
    title: 'Select the OpenCode executable',
    properties: ['openFile'],
  };
  const result = focusedWindow
    ? await dialog.showOpenDialog(focusedWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return configureOpenCode(result.filePaths[0]);
};

const handleCodingAgentModels = async (
  _event: IpcMainInvokeEvent,
  rawRequest: unknown,
) => {
  const request = codingAgentModelsRequestSchema.parse(rawRequest);
  return listAgentModels(request.worktreeId);
};

const handleCodingAgentSessionList = async (
  _event: IpcMainInvokeEvent,
  rawRequest: unknown,
) => {
  const request = codingAgentSessionListRequestSchema.parse(rawRequest ?? {});
  return listAgentSessions(request.worktreeId);
};

const handleCodingAgentSessionCreate = async (
  _event: IpcMainInvokeEvent,
  rawRequest: unknown,
) => createAgentSession(codingAgentSessionCreateRequestSchema.parse(rawRequest));

const handleCodingAgentSessionModelUpdate = async (
  _event: IpcMainInvokeEvent,
  rawRequest: unknown,
) => setAgentSessionModel(codingAgentSessionModelUpdateSchema.parse(rawRequest));

const handleCodingAgentSessionGet = async (
  _event: IpcMainInvokeEvent,
  rawRequest: unknown,
) => {
  const request = codingAgentSessionGetRequestSchema.parse(rawRequest);
  return getAgentSessionSnapshot(request.runId);
};

const handleCodingAgentSessionSend = async (
  _event: IpcMainInvokeEvent,
  rawRequest: unknown,
) => {
  const request = codingAgentSessionSendRequestSchema.parse(rawRequest);
  await sendAgentMessage(request.runId, request.content, request.reasoningVariant);
};

const handleCodingAgentSessionAbort = async (
  _event: IpcMainInvokeEvent,
  rawRequest: unknown,
) => {
  const request = codingAgentSessionAbortRequestSchema.parse(rawRequest);
  await abortAgentSession(request.runId);
};

const handleCodingAgentPermissionRespond = async (
  _event: IpcMainInvokeEvent,
  rawRequest: unknown,
) => {
  const request = codingAgentPermissionResponseSchema.parse(rawRequest);
  await respondToAgentPermission(
    request.runId,
    request.permissionId,
    request.response,
  );
};

export const registerIpcHandlers = (): void => {
  ipcMain.handle(IPC_CHANNELS.GITHUB_LIST_REPOS, handleGithubListRepos);
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_LIST_REMOTE_REPOS,
    handleGithubListRemoteRepos,
  );
  ipcMain.handle(IPC_CHANNELS.GITHUB_LIST_BRANCHES, handleGithubListBranches);
  ipcMain.handle(
    IPC_CHANNELS.REPOSITORY_IMPORT_LOCAL,
    handleRepositoryImportLocal,
  );
  ipcMain.handle(
    IPC_CHANNELS.REPOSITORY_IMPORT_REMOTE,
    handleRepositoryImportRemote,
  );
  ipcMain.handle(IPC_CHANNELS.WORKTREE_CREATE, handleWorktreeCreate);
  ipcMain.handle(IPC_CHANNELS.WORKTREE_LIST, handleWorktreeList);
  ipcMain.handle(IPC_CHANNELS.WORKTREE_LIST_ALL, () => listAllWorktrees());
  ipcMain.handle(
    IPC_CHANNELS.CODING_AGENT_SELECT_EXECUTABLE,
    handleCodingAgentSelectExecutable,
  );
  ipcMain.handle(IPC_CHANNELS.CODING_AGENT_STATUS, () =>
    getAgentInstallationStatus(),
  );
  ipcMain.handle(IPC_CHANNELS.CODING_AGENT_MODELS, handleCodingAgentModels);
  ipcMain.handle(IPC_CHANNELS.CODING_AGENT_WORKTREES, () =>
    listAgentWorktrees(),
  );
  ipcMain.handle(
    IPC_CHANNELS.CODING_AGENT_SESSION_LIST,
    handleCodingAgentSessionList,
  );
  ipcMain.handle(
    IPC_CHANNELS.CODING_AGENT_SESSION_CREATE,
    handleCodingAgentSessionCreate,
  );
  ipcMain.handle(
    IPC_CHANNELS.CODING_AGENT_SESSION_MODEL_UPDATE,
    handleCodingAgentSessionModelUpdate,
  );
  ipcMain.handle(
    IPC_CHANNELS.CODING_AGENT_SESSION_GET,
    handleCodingAgentSessionGet,
  );
  ipcMain.handle(
    IPC_CHANNELS.CODING_AGENT_SESSION_SEND,
    handleCodingAgentSessionSend,
  );
  ipcMain.handle(
    IPC_CHANNELS.CODING_AGENT_SESSION_ABORT,
    handleCodingAgentSessionAbort,
  );
  ipcMain.handle(
    IPC_CHANNELS.CODING_AGENT_PERMISSION_RESPOND,
    handleCodingAgentPermissionRespond,
  );
  subscribeToAgentEvents((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.CODING_AGENT_EVENT, event);
    }
  });
};
