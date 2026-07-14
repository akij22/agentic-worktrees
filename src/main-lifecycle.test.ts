import { expect, it, vi } from 'vitest';

type AppListener = (...args: unknown[]) => void;

const mocks = vi.hoisted(() => {
  let resolveReady: () => void = () => undefined;
  let resolveAuth: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const auth = new Promise<void>((resolve) => {
    resolveAuth = resolve;
  });

  return {
    listeners: new Map<string, AppListener>(),
    windows: [] as object[],
    ready,
    resolveReady,
    auth,
    resolveAuth,
    getStatus: vi.fn(() => auth),
    initDatabase: vi.fn(),
    registerIpcHandlers: vi.fn(),
  };
});

vi.mock('electron-squirrel-startup', () => ({ default: false }));

vi.mock('electron', () => {
  class BrowserWindow {
    static getAllWindows = () => mocks.windows;

    readonly webContents = {
      openDevTools: vi.fn(),
    };

    readonly loadURL = vi.fn();
    readonly loadFile = vi.fn();

    constructor() {
      mocks.windows.push(this);
    }
  }

  return {
    app: {
      whenReady: vi.fn(() => mocks.ready),
      on: vi.fn((event: string, listener: AppListener) => {
        mocks.listeners.set(event, listener);
      }),
      quit: vi.fn(),
    },
    BrowserWindow,
  };
});

vi.mock('./main/database', () => ({
  initDatabase: mocks.initDatabase,
}));

vi.mock('./main/ipc', () => ({
  registerIpcHandlers: mocks.registerIpcHandlers,
}));

vi.mock('./main/github/auth-service', () => ({
  githubAuthService: {
    getStatus: mocks.getStatus,
  },
}));

vi.mock('./main/coding-agents/coding-agent-service', () => ({
  autoDiscoverOpenCode: vi.fn(),
  getAgentInstallationStatus: vi.fn(() => ({ configured: true })),
  stopCodingAgent: vi.fn(() => Promise.resolve()),
}));

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

it('does not register activation or create windows until auth bootstrap settles', async () => {
  vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', 'http://localhost:5173');

  await import('./main');

  expect(mocks.listeners.has('activate')).toBe(false);
  expect(mocks.windows).toHaveLength(0);

  mocks.resolveReady();
  await flushPromises();

  expect(mocks.getStatus).toHaveBeenCalledOnce();
  expect(mocks.listeners.has('activate')).toBe(false);
  expect(mocks.windows).toHaveLength(0);

  mocks.resolveAuth();
  await flushPromises();

  expect(mocks.windows).toHaveLength(1);
  expect(mocks.listeners.has('activate')).toBe(true);
  expect((mocks.windows[0] as { webContents: { openDevTools: ReturnType<typeof vi.fn> } }).webContents.openDevTools).toHaveBeenCalledOnce();

  mocks.listeners.get('activate')?.();
  expect(mocks.windows).toHaveLength(1);
});

it('does not open DevTools in a packaged build', async () => {
  vi.resetModules();
  mocks.windows.length = 0;
  vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', undefined);
  vi.stubGlobal('MAIN_WINDOW_VITE_NAME', 'main_window');
  await import('./main');
  const window = mocks.windows.at(-1) as { webContents: { openDevTools: ReturnType<typeof vi.fn> } } | undefined;
  expect(window?.webContents.openDevTools).not.toHaveBeenCalled();
});
