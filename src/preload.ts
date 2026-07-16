import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './shared/ipc/channels';
import type { Api } from './shared/ipc/api';
import {
  githubAuthStatusSchema,
  githubDeviceChallengeSchema,
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
  codingAgent: {
    selectExecutable: () =>
      ipcRenderer.invoke(IPC_CHANNELS.CODING_AGENT_SELECT_EXECUTABLE),
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
    sendMessage: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.CODING_AGENT_SESSION_SEND, request),
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
