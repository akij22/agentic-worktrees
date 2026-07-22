import {
  BrowserWindow,
  dialog,
  ipcMain,
  IpcMainInvokeEvent,
  shell,
  type OpenDialogOptions,
} from 'electron';
import { realpathSync, statSync } from 'node:fs';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import {
  codingAgentModelsRequestSchema,
  codingAgentPermissionResponseSchema,
  codingAgentSessionAbortRequestSchema,
  codingAgentSessionCompactRequestSchema,
  codingAgentSessionCreateRequestSchema,
  codingAgentSessionGetRequestSchema,
  codingAgentSessionListRequestSchema,
  codingAgentSessionSendRequestSchema,
  codingAgentSessionUsageRequestSchema,
  codingAgentSessionModelUpdateSchema,
  codingAgentSelectExecutableRequestSchema,
  createLocalBranchRequestSchema,
  editorOpenRequestSchema,
  githubListBranchesRequestSchema,
  githubListReposRequestSchema,
  githubAuthStatusSchema,
  githubDeviceChallengeSchema,
  repositoryImportRemoteRequestSchema,
  worktreeCreateRequestSchema,
  worktreeListRequestSchema,
} from '../../shared/ipc/schemas';
import { listAvailableEditors, openEditor } from '../editors/editor-service';
import { listRemoteRepositories } from '../github/repos';
import { listBranches } from '../github/branches';
import { githubAuthService } from '../github/auth-service';
import { GITHUB_CONFIG } from '../github/config';
import { listLocalBranches, createLocalBranch } from '../git/local-branches';
import {
  createWorktree,
  getWorktreeById,
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
  compactAgentSession,
  autoDiscoverAgent,
  configureAgent,
  createAgentSession,
  getAgentInstallationStatus,
  getAgentSessionSnapshot,
  getAgentSessionUsage,
  listAgentModels,
  listAgentSessions,
  listAgentWorktrees,
  respondToAgentPermission,
  sendAgentMessage,
  setAgentSessionModel,
  subscribeToAgentEvents,
} from '../coding-agents/coding-agent-service';

const requireAuthenticated = <Arguments extends unknown[], Result>(
  handler: (...args: Arguments) => Result,
) =>
  async (...args: Arguments): Promise<Awaited<Result>> => {
    await githubAuthService.assertAuthenticated();
    try {
      return await handler(...args);
    } catch (error) {
      const record = typeof error === 'object' && error !== null
        ? error as Record<string, unknown>
        : null;
      if (
        error instanceof TypeError ||
        typeof record?.status === 'number' ||
        typeof record?.code === 'string'
      ) {
        return githubAuthService.handleOperationError(error);
      }
      throw error;
    }
  };

const authStatusResponse = async (
  operation: () => Promise<unknown>,
) => githubAuthStatusSchema.parse(await operation());

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

const handleCreateLocalBranch = async (
  _event: IpcMainInvokeEvent,
  rawRequest: unknown,
) => {
  const request = createLocalBranchRequestSchema.parse(rawRequest);
  const repo = getRepositoryById(request.repositoryId);
  if (!repo) {
    throw new Error(`Repository not found: ${request.repositoryId}`);
  }
  if (!isLocalRepository(repo)) {
    throw new Error('Creating branches is only supported for local repositories.');
  }
  if (!repo.localRootPath) {
    throw new Error(`Local repository path not found: ${repo.id}`);
  }
  return createLocalBranch(repo.localRootPath, request.branchName);
};

const handleGithubListRemoteRepos = async () => listRemoteRepositories();

const openGithubExternal = async (url: string): Promise<void> => {
  try {
    await shell.openExternal(url);
  } catch (error) {
    console.error(`Failed to open GitHub URL: ${url}`, error);
    throw error;
  }
};

const handleGithubOpenInstallation = async (): Promise<void> => {
  await openGithubExternal(
    `${GITHUB_CONFIG.webBaseUrl}/apps/${GITHUB_CONFIG.appSlug}/installations/new`,
  );
};

const handleGithubOpenDeviceVerification = async (): Promise<void> => {
  await openGithubExternal(`${GITHUB_CONFIG.webBaseUrl}/login/device`);
};

const handleGithubOpenAuthorizationSettings = async (): Promise<void> => {
  await openGithubExternal(
    `${GITHUB_CONFIG.webBaseUrl}/settings/connections/applications/${GITHUB_CONFIG.clientId}`,
  );
};

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

const handleEditorOpen = async (
  _event: IpcMainInvokeEvent,
  rawRequest: unknown,
) => {
  const request = editorOpenRequestSchema.parse(rawRequest);
  const worktree = getWorktreeById(request.worktreeId);
  if (!worktree) {
    throw new Error(`Worktree not found: ${request.worktreeId}`);
  }

  const worktreePath = realpathSync(worktree.path);
  if (!statSync(worktreePath).isDirectory()) {
    throw new Error(`Worktree path is not a directory: ${worktree.id}`);
  }

  await openEditor(request.editorId, worktreePath);
};

const handleCodingAgentSelectExecutable = async (
  _event: IpcMainInvokeEvent,
  rawRequest: unknown,
) => {
  const request = codingAgentSelectExecutableRequestSchema.parse(rawRequest);
  const agentName = request.agentKind === 'codex' ? 'Codex' : 'OpenCode';
  const discovered = await autoDiscoverAgent(request.agentKind);
  if (discovered) return discovered;

  const focusedWindow = BrowserWindow.getFocusedWindow();
  const options: OpenDialogOptions = {
    title: `Select the ${agentName} executable`,
    properties: ['openFile'],
  };
  const result = focusedWindow
    ? await dialog.showOpenDialog(focusedWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return configureAgent(request.agentKind, result.filePaths[0]);
};

const handleCodingAgentModels = async (
  _event: IpcMainInvokeEvent,
  rawRequest: unknown,
) => {
  const request = codingAgentModelsRequestSchema.parse(rawRequest);
  return listAgentModels(request.runId);
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

const handleCodingAgentSessionUsage = async (
  _event: IpcMainInvokeEvent,
  rawRequest: unknown,
) => {
  const request = codingAgentSessionUsageRequestSchema.parse(rawRequest);
  return getAgentSessionUsage(request.runId);
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

const handleCodingAgentSessionCompact = async (
  _event: IpcMainInvokeEvent,
  rawRequest: unknown,
) => {
  const request = codingAgentSessionCompactRequestSchema.parse(rawRequest);
  await compactAgentSession(request.runId);
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
  ipcMain.handle(IPC_CHANNELS.GITHUB_AUTH_STATUS, () =>
    authStatusResponse(() => githubAuthService.getStatus()),
  );
  ipcMain.handle(IPC_CHANNELS.GITHUB_AUTH_START, () =>
    githubAuthService.startLogin().then((value) =>
      githubDeviceChallengeSchema.parse(value),
    ),
  );
  ipcMain.handle(IPC_CHANNELS.GITHUB_AUTH_COMPLETE, () =>
    authStatusResponse(() => githubAuthService.completeLogin()),
  );
  ipcMain.handle(IPC_CHANNELS.GITHUB_AUTH_CANCEL, () =>
    githubAuthService.cancelLogin(),
  );
  ipcMain.handle(IPC_CHANNELS.GITHUB_AUTH_REFRESH_INSTALLATIONS, () =>
    authStatusResponse(() => githubAuthService.refreshInstallations()),
  );
  ipcMain.handle(IPC_CHANNELS.GITHUB_AUTH_LOGOUT, () =>
    authStatusResponse(() => githubAuthService.logout()),
  );
  ipcMain.handle(IPC_CHANNELS.GITHUB_AUTH_RETRY_SESSION, () =>
    authStatusResponse(() => githubAuthService.retrySession()),
  );
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_AUTH_OPEN_DEVICE_VERIFICATION,
    handleGithubOpenDeviceVerification,
  );
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_AUTH_OPEN_INSTALLATION,
    handleGithubOpenInstallation,
  );
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_AUTH_OPEN_AUTHORIZATION_SETTINGS,
    handleGithubOpenAuthorizationSettings,
  );
  ipcMain.handle(IPC_CHANNELS.GITHUB_LIST_REPOS, requireAuthenticated(handleGithubListRepos));
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_LIST_REMOTE_REPOS,
    requireAuthenticated(handleGithubListRemoteRepos),
  );
  ipcMain.handle(IPC_CHANNELS.GITHUB_LIST_BRANCHES, requireAuthenticated(handleGithubListBranches));
  ipcMain.handle(IPC_CHANNELS.GIT_CREATE_BRANCH, requireAuthenticated(handleCreateLocalBranch));
  ipcMain.handle(
    IPC_CHANNELS.REPOSITORY_IMPORT_LOCAL,
    requireAuthenticated(handleRepositoryImportLocal),
  );
  ipcMain.handle(
    IPC_CHANNELS.REPOSITORY_IMPORT_REMOTE,
    requireAuthenticated(handleRepositoryImportRemote),
  );
  ipcMain.handle(IPC_CHANNELS.WORKTREE_CREATE, requireAuthenticated(handleWorktreeCreate));
  ipcMain.handle(IPC_CHANNELS.WORKTREE_LIST, requireAuthenticated(handleWorktreeList));
  ipcMain.handle(IPC_CHANNELS.WORKTREE_LIST_ALL, requireAuthenticated(() => listAllWorktrees()));
  ipcMain.handle(IPC_CHANNELS.EDITOR_LIST_AVAILABLE, requireAuthenticated(() => listAvailableEditors()));
  ipcMain.handle(IPC_CHANNELS.EDITOR_OPEN, requireAuthenticated(handleEditorOpen));
  ipcMain.handle(
    IPC_CHANNELS.CODING_AGENT_SELECT_EXECUTABLE,
    requireAuthenticated(handleCodingAgentSelectExecutable),
  );
  ipcMain.handle(IPC_CHANNELS.CODING_AGENT_STATUS, requireAuthenticated(() =>
    getAgentInstallationStatus(),
  ));
  ipcMain.handle(IPC_CHANNELS.CODING_AGENT_MODELS, requireAuthenticated(handleCodingAgentModels));
  ipcMain.handle(IPC_CHANNELS.CODING_AGENT_WORKTREES, requireAuthenticated(() =>
    listAgentWorktrees(),
  ));
  ipcMain.handle(
    IPC_CHANNELS.CODING_AGENT_SESSION_LIST,
    requireAuthenticated(handleCodingAgentSessionList),
  );
  ipcMain.handle(
    IPC_CHANNELS.CODING_AGENT_SESSION_CREATE,
    requireAuthenticated(handleCodingAgentSessionCreate),
  );
  ipcMain.handle(
    IPC_CHANNELS.CODING_AGENT_SESSION_MODEL_UPDATE,
    requireAuthenticated(handleCodingAgentSessionModelUpdate),
  );
  ipcMain.handle(
    IPC_CHANNELS.CODING_AGENT_SESSION_GET,
    requireAuthenticated(handleCodingAgentSessionGet),
  );
  ipcMain.handle(
    IPC_CHANNELS.CODING_AGENT_SESSION_USAGE,
    requireAuthenticated(handleCodingAgentSessionUsage),
  );
  ipcMain.handle(
    IPC_CHANNELS.CODING_AGENT_SESSION_SEND,
    requireAuthenticated(handleCodingAgentSessionSend),
  );
  ipcMain.handle(
    IPC_CHANNELS.CODING_AGENT_SESSION_COMPACT,
    requireAuthenticated(handleCodingAgentSessionCompact),
  );
  ipcMain.handle(
    IPC_CHANNELS.CODING_AGENT_SESSION_ABORT,
    requireAuthenticated(handleCodingAgentSessionAbort),
  );
  ipcMain.handle(
    IPC_CHANNELS.CODING_AGENT_PERMISSION_RESPOND,
    requireAuthenticated(handleCodingAgentPermissionRespond),
  );
  githubAuthService.onStatusChange((status) => {
    const publicStatus = githubAuthStatusSchema.parse(status);
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.GITHUB_AUTH_STATUS_CHANGED, publicStatus);
    }
  });
  subscribeToAgentEvents((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.CODING_AGENT_EVENT, event);
    }
  });
};
