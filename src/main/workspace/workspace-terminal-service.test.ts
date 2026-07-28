import { describe, expect, it, vi } from 'vitest';
import {
  createWorkspaceTerminalService,
  type WorkspacePty,
} from './workspace-terminal-service';

const createFakePty = () => {
  let dataListener: ((data: string) => void) | undefined;
  let exitListener: ((event: { exitCode: number }) => void) | undefined;
  const pty: WorkspacePty = {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (listener) => {
      dataListener = listener;
      return { dispose: vi.fn() };
    },
    onExit: (listener) => {
      exitListener = listener;
      return { dispose: vi.fn() };
    },
  };
  return {
    pty,
    emitData: (data: string) => dataListener?.(data),
    emitExit: (exitCode: number) => exitListener?.({ exitCode }),
  };
};

describe('workspace terminal service', () => {
  it('creates a shell in the worktree and forwards input and resize', async () => {
    const fake = createFakePty();
    const spawnPty = vi.fn(() => fake.pty);
    const service = createWorkspaceTerminalService({
      createId: () => 'terminal-1',
      environment: { SHELL: '/bin/zsh', TERM: 'xterm' },
      platform: 'darwin',
      resolveWorktreePath: vi.fn().mockResolvedValue('/workspace/worktree-1'),
      spawnPty,
    });

    await expect(
      service.create({ worktreeId: 'worktree-1', cols: 100, rows: 30 }),
    ).resolves.toEqual({ terminalId: 'terminal-1' });
    expect(spawnPty).toHaveBeenCalledWith('/bin/zsh', [], {
      cwd: '/workspace/worktree-1',
      cols: 100,
      rows: 30,
      name: 'xterm-256color',
      env: { SHELL: '/bin/zsh', TERM: 'xterm' },
    });

    service.write({
      worktreeId: 'worktree-1',
      terminalId: 'terminal-1',
      data: 'pwd\r',
    });
    service.resize({
      worktreeId: 'worktree-1',
      terminalId: 'terminal-1',
      cols: 120,
      rows: 40,
    });

    expect(fake.pty.write).toHaveBeenCalledWith('pwd\r');
    expect(fake.pty.resize).toHaveBeenCalledWith(120, 40);
  });

  it('forwards output and exit events with terminal ownership', async () => {
    const fake = createFakePty();
    const service = createWorkspaceTerminalService({
      createId: () => 'terminal-1',
      environment: {},
      platform: 'linux',
      resolveWorktreePath: vi.fn().mockResolvedValue('/workspace/worktree-1'),
      spawnPty: () => fake.pty,
    });
    const listener = vi.fn();
    service.subscribe(listener);
    await service.create({ worktreeId: 'worktree-1', cols: 80, rows: 24 });

    fake.emitData('ready\r\n');
    fake.emitExit(7);

    expect(listener).toHaveBeenNthCalledWith(1, {
      type: 'data',
      worktreeId: 'worktree-1',
      terminalId: 'terminal-1',
      data: 'ready\r\n',
    });
    expect(listener).toHaveBeenNthCalledWith(2, {
      type: 'exit',
      worktreeId: 'worktree-1',
      terminalId: 'terminal-1',
      exitCode: 7,
    });
  });

  it('rejects terminal operations from a different worktree', async () => {
    const fake = createFakePty();
    const service = createWorkspaceTerminalService({
      createId: () => 'terminal-1',
      environment: {},
      platform: 'linux',
      resolveWorktreePath: vi.fn().mockResolvedValue('/workspace/worktree-1'),
      spawnPty: () => fake.pty,
    });
    await service.create({ worktreeId: 'worktree-1', cols: 80, rows: 24 });

    expect(() =>
      service.write({
        worktreeId: 'worktree-2',
        terminalId: 'terminal-1',
        data: 'pwd\r',
      }),
    ).toThrow('Terminal does not belong to this worktree.');
    expect(fake.pty.write).not.toHaveBeenCalled();
  });

  it('restarts an exited terminal without changing its identifier', async () => {
    const first = createFakePty();
    const second = createFakePty();
    const spawnPty = vi
      .fn()
      .mockReturnValueOnce(first.pty)
      .mockReturnValueOnce(second.pty);
    const service = createWorkspaceTerminalService({
      createId: () => 'terminal-1',
      environment: {},
      platform: 'linux',
      resolveWorktreePath: vi.fn().mockResolvedValue('/workspace/worktree-1'),
      spawnPty,
    });
    await service.create({ worktreeId: 'worktree-1', cols: 80, rows: 24 });
    first.emitExit(0);

    await service.restart({
      worktreeId: 'worktree-1',
      terminalId: 'terminal-1',
      cols: 110,
      rows: 34,
    });
    service.write({
      worktreeId: 'worktree-1',
      terminalId: 'terminal-1',
      data: 'echo restarted\r',
    });

    expect(spawnPty).toHaveBeenCalledTimes(2);
    expect(second.pty.write).toHaveBeenCalledWith('echo restarted\r');
  });

  it('disposes one or all live terminal processes exactly once', async () => {
    const first = createFakePty();
    const second = createFakePty();
    const spawnPty = vi
      .fn()
      .mockReturnValueOnce(first.pty)
      .mockReturnValueOnce(second.pty);
    let id = 0;
    const service = createWorkspaceTerminalService({
      createId: () => `terminal-${++id}`,
      environment: {},
      platform: 'linux',
      resolveWorktreePath: vi.fn().mockResolvedValue('/workspace/worktree-1'),
      spawnPty,
    });
    await service.create({ worktreeId: 'worktree-1', cols: 80, rows: 24 });
    await service.create({ worktreeId: 'worktree-1', cols: 80, rows: 24 });

    service.dispose({
      worktreeId: 'worktree-1',
      terminalId: 'terminal-1',
    });
    service.disposeAll();
    service.disposeAll();

    expect(first.pty.kill).toHaveBeenCalledOnce();
    expect(second.pty.kill).toHaveBeenCalledOnce();
  });
});
