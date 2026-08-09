import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './shared/ipc/channels';
import type { Api } from './shared/ipc/api';
import {
  githubAuthStatusSchema,
  githubDeviceChallengeSchema,
  githubListBranchesResponseSchema,
  conflictResolutionSessionEventSchema,
  conflictResolutionSessionSchema,
  intelligenceDiffComparisonSchema,
  intelligenceOverlapDetailsSchema,
  intelligenceSnapshotEventSchema,
  intelligenceSnapshotSchema,
  workspaceDirectoryResponseSchema,
  workspaceFilePreviewSchema,
  workspaceFileSearchResponseSchema,
  workspaceGitStatusSchema,
  workspacePullRequestResultSchema,
  workspaceTerminalCreateResponseSchema,
  workspaceTerminalEventSchema,
} from './shared/ipc/schemas';

const api: Api = {
  github: {
    auth: {
      getStatus: async () => githubAuthStatusSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.GITHUB_AUTH_STATUS),
      ),
      startLogin: async () => githubDeviceChallengeSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.GITHUB_AUTH_START),
      ),
      completeLogin: () =>
        ipcRenderer.invoke(IPC_CHANNELS.GITHUB_AUTH_COMPLETE).then((value) =>
          githubAuthStatusSchema.parse(value),
        ),
      cancelLogin: () => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_AUTH_CANCEL),
      refreshInstallations: async () => githubAuthStatusSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.GITHUB_AUTH_REFRESH_INSTALLATIONS),
      ),
      logout: async () => githubAuthStatusSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.GITHUB_AUTH_LOGOUT),
      ),
      retrySession: async () => githubAuthStatusSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.GITHUB_AUTH_RETRY_SESSION),
      ),
      onStatusChanged: (listener) => {
        const handler = (_event: Electron.IpcRendererEvent, payload: unknown) =>
          listener(githubAuthStatusSchema.parse(payload));
        ipcRenderer.on(IPC_CHANNELS.GITHUB_AUTH_STATUS_CHANGED, handler);
        return () =>
          ipcRenderer.removeListener(IPC_CHANNELS.GITHUB_AUTH_STATUS_CHANGED, handler);
      },
      openDeviceVerification: () =>
        ipcRenderer.invoke(
          IPC_CHANNELS.GITHUB_AUTH_OPEN_DEVICE_VERIFICATION,
        ),
      openInstallation: () =>
        ipcRenderer.invoke(IPC_CHANNELS.GITHUB_AUTH_OPEN_INSTALLATION),
      openAuthorizationSettings: () =>
        ipcRenderer.invoke(
          IPC_CHANNELS.GITHUB_AUTH_OPEN_AUTHORIZATION_SETTINGS,
        ),
    },
    listRepos: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.GITHUB_LIST_REPOS, request ?? {}),
    listRemoteRepos: () =>
      ipcRenderer.invoke(IPC_CHANNELS.GITHUB_LIST_REMOTE_REPOS),
    listBranches: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.GITHUB_LIST_BRANCHES, request),
    createBranch: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_CREATE_BRANCH, request),
  },
  repositories: {
    importLocal: () => ipcRenderer.invoke(IPC_CHANNELS.REPOSITORY_IMPORT_LOCAL),
    importRemote: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.REPOSITORY_IMPORT_REMOTE, request),
  },
  worktrees: {
    create: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.WORKTREE_CREATE, request),
    list: (request) => ipcRenderer.invoke(IPC_CHANNELS.WORKTREE_LIST, request),
    listAll: () => ipcRenderer.invoke(IPC_CHANNELS.WORKTREE_LIST_ALL),
  },
  editors: {
    listAvailable: () => ipcRenderer.invoke(IPC_CHANNELS.EDITOR_LIST_AVAILABLE),
    open: (request) => ipcRenderer.invoke(IPC_CHANNELS.EDITOR_OPEN, request),
  },
  workspace: {
    files: {
      listDirectory: async (request) =>
        workspaceDirectoryResponseSchema.parse(
          await ipcRenderer.invoke(
            IPC_CHANNELS.WORKSPACE_DIRECTORY_LIST,
            request,
          ),
        ),
      readFile: async (request) =>
        workspaceFilePreviewSchema.parse(
          await ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_FILE_READ, request),
        ),
      search: async (request) =>
        workspaceFileSearchResponseSchema.parse(
          await ipcRenderer.invoke(
            IPC_CHANNELS.WORKSPACE_FILE_SEARCH,
            request,
          ),
        ),
    },
    terminal: {
      create: async (request) =>
        workspaceTerminalCreateResponseSchema.parse(
          await ipcRenderer.invoke(
            IPC_CHANNELS.WORKSPACE_TERMINAL_CREATE,
            request,
          ),
        ),
      write: (request) =>
        ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_TERMINAL_WRITE, request),
      resize: (request) =>
        ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_TERMINAL_RESIZE, request),
      restart: (request) =>
        ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_TERMINAL_RESTART, request),
      dispose: (request) =>
        ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_TERMINAL_DISPOSE, request),
      onEvent: (listener) => {
        const handler = (_event: Electron.IpcRendererEvent, payload: unknown) =>
          listener(workspaceTerminalEventSchema.parse(payload));
        ipcRenderer.on(IPC_CHANNELS.WORKSPACE_TERMINAL_EVENT, handler);
        return () =>
          ipcRenderer.removeListener(
            IPC_CHANNELS.WORKSPACE_TERMINAL_EVENT,
            handler,
          );
      },
    },
    git: {
      getStatus: async (request) =>
        workspaceGitStatusSchema.parse(
          await ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_GIT_STATUS, request),
        ),
      commit: async (request) =>
        workspaceGitStatusSchema.parse(
          await ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_GIT_COMMIT, request),
        ),
      push: async (request) =>
        workspaceGitStatusSchema.parse(
          await ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_GIT_PUSH, request),
        ),
      openPullRequest: async (request) =>
        workspacePullRequestResultSchema.parse(
          await ipcRenderer.invoke(
            IPC_CHANNELS.WORKSPACE_GIT_OPEN_PR,
            request,
          ),
        ),
    },
  },
  intelligence: {
    listRepositories: () =>
      ipcRenderer.invoke(IPC_CHANNELS.INTELLIGENCE_REPOSITORIES),
    getSnapshot: async (request) => {
      const value = await ipcRenderer.invoke(
        IPC_CHANNELS.INTELLIGENCE_SNAPSHOT_GET,
        request,
      );
      return value === null ? null : intelligenceSnapshotSchema.parse(value);
    },
    refresh: async (request) =>
      intelligenceSnapshotSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.INTELLIGENCE_REFRESH, request),
      ),
    getOverlap: async (request) =>
      intelligenceOverlapDetailsSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.INTELLIGENCE_OVERLAP_GET,
          request,
        ),
      ),
    compareDiffs: async (request) =>
      intelligenceDiffComparisonSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.INTELLIGENCE_DIFF_COMPARE,
          request,
        ),
      ),
    listTargetBranches: async (request) =>
      githubListBranchesResponseSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.INTELLIGENCE_TARGET_BRANCHES,
          request,
        ),
      ),
    prepareConflict: async (request) =>
      conflictResolutionSessionSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.INTELLIGENCE_CONFLICT_PREPARE,
          request,
        ),
      ),
    getResolutionSession: async (request) =>
      conflictResolutionSessionSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.INTELLIGENCE_RESOLUTION_GET,
          request,
        ),
      ),
    listResolutionSessions: async (request) => {
      const values: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.INTELLIGENCE_RESOLUTION_LIST,
        request,
      );
      return conflictResolutionSessionSchema.array().parse(values);
    },
    openIntegrationWorktree: async (request) => {
      await ipcRenderer.invoke(
        IPC_CHANNELS.INTELLIGENCE_INTEGRATION_OPEN,
        request,
      );
    },
    onSnapshotChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) =>
        listener(intelligenceSnapshotEventSchema.parse(payload));
      ipcRenderer.on(IPC_CHANNELS.INTELLIGENCE_SNAPSHOT_CHANGED, handler);
      return () =>
        ipcRenderer.removeListener(
          IPC_CHANNELS.INTELLIGENCE_SNAPSHOT_CHANGED,
          handler,
        );
    },
    onResolutionSessionChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) =>
        listener(conflictResolutionSessionEventSchema.parse(payload));
      ipcRenderer.on(IPC_CHANNELS.INTELLIGENCE_RESOLUTION_CHANGED, handler);
      return () =>
        ipcRenderer.removeListener(
          IPC_CHANNELS.INTELLIGENCE_RESOLUTION_CHANGED,
          handler,
        );
    },
  },
  codingAgent: {
    selectExecutable: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.CODING_AGENT_SELECT_EXECUTABLE, request),
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.CODING_AGENT_STATUS),
    listModels: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.CODING_AGENT_MODELS, request),
    listWorktrees: () =>
      ipcRenderer.invoke(IPC_CHANNELS.CODING_AGENT_WORKTREES),
    listSessions: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.CODING_AGENT_SESSION_LIST, request ?? {}),
    createSession: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.CODING_AGENT_SESSION_CREATE, request),
    setSessionModel: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.CODING_AGENT_SESSION_MODEL_UPDATE, request),
    getSession: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.CODING_AGENT_SESSION_GET, request),
    markSessionViewed: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.CODING_AGENT_SESSION_VIEWED, request),
    getSessionUsage: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.CODING_AGENT_SESSION_USAGE, request),
    sendMessage: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.CODING_AGENT_SESSION_SEND, request),
    compactSession: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.CODING_AGENT_SESSION_COMPACT, request),
    abortSession: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.CODING_AGENT_SESSION_ABORT, request),
    respondPermission: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.CODING_AGENT_PERMISSION_RESPOND, request),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) =>
        listener(payload as Parameters<typeof listener>[0]);
      ipcRenderer.on(IPC_CHANNELS.CODING_AGENT_EVENT, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CODING_AGENT_EVENT, handler);
    },
  },
};

contextBridge.exposeInMainWorld('api', api);

export type { Api };
