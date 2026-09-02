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
    autoDiscoverAgent: vi.fn(() => new Promise(() => undefined)),
    stopCodingAgents: vi.fn(() => Promise.resolve()),
    initDatabase: vi.fn(),
    registerIpcHandlers: vi.fn(),
    configureCapabilityIpc: vi.fn(),
    configureSkillIpc: vi.fn(),
    reconcileCapabilities: vi.fn(() => Promise.resolve()),
    stopCapabilities: vi.fn(() => Promise.resolve()),
    stopTerminals: vi.fn(),
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
      getPath: vi.fn(() => '/tmp/agentic-worktrees-test'),
    },
    BrowserWindow,
  };
});

vi.mock('./main/database', () => ({
  initDatabase: mocks.initDatabase,
}));

vi.mock('./main/ipc', () => ({
  registerIpcHandlers: mocks.registerIpcHandlers,
  configureCapabilityIpc: mocks.configureCapabilityIpc,
  configureSkillIpc: mocks.configureSkillIpc,
}));

vi.mock('./main/github/auth-service', () => ({
  githubAuthService: {
    getStatus: mocks.getStatus,
  },
}));

vi.mock('./main/coding-agents/coding-agent-service', () => ({
  applyCodingAgentCapabilities: vi.fn(),
  configureCodingAgentCapabilityBridge: vi.fn(),
  configureCodingAgentSkillCatalog: vi.fn(() => Promise.resolve()),
  configureCodingAgentSkillInvocationSource: vi.fn(),
  sendAgentMessage: vi.fn(),
  getCodingAgentCapabilitySession: vi.fn(() => ({ agentKind: 'codex', idle: true })),
  autoDiscoverAgent: mocks.autoDiscoverAgent,
  getAgentInstallationStatus: vi.fn(() => ({
    installations: [
      { kind: 'opencode', configured: false },
      { kind: 'codex', configured: false },
    ],
  })),
  stopCodingAgents: mocks.stopCodingAgents,
}));

vi.mock('./main/capabilities/capability-repository', () => ({ CapabilityRepository: class { listSessionCapabilities = vi.fn(() => []); getSettings = vi.fn(() => []); } }));
vi.mock('./main/capabilities/capability-credential-store', () => ({ createElectronCapabilityCredentialStore: vi.fn(() => ({})) }));
vi.mock('./main/capabilities/capability-host-manager', () => ({ createElectronCapabilityHostManager: vi.fn(() => ({ ensureHost: vi.fn(), stopHost: vi.fn() })) }));
vi.mock('./main/capabilities/capability-service', () => ({ CapabilityService: class { reconcileCapabilities = mocks.reconcileCapabilities; stopCapabilities = mocks.stopCapabilities; resolveSecret = vi.fn(); } }));
vi.mock('./main/capabilities/catalog', () => ({ getBundledCapability: vi.fn() }));
vi.mock('./main/skills/skill-repository',()=>({SkillRepository:class{listInstallations=vi.fn(()=>[]);listRunInvocations=vi.fn(()=>[]);}}));
vi.mock('./main/skills/skill-installer',()=>({createSkillStorageLayout:vi.fn(()=>({root:'/tmp/skills',packagesRoot:'/tmp/skills/packages',activeRoot:'/tmp/skills/active',stagingRoot:'/tmp/skills/.staging'}))}));
vi.mock('./main/skills/skill-service',()=>({SkillService:class{reconcileSkills=vi.fn(()=>Promise.resolve());listRunInvocations=vi.fn(()=>[]);getSkill=vi.fn();}}));
vi.mock('./main/workspace/workspace-terminal-service', () => ({ workspaceTerminalService: { disposeAll: mocks.stopTerminals } }));

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
  expect(mocks.autoDiscoverAgent).toHaveBeenCalledTimes(2);
  expect(mocks.autoDiscoverAgent).toHaveBeenCalledWith('opencode');
  expect(mocks.autoDiscoverAgent).toHaveBeenCalledWith('codex');
  expect((mocks.windows[0] as { webContents: { openDevTools: ReturnType<typeof vi.fn> } }).webContents.openDevTools).toHaveBeenCalledOnce();

  mocks.listeners.get('activate')?.();
  expect(mocks.windows).toHaveLength(1);
});

it('stops terminals, capability hosts, and coding-agent harnesses before quitting', async () => {
  const preventDefault = vi.fn();

  mocks.listeners.get('before-quit')?.({ preventDefault });
  await flushPromises();

  expect(preventDefault).toHaveBeenCalledOnce();
  expect(mocks.stopTerminals).toHaveBeenCalledOnce();
  expect(mocks.stopCapabilities).toHaveBeenCalledOnce();
  expect(mocks.stopCodingAgents).toHaveBeenCalledOnce();
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
