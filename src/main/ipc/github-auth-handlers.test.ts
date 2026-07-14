import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../shared/ipc/channels';

type IpcHandler = (...args: unknown[]) => unknown;

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  openExternal: vi.fn(),
  getStatus: vi.fn(),
  startLogin: vi.fn(),
  completeLogin: vi.fn(),
  cancelLogin: vi.fn(),
  refreshInstallations: vi.fn(),
  logout: vi.fn(),
  retrySession: vi.fn(),
  assertAuthenticated: vi.fn(),
  subscribeStatus: vi.fn(),
  listRemoteRepositories: vi.fn(),
  windows: [] as Array<{ webContents: { send: ReturnType<typeof vi.fn> } }>,
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => mocks.windows),
    getFocusedWindow: vi.fn(() => null),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      mocks.handlers.set(channel, handler);
    }),
  },
  shell: {
    openExternal: mocks.openExternal,
  },
}));

vi.mock('../github/auth-service', () => ({
  githubAuthService: {
    getStatus: mocks.getStatus,
    startLogin: mocks.startLogin,
    completeLogin: mocks.completeLogin,
    cancelLogin: mocks.cancelLogin,
    refreshInstallations: mocks.refreshInstallations,
    logout: mocks.logout,
    retrySession: mocks.retrySession,
    assertAuthenticated: mocks.assertAuthenticated,
    onStatusChange: mocks.subscribeStatus,
  },
}));

vi.mock('../github/repos', () => ({
  listRemoteRepositories: mocks.listRemoteRepositories,
}));

vi.mock('../github/config', () => ({
  GITHUB_CONFIG: {
    appSlug: 'agentic-worktrees-test',
    clientId: 'Iv1.test-client',
    webBaseUrl: 'https://github.com',
  },
}));

import { registerIpcHandlers } from './index';

const authChannels = [
  IPC_CHANNELS.GITHUB_AUTH_STATUS,
  IPC_CHANNELS.GITHUB_AUTH_START,
  IPC_CHANNELS.GITHUB_AUTH_COMPLETE,
  IPC_CHANNELS.GITHUB_AUTH_CANCEL,
  IPC_CHANNELS.GITHUB_AUTH_REFRESH_INSTALLATIONS,
  IPC_CHANNELS.GITHUB_AUTH_LOGOUT,
  IPC_CHANNELS.GITHUB_AUTH_RETRY_SESSION,
  IPC_CHANNELS.GITHUB_AUTH_OPEN_DEVICE_VERIFICATION,
  IPC_CHANNELS.GITHUB_AUTH_OPEN_INSTALLATION,
  IPC_CHANNELS.GITHUB_AUTH_OPEN_AUTHORIZATION_SETTINGS,
] as const;

const invoke = async (channel: string, rawRequest?: unknown) => {
  const handler = mocks.handlers.get(channel);
  expect(handler, `Expected handler for ${channel}`).toBeDefined();
  return handler?.({}, rawRequest);
};

describe('GitHub authentication IPC handlers', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    mocks.windows.length = 0;
    mocks.assertAuthenticated.mockResolvedValue(undefined);
    registerIpcHandlers();
  });

  it('registers every authentication channel', () => {
    expect(authChannels.every((channel) => mocks.handlers.has(channel))).toBe(
      true,
    );
  });

  it.each([
    [IPC_CHANNELS.GITHUB_AUTH_STATUS, 'getStatus'],
    [IPC_CHANNELS.GITHUB_AUTH_START, 'startLogin'],
    [IPC_CHANNELS.GITHUB_AUTH_COMPLETE, 'completeLogin'],
    [IPC_CHANNELS.GITHUB_AUTH_CANCEL, 'cancelLogin'],
    [
      IPC_CHANNELS.GITHUB_AUTH_REFRESH_INSTALLATIONS,
      'refreshInstallations',
    ],
    [IPC_CHANNELS.GITHUB_AUTH_LOGOUT, 'logout'],
    [IPC_CHANNELS.GITHUB_AUTH_RETRY_SESSION, 'retrySession'],
  ] as const)('delegates %s to authService.%s', async (channel, method) => {
    const publicResult = channel === IPC_CHANNELS.GITHUB_AUTH_START
      ? {
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://github.com/login/device',
          expiresAt: 1_800_000,
        }
      : {
          state: 'signed_out' as const,
          profile: null,
          installationCount: 0,
          persistent: true,
          message: null,
        };
    mocks[method].mockResolvedValueOnce(publicResult);

    await expect(invoke(channel)).resolves.toMatchObject(publicResult);
    expect(mocks[method]).toHaveBeenCalledOnce();
    expect(mocks[method]).toHaveBeenCalledWith();
  });

  const applicationChannels = [
    IPC_CHANNELS.GITHUB_LIST_REPOS,
    IPC_CHANNELS.GITHUB_LIST_REMOTE_REPOS,
    IPC_CHANNELS.GITHUB_LIST_BRANCHES,
    IPC_CHANNELS.REPOSITORY_IMPORT_LOCAL,
    IPC_CHANNELS.REPOSITORY_IMPORT_REMOTE,
    IPC_CHANNELS.WORKTREE_CREATE,
    IPC_CHANNELS.WORKTREE_LIST,
    IPC_CHANNELS.WORKTREE_LIST_ALL,
    IPC_CHANNELS.EDITOR_LIST_AVAILABLE,
    IPC_CHANNELS.EDITOR_OPEN,
    IPC_CHANNELS.CODING_AGENT_SELECT_EXECUTABLE,
    IPC_CHANNELS.CODING_AGENT_STATUS,
    IPC_CHANNELS.CODING_AGENT_MODELS,
    IPC_CHANNELS.CODING_AGENT_WORKTREES,
    IPC_CHANNELS.CODING_AGENT_SESSION_LIST,
    IPC_CHANNELS.CODING_AGENT_SESSION_CREATE,
    IPC_CHANNELS.CODING_AGENT_SESSION_MODEL_UPDATE,
    IPC_CHANNELS.CODING_AGENT_SESSION_GET,
    IPC_CHANNELS.CODING_AGENT_SESSION_SEND,
    IPC_CHANNELS.CODING_AGENT_SESSION_ABORT,
    IPC_CHANNELS.CODING_AGENT_PERMISSION_RESPOND,
  ] as const;

  it.each(['signed_out', 'installation_required'])(
    'rejects every application operation while auth is %s',
    async (state) => {
      mocks.assertAuthenticated.mockRejectedValue(
        new Error(`GitHub authentication is required (${state}).`),
      );
      for (const channel of applicationChannels) {
        await expect(invoke(channel)).rejects.toThrow('GitHub authentication is required');
      }
      expect(mocks.assertAuthenticated).toHaveBeenCalledTimes(applicationChannels.length);
    },
  );

  it('delegates an application operation after authenticated assertion', async () => {
    mocks.listRemoteRepositories.mockResolvedValueOnce([{ githubRepoId: 1 }]);
    await expect(invoke(IPC_CHANNELS.GITHUB_LIST_REMOTE_REPOS)).resolves.toEqual([
      { githubRepoId: 1 },
    ]);
    expect(mocks.assertAuthenticated).toHaveBeenCalledOnce();
    expect(mocks.listRemoteRepositories).toHaveBeenCalledOnce();
  });

  it('broadcasts only parsed public authentication status changes', () => {
    const send = vi.fn();
    mocks.windows.push({ webContents: { send } });
    const listener = mocks.subscribeStatus.mock.calls[0]?.[0] as
      | ((status: unknown) => void)
      | undefined;
    listener?.({
      state: 'signed_out', profile: null, installationCount: 0,
      persistent: true, message: null, accessToken: 'secret',
    });
    expect(send).toHaveBeenCalledWith(
      IPC_CHANNELS.GITHUB_AUTH_STATUS_CHANGED,
      {
        state: 'signed_out', profile: null, installationCount: 0,
        persistent: true, message: null, errorCode: null, recoverable: false,
      },
    );
  });

  it('opens only the configured GitHub App installation URL', async () => {
    mocks.openExternal.mockResolvedValueOnce(undefined);

    await invoke(IPC_CHANNELS.GITHUB_AUTH_OPEN_INSTALLATION, {
      url: 'https://attacker.example/install',
    });

    expect(mocks.openExternal).toHaveBeenCalledWith(
      'https://github.com/apps/agentic-worktrees-test/installations/new',
    );
  });

  it('opens only the configured GitHub device verification URL', async () => {
    mocks.openExternal.mockResolvedValueOnce(undefined);

    await invoke(IPC_CHANNELS.GITHUB_AUTH_OPEN_DEVICE_VERIFICATION, {
      url: 'https://attacker.example/device',
    });

    expect(mocks.openExternal).toHaveBeenCalledWith(
      'https://github.com/login/device',
    );
    expect(mocks.openExternal).toHaveBeenCalledOnce();
    expect(mocks.openExternal).toHaveBeenNthCalledWith(
      1,
      'https://github.com/login/device',
    );
  });

  it('opens only the configured GitHub authorization settings URL', async () => {
    mocks.openExternal.mockResolvedValueOnce(undefined);

    await invoke(IPC_CHANNELS.GITHUB_AUTH_OPEN_AUTHORIZATION_SETTINGS, {
      url: 'https://attacker.example/settings',
    });

    expect(mocks.openExternal).toHaveBeenCalledWith(
      'https://github.com/settings/connections/applications/Iv1.test-client',
    );
  });
});
