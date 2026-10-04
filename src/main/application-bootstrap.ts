import { BrowserWindow } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { registerApplicationRenderer } from "./application-resource-access";
import { parseCliArguments, CliUsageError } from "./cli/arguments";
import { NodeCliTerminal } from "./cli/terminal-ui";
import { runPackageCommand } from "./cli/run-command";
import {
  createReplyEndpoint,
  executeForwardedCommand,
  createCommandExecutionQueue,
  type ReplyEndpoint,
} from "./cli/command-coordinator";
import type { ApplicationServices } from "./application-services";

export interface ElectronAppPort {
  whenReady(): Promise<void>;
  requestSingleInstanceLock(additionalData?: Record<string, unknown>): boolean;
  onSecondInstance(listener: (additionalData: unknown) => void): () => void;
  getPath(name: "userData" | "temp"): string;
  quit(): void;
  onActivate?(listener: () => void): () => void;
  onBeforeQuit?(listener: () => Promise<void>): () => void;
}
export interface BootstrapDependencies {
  createServices(input: {
    userDataPath: string;
    mode: "ui" | "cli";
  }): Promise<ApplicationServices>;
  createWindow(): void;
  initializeGitHub(): Promise<void>;
  discoverAgents(): void;
  terminal(): NodeCliTerminal;
  createEndpoint?(input: {
    tempPath: string;
    command: import("./cli/arguments").PackageCliCommand;
    terminal: NodeCliTerminal;
  }): Promise<ReplyEndpoint>;
}
const createWindow = (): void => {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: "",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const expectedURL = MAIN_WINDOW_VITE_DEV_SERVER_URL || pathToFileURL(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)).href;
  const unregister = registerApplicationRenderer(window.webContents,expectedURL);
  window.once("closed",unregister);
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    window.webContents.openDevTools();
  } else
    void window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
};
const defaults: BootstrapDependencies = {
  createServices: async (input) =>
    (await import("./application-services")).createApplicationServices(input),
  createWindow,
  initializeGitHub: async () => {
    try {
      await (
        await import("./github/auth-service")
      ).githubAuthService.getStatus();
    } catch {
      console.error("Failed to initialize GitHub authentication");
    }
  },
  discoverAgents: () => {
    void import("./coding-agents/coding-agent-service").then(
      ({ autoDiscoverAgent, getAgentInstallationStatus }) => {
        for (const installation of getAgentInstallationStatus().installations)
          if (!installation.configured)
            void autoDiscoverAgent(installation.kind).catch(() =>
              console.error("Failed to discover coding agent"),
            );
      },
    );
  },
  terminal: () => new NodeCliTerminal(),
};

export async function runApplicationBootstrap(
  argv: readonly string[],
  electronApp: ElectronAppPort,
  dependencies: BootstrapDependencies = defaults,
): Promise<void> {
  let parsed;
  try {
    parsed = parseCliArguments(argv);
  } catch (error) {
    const terminal = dependencies.terminal();
    terminal.writeLine(
      error instanceof CliUsageError ? error.message : "Invalid command.",
    );
    terminal.setExitCode(2);
    electronApp.quit();
    return;
  }
  if (parsed.mode === "cli") {
    const terminal = dependencies.terminal();
    let endpoint: ReplyEndpoint;
    try {
      endpoint = await (dependencies.createEndpoint ?? createReplyEndpoint)({
        tempPath: electronApp.getPath("temp"),
        command: parsed.command,
        terminal,
      });
    } catch {
      terminal.writeLine("Package operation failed.");
      terminal.setExitCode(1);
      electronApp.quit();
      return;
    }
    const primary = electronApp.requestSingleInstanceLock({ ...endpoint.data });
    if (!primary) {
      try {
        await endpoint.wait();
      } catch {
        terminal.writeLine("Package operation failed.");
        terminal.setExitCode(1);
      } finally {
        await endpoint.close().catch(() => undefined);
        electronApp.quit();
      }
      return;
    }
    const serviceState: { current?: ApplicationServices } = {};
    const pending: unknown[] = [];
    const forwarded = new Set<Promise<unknown>>();
    const queued = createCommandExecutionQueue(
      async (command, remote, signal) => {
        if (!serviceState.current || signal.aborted) return;
        await runPackageCommand(command, serviceState.current, remote);
      },
    );
    const dispatch = (data: unknown) => {
      if (!serviceState.current) {
        pending.push(data);
        return;
      }
      const work = executeForwardedCommand(
        data,
        queued,
        electronApp.getPath("temp"),
      ).catch(() => false);
      forwarded.add(work);
      void work.finally(() => forwarded.delete(work));
    };
    const removeSecondInstance = electronApp.onSecondInstance(dispatch);
    try {
      await electronApp.whenReady();
      serviceState.current = await dependencies.createServices({
        userDataPath: electronApp.getPath("userData"),
        mode: "cli",
      });
      for (const data of pending.splice(0)) dispatch(data);
      await queued(parsed.command, terminal, new AbortController().signal);
      removeSecondInstance();
      await Promise.allSettled([...forwarded]);
    } finally {
      removeSecondInstance();
      await endpoint.close().catch(() => undefined);
      await serviceState.current?.stop();
      electronApp.quit();
    }
    return;
  }
  if (!electronApp.requestSingleInstanceLock()) {
    electronApp.quit();
    return;
  }
  const serviceState: { current?: ApplicationServices } = {};
  const pending: unknown[] = [];
  const queued = createCommandExecutionQueue(
    async (command, terminal, signal) => {
      if (!serviceState.current || signal.aborted) return;
      await runPackageCommand(command, serviceState.current, terminal);
    },
  );
  const removeSecondInstance = electronApp.onSecondInstance((data) => {
    if (!serviceState.current) {
      pending.push(data);
      return;
    }
    void executeForwardedCommand(
      data,
      queued,
      electronApp.getPath("temp"),
    ).catch(() => false);
  });
  await electronApp.whenReady();
  const services = serviceState.current = await dependencies.createServices({
    userDataPath: electronApp.getPath("userData"),
    mode: "ui",
  });
  for (const data of pending.splice(0))
    void executeForwardedCommand(
      data,
      queued,
      electronApp.getPath("temp"),
    ).catch(() => false);
  const { configureMarketplaceIpc, registerIpcHandlers } =
    await import("./ipc");
  configureMarketplaceIpc(services.distributionService);
  registerIpcHandlers();
  const reconciliation = Promise.all([
    services.skillService
      ?.reconcileSkills()
      .catch(() => console.error("Skill reconciliation failed")),
    services.capabilityService
      .reconcileCapabilities()
      .catch(() => console.error("Capability reconciliation failed")),
  ]);
  await dependencies.initializeGitHub();
  await reconciliation;
  dependencies.discoverAgents();
  dependencies.createWindow();
  electronApp.onActivate?.(() => {
    if (BrowserWindow.getAllWindows().length === 0) dependencies.createWindow();
  });
  let stopped = false;
  electronApp.onBeforeQuit?.(async () => {
    if (stopped) return;
    stopped = true;
    removeSecondInstance();
    await services?.stop();
  });
}
