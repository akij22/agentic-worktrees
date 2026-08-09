import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './shared/ipc/channels';

const mocks = vi.hoisted(() => ({
  exposed: null as unknown,
  listeners: new Map<
    string,
    (event: unknown, payload: unknown) => void
  >(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((_name: string, value: unknown) => { mocks.exposed = value; }),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn((channel: string, listener: (event: unknown, payload: unknown) => void) => {
      mocks.listeners.set(channel, listener);
    }),
    removeListener: mocks.removeListener,
  },
}));

describe('preload GitHub auth status subscription', () => {
  beforeEach(async () => {
    vi.resetModules();
    mocks.listeners.clear();
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
    mocks.listeners.get(IPC_CHANNELS.GITHUB_AUTH_STATUS_CHANGED)?.({}, {
      state: 'signed_out', profile: null, installationCount: 0,
      persistent: true, message: null, refreshToken: 'secret',
    });
    expect(listener).toHaveBeenCalledWith({
      state: 'signed_out', profile: null, installationCount: 0,
      persistent: true, message: null, errorCode: null, recoverable: false,
    });
    const registered = mocks.listeners.get(
      IPC_CHANNELS.GITHUB_AUTH_STATUS_CHANGED,
    );
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

  it('forwards intelligence snapshot requests on the dedicated channel', async () => {
    const api = mocks.exposed as {
      intelligence: {
        getSnapshot: (request: { repositoryId: string }) => Promise<unknown>;
      };
    };
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce(null);

    await api.intelligence.getSnapshot({ repositoryId: 'repository-1' });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.INTELLIGENCE_SNAPSHOT_GET,
      { repositoryId: 'repository-1' },
    );
  });

  it('forwards conflict preparation and validates the persisted session', async () => {
    const api = mocks.exposed as {
      intelligence: {
        prepareConflict: (request: {
          overlapId: string;
          targetBranch: string;
        }) => Promise<unknown>;
      };
    };
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({
      id: 'session-1',
      repositoryId: 'repository-1',
      snapshotId: 'snapshot-1',
      overlapId: 'overlap-1',
      targetBranch: 'main',
      targetCommitSha: null,
      state: 'requested',
      classification: null,
      currentStage: 'Requested',
      integrationBranch: null,
      integrationPath: null,
      retained: false,
      cleanupPending: false,
      errorMessage: null,
      participants: [],
      files: [],
      operations: [],
      createdAt: 1,
      updatedAt: 1,
      completedAt: null,
    });

    await api.intelligence.prepareConflict({
      overlapId: 'overlap-1',
      targetBranch: 'main',
    });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.INTELLIGENCE_CONFLICT_PREPARE,
      { overlapId: 'overlap-1', targetBranch: 'main' },
    );
  });

  it('parses resolution events and removes the exact listener', () => {
    const api = mocks.exposed as {
      intelligence: {
        onResolutionSessionChanged: (
          listener: (event: unknown) => void,
        ) => () => void;
      };
    };
    const listener = vi.fn();
    const cleanup = api.intelligence.onResolutionSessionChanged(listener);
    const registered = mocks.listeners.get(
      IPC_CHANNELS.INTELLIGENCE_RESOLUTION_CHANGED,
    );

    registered?.({}, {
      sessionId: 'session-1', repositoryId: 'repository-1',
      state: 'conflict', updatedAt: 2, secret: '/tmp/worktree',
    });

    expect(listener).toHaveBeenCalledWith({
      sessionId: 'session-1', repositoryId: 'repository-1',
      state: 'conflict', updatedAt: 2,
    });
    cleanup();
    expect(mocks.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.INTELLIGENCE_RESOLUTION_CHANGED,
      registered,
    );
  });

  it('parses intelligence events and removes the exact listener', () => {
    const api = mocks.exposed as {
      intelligence: {
        onSnapshotChanged: (
          listener: (event: unknown) => void,
        ) => () => void;
      };
    };
    const listener = vi.fn();
    const cleanup = api.intelligence.onSnapshotChanged(listener);
    const registered = mocks.listeners.get(
      IPC_CHANNELS.INTELLIGENCE_SNAPSHOT_CHANGED,
    );

    registered?.({}, {
      repositoryId: 'repository-1', snapshotId: 'snapshot-1',
      completedAt: 2, secret: '/tmp/worktree',
    });

    expect(listener).toHaveBeenCalledWith({
      repositoryId: 'repository-1', snapshotId: 'snapshot-1', completedAt: 2,
    });
    cleanup();
    expect(mocks.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.INTELLIGENCE_SNAPSHOT_CHANGED,
      registered,
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
    const registered = mocks.listeners.get(
      IPC_CHANNELS.WORKSPACE_TERMINAL_EVENT,
    );

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
