import { nanoid } from 'nanoid';
import { spawn, type IPty } from 'node-pty';
import type { WorkspaceTerminalEventDto } from '../../shared/ipc/schemas';
import { resolveWorkspacePath } from './workspace-path';

type Disposable = {
  dispose(): void;
};

export interface WorkspacePty {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): Disposable;
  onExit(listener: (event: { exitCode: number }) => void): Disposable;
}

type PtySpawnOptions = {
  cwd: string;
  cols: number;
  rows: number;
  name: string;
  env: Record<string, string | undefined>;
};

type TerminalIdentity = {
  worktreeId: string;
  terminalId: string;
};

type TerminalDimensions = {
  cols: number;
  rows: number;
};

type TerminalRecord = TerminalIdentity &
  TerminalDimensions & {
    cwd: string;
    pty: WorkspacePty;
    exited: boolean;
    subscriptions: Disposable[];
  };

type WorkspaceTerminalDependencies = {
  createId: () => string;
  environment: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  resolveWorktreePath: (worktreeId: string) => Promise<string>;
  spawnPty: (
    shell: string,
    args: string[],
    options: PtySpawnOptions,
  ) => WorkspacePty;
};

export interface WorkspaceTerminalService {
  create(
    input: { worktreeId: string } & TerminalDimensions,
  ): Promise<{ terminalId: string }>;
  write(input: TerminalIdentity & { data: string }): void;
  resize(input: TerminalIdentity & TerminalDimensions): void;
  restart(input: TerminalIdentity & TerminalDimensions): Promise<void>;
  dispose(input: TerminalIdentity): void;
  disposeAll(): void;
  subscribe(
    listener: (event: WorkspaceTerminalEventDto) => void,
  ): () => void;
}

const getShell = (
  platform: NodeJS.Platform,
  environment: Record<string, string | undefined>,
): string =>
  platform === 'win32'
    ? environment.ComSpec ?? 'powershell.exe'
    : environment.SHELL ?? '/bin/zsh';

export const createWorkspaceTerminalService = (
  dependencies: WorkspaceTerminalDependencies,
): WorkspaceTerminalService => {
  const terminals = new Map<string, TerminalRecord>();
  const listeners = new Set<
    (event: WorkspaceTerminalEventDto) => void
  >();

  const emit = (event: WorkspaceTerminalEventDto): void => {
    for (const listener of listeners) listener(event);
  };

  const spawnRecord = (
    identity: TerminalIdentity,
    cwd: string,
    dimensions: TerminalDimensions,
  ): TerminalRecord => {
    const pty = dependencies.spawnPty(
      getShell(dependencies.platform, dependencies.environment),
      [],
      {
        cwd,
        cols: dimensions.cols,
        rows: dimensions.rows,
        name: 'xterm-256color',
        env: { ...dependencies.environment },
      },
    );
    const record: TerminalRecord = {
      ...identity,
      ...dimensions,
      cwd,
      pty,
      exited: false,
      subscriptions: [],
    };
    record.subscriptions.push(
      pty.onData((data) => {
        emit({ type: 'data', ...identity, data });
      }),
      pty.onExit(({ exitCode }) => {
        record.exited = true;
        emit({ type: 'exit', ...identity, exitCode });
      }),
    );
    return record;
  };

  const requireOwnedTerminal = ({
    worktreeId,
    terminalId,
  }: TerminalIdentity): TerminalRecord => {
    const terminal = terminals.get(terminalId);
    if (!terminal) throw new Error('Terminal is unavailable.');
    if (terminal.worktreeId !== worktreeId) {
      throw new Error('Terminal does not belong to this worktree.');
    }
    return terminal;
  };

  const disposeRecord = (record: TerminalRecord): void => {
    for (const subscription of record.subscriptions) subscription.dispose();
    record.subscriptions = [];
    if (!record.exited) {
      record.pty.kill();
      record.exited = true;
    }
  };

  return {
    async create({ worktreeId, cols, rows }) {
      const terminalId = dependencies.createId();
      try {
        const cwd = await dependencies.resolveWorktreePath(worktreeId);
        const record = spawnRecord(
          { worktreeId, terminalId },
          cwd,
          { cols, rows },
        );
        terminals.set(terminalId, record);
        return { terminalId };
      } catch (error) {
        console.error(
          `Failed to create workspace terminal for worktree ${worktreeId}`,
          error,
        );
        throw new Error('Could not start the terminal.', { cause: error });
      }
    },

    write(input) {
      const terminal = requireOwnedTerminal(input);
      if (terminal.exited) throw new Error('Terminal has exited.');
      terminal.pty.write(input.data);
    },

    resize(input) {
      const terminal = requireOwnedTerminal(input);
      if (terminal.exited) return;
      terminal.cols = input.cols;
      terminal.rows = input.rows;
      terminal.pty.resize(input.cols, input.rows);
    },

    async restart(input) {
      const terminal = requireOwnedTerminal(input);
      disposeRecord(terminal);
      const replacement = spawnRecord(
        {
          worktreeId: terminal.worktreeId,
          terminalId: terminal.terminalId,
        },
        terminal.cwd,
        { cols: input.cols, rows: input.rows },
      );
      terminals.set(terminal.terminalId, replacement);
    },

    dispose(input) {
      const terminal = terminals.get(input.terminalId);
      if (!terminal) return;
      if (terminal.worktreeId !== input.worktreeId) {
        throw new Error('Terminal does not belong to this worktree.');
      }
      disposeRecord(terminal);
      terminals.delete(input.terminalId);
    },

    disposeAll() {
      for (const terminal of terminals.values()) disposeRecord(terminal);
      terminals.clear();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

export const workspaceTerminalService = createWorkspaceTerminalService({
  createId: nanoid,
  environment: process.env,
  platform: process.platform,
  resolveWorktreePath: async (worktreeId) =>
    (await resolveWorkspacePath(worktreeId, '')).targetPath,
  spawnPty: (shell, args, options) =>
    spawn(shell, args, options) as IPty,
});
