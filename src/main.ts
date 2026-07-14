import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { initDatabase } from './main/database';
import { registerIpcHandlers } from './main/ipc';
import { githubAuthService } from './main/github/auth-service';
import {
  autoDiscoverOpenCode,
  getAgentInstallationStatus,
  stopCodingAgent,
} from './main/coding-agents/coding-agent-service';

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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
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

void app.whenReady().then(async () => {
  initDatabase();
  registerIpcHandlers();
  await initializeGitHubAuth();
  void (async () => {
    const status = getAgentInstallationStatus();
    if (!status.configured) {
      await autoDiscoverOpenCode();
    }
  })();
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

let codingAgentStopped = false;
app.on('before-quit', (event) => {
  if (codingAgentStopped) return;
  event.preventDefault();
  codingAgentStopped = true;
  void stopCodingAgent().finally(() => app.quit());
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
