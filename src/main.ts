import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { initDatabase } from './main/database';
import { configureCapabilityIpc, registerIpcHandlers } from './main/ipc';
import { githubAuthService } from './main/github/auth-service';
import {
  applyCodingAgentCapabilities,
  autoDiscoverAgent,
  configureCodingAgentCapabilityBridge,
  getAgentInstallationStatus,
  getCodingAgentCapabilitySession,
  stopCodingAgents,
} from './main/coding-agents/coding-agent-service';
import { workspaceTerminalService } from './main/workspace/workspace-terminal-service';
import { CapabilityRepository } from './main/capabilities/capability-repository';
import { createElectronCapabilityCredentialStore } from './main/capabilities/capability-credential-store';
import { createElectronCapabilityHostManager } from './main/capabilities/capability-host-manager';
import { CapabilityService } from './main/capabilities/capability-service';
import { getBundledCapability } from './main/capabilities/catalog';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: '',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools();
  }
};

const initializeGitHubAuth = async (): Promise<void> => {
  try {
    await githubAuthService.getStatus();
  } catch (error) {
    console.error('Failed to initialize GitHub authentication', error);
  }
};

const discoverCodingAgents = (): void => {
  const status = getAgentInstallationStatus();
  status.installations
    .filter((installation) => !installation.configured)
    .forEach((installation) => {
      void autoDiscoverAgent(installation.kind).catch((error) => {
        console.error(`Failed to discover ${installation.name}`, error);
      });
    });
};

let capabilityService: CapabilityService | null = null;

const initializeCapabilities = (): CapabilityService => {
  const repository = new CapabilityRepository();
  const credentials = createElectronCapabilityCredentialStore(path.join(app.getPath('userData'), 'capability-credentials.bin'));
  const hosts = createElectronCapabilityHostManager((capabilityId, settingKey) => service.resolveSecret(capabilityId, settingKey));
  const connections = new Map<string, import('./main/coding-agents/types').CodingAgentCapabilityConnection>();
  const connectionKinds = new Map<string, import('./main/coding-agents/types').CodingAgentKind>();
  const prepare = async (runId: string, agentKind: import('./main/coding-agents/types').CodingAgentKind) => {
    const activeIds = repository.listSessionCapabilities(runId).filter((item) => item.status === 'active').map((item) => item.capabilityId);
    const settings = Object.fromEntries(activeIds.map((id) => [id, Object.fromEntries(repository.getSettings(id).filter((item) => item.value !== undefined).map((item) => [item.key, item.value]))]));
    const host = await hosts.ensureHost(runId, activeIds, settings);
    const profileId = `aw_${runId.toLowerCase().replace(/[^a-z0-9_]+/g, '_')}`;
    const connection = { serverName: agentKind === 'codex' ? host.serverName : profileId, url: host.url, authorizationHeader: `Bearer ${host.bearerToken}`, profileId };
    connections.set(runId, connection);
    connectionKinds.set(runId, agentKind);
    return connection;
  };
  const activator = {
    prepareSession: prepare,
    apply: async (runId: string, expectedToolNames: string[]) => {
      const context = getCodingAgentCapabilitySession(runId);
      const connection = connections.get(runId) ?? await prepare(runId, context.agentKind);
      return applyCodingAgentCapabilities(runId, connection, expectedToolNames, [...connections.entries()].filter(([id]) => connectionKinds.get(id) === context.agentKind).map(([, value]) => value));
    },
    remove: async (runId: string) => {
      const context = getCodingAgentCapabilitySession(runId);
      const connection = connections.get(runId) ?? await prepare(runId, context.agentKind);
      connections.delete(runId);
      try {
        const result = await applyCodingAgentCapabilities(runId, connection, [], [...connections.entries()].filter(([id]) => connectionKinds.get(id) === context.agentKind).map(([, value]) => value));
        connectionKinds.delete(runId);
        return result;
      } catch (error) {
        connections.set(runId, connection);
        throw error;
      }
    },
    isAgentIdle: async (runId: string) => getCodingAgentCapabilitySession(runId).idle,
  };
  const service = new CapabilityService({ repository, credentials, hosts, activator, getAgentKind: async (runId) => getCodingAgentCapabilitySession(runId).agentKind, getAgentVersion: async (runId) => getCodingAgentCapabilitySession(runId).version, logError: (event, code) => console.error(event, code) });
  configureCodingAgentCapabilityBridge({
    prepareSession: prepare,
    listConnections: (agentKind) => [...connections.entries()].filter(([id]) => connectionKinds.get(id) === agentKind).map(([, value]) => value),
    stopSession: (runId) => { connections.delete(runId); connectionKinds.delete(runId); hosts.stopHost(runId); },
    listSessionCapabilities: (runId) => repository.listSessionCapabilities(runId).map((record) => ({ id: record.capabilityId, name: getBundledCapability(record.capabilityId).manifest.name, version: record.version, state: record.status, ...(record.errorCode ? { errorCode: record.errorCode } : {}), ...(record.activatedAt ? { activatedAt: record.activatedAt.toISOString() } : {}), ...(record.deactivatedAt ? { deactivatedAt: record.deactivatedAt.toISOString() } : {}) })),
    isReloading: (runId) => {
      const interruptedStates = ['pending_activation', 'pending_deactivation', 'reloading'];
      if (connectionKinds.get(runId) === 'opencode') {
        return repository.listInterruptedSessionCapabilities().some((record) => connectionKinds.get(record.runId) === 'opencode');
      }
      return repository.listSessionCapabilities(runId).some((record) => interruptedStates.includes(record.status));
    },
  });
  configureCapabilityIpc(service);
  return service;
};

void app.whenReady().then(async () => {
  initDatabase();
  capabilityService = initializeCapabilities();
  registerIpcHandlers();
  await capabilityService.reconcileCapabilities().catch((error) => console.error('Capability reconciliation failed', error instanceof Error ? error.name : 'unknown'));
  await initializeGitHubAuth();
  discoverCodingAgents();
  createWindow();
  app.on('activate', () => {
    // On OS X it's common to re-create a window when the dock icon is clicked
    // and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

let ownedProcessesStopped = false;
app.on('before-quit', (event) => {
  if (ownedProcessesStopped) return;
  event.preventDefault();
  ownedProcessesStopped = true;
  void Promise.allSettled([
    Promise.resolve(workspaceTerminalService.disposeAll()),
    capabilityService?.stopCapabilities() ?? Promise.resolve(),
    stopCodingAgents(),
  ]).finally(() => app.quit());
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
