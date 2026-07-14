import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from './shared/ipc/channels';

const mocks = vi.hoisted(() => ({
  exposed: null as unknown,
  listener: null as ((event: unknown, payload: unknown) => void) | null,
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((_name: string, value: unknown) => { mocks.exposed = value; }),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn((_channel: string, listener: (event: unknown, payload: unknown) => void) => {
      mocks.listener = listener;
    }),
    removeListener: mocks.removeListener,
  },
}));

describe('preload GitHub auth status subscription', () => {
  beforeEach(async () => {
    vi.resetModules();
    mocks.listener = null;
    mocks.removeListener.mockClear();
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
});
