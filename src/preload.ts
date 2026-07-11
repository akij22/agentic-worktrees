import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './shared/ipc/channels';
import type { Api } from './shared/ipc/api';

const api: Api = {
  github: {
    listRepos: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.GITHUB_LIST_REPOS, request ?? {}),
    listRemoteRepos: () =>
      ipcRenderer.invoke(IPC_CHANNELS.GITHUB_LIST_REMOTE_REPOS),
    listBranches: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.GITHUB_LIST_BRANCHES, request),
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
  },
};

contextBridge.exposeInMainWorld('api', api);

export type { Api };
