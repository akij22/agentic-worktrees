import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './shared/ipc/channels';

const mocks = vi.hoisted(() => ({
  exposed: null as unknown,
  listener: null as ((event: unknown, payload: unknown) => void) | null,
  terminalListener: null as
    | ((event: unknown, payload: unknown) => void)
    | null,
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((_name: string, value: unknown) => { mocks.exposed = value; }),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn((_channel: string, listener: (event: unknown, payload: unknown) => void) => {
      if (_channel === IPC_CHANNELS.WORKSPACE_TERMINAL_EVENT) {
        mocks.terminalListener = listener;
      } else {
        mocks.listener = listener;
      }
    }),
    removeListener: mocks.removeListener,
  },
}));

describe('preload GitHub auth status subscription', () => {
  beforeEach(async () => {
    vi.resetModules();
    mocks.listener = null;
    mocks.terminalListener = null;
    mocks.removeListener.mockClear();
    vi.mocked(ipcRenderer.invoke).mockClear();
    await import('./preload');
  });

  it('parses pushed status and removes the exact listener on cleanup', () => {
    const api = mocks.exposed as {
      github: { auth: { onStatusChanged: (listener: (status: unknown) => void) => () => void } };
    };
    const listener = vi.fn();
    const cleanup = api.github.auth.onStatusChanged(listener);
    mocks.listener?.({}, {
      state: 'signed_out', profile: null, installationCount: 0,
      persistent: true, message: null, refreshToken: 'secret',
    });
    expect(listener).toHaveBeenCalledWith({
      state: 'signed_out', profile: null, installationCount: 0,
      persistent: true, message: null, errorCode: null, recoverable: false,
    });
    const registered = mocks.listener;
    cleanup();
    expect(mocks.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.GITHUB_AUTH_STATUS_CHANGED,
      registered,
    );
  });

  it('forwards a session viewed acknowledgement on its dedicated channel', async () => {
    const api = mocks.exposed as {
      codingAgent: {
        markSessionViewed: (request: { runId: string }) => Promise<void>;
      };
    };

    await api.codingAgent.markSessionViewed({ runId: 'run-1' });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.CODING_AGENT_SESSION_VIEWED,
      { runId: 'run-1' },
    );
  });

  it('forwards workspace directory requests on the dedicated channel', async () => {
    const api = mocks.exposed as {
      workspace: {
        files: {
          listDirectory: (request: {
            worktreeId: string;
            relativePath: string;
          }) => Promise<unknown>;
        };
      };
    };
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce([]);

    await api.workspace.files.listDirectory({
      worktreeId: 'worktree-1',
      relativePath: 'src',
    });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.WORKSPACE_DIRECTORY_LIST,
      { worktreeId: 'worktree-1', relativePath: 'src' },
    );
  });

  it('forwards workspace file searches on the dedicated channel', async () => {
    const api = mocks.exposed as {
      workspace: {
        files: {
          search: (request: {
            worktreeId: string;
            query: string;
            limit: number;
          }) => Promise<unknown>;
        };
      };
    };
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce([
      'src/renderer/App.tsx',
    ]);

    await api.workspace.files.search({
      worktreeId: 'worktree-1',
      query: 'app',
      limit: 20,
    });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.WORKSPACE_FILE_SEARCH,
      { worktreeId: 'worktree-1', query: 'app', limit: 20 },
    );
  });

  it('parses workspace terminal events and removes the exact listener', () => {
    const api = mocks.exposed as {
      workspace: {
        terminal: {
          onEvent: (listener: (event: unknown) => void) => () => void;
        };
      };
    };
    const listener = vi.fn();
    const cleanup = api.workspace.terminal.onEvent(listener);
    const registered = mocks.terminalListener;

    registered?.({}, {
      type: 'data',
      worktreeId: 'worktree-1',
      terminalId: 'terminal-1',
      data: 'ready',
      secret: 'strip-me',
    });

    expect(listener).toHaveBeenCalledWith({
      type: 'data',
      worktreeId: 'worktree-1',
      terminalId: 'terminal-1',
      data: 'ready',
    });
    cleanup();
    expect(mocks.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.WORKSPACE_TERMINAL_EVENT,
      registered,
    );
  });
});
