import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { createEditorService } from './editor-service';

const createSuccessfulChild = () => {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  queueMicrotask(() => {
    child.emit('spawn');
    child.emit('close', 0);
  });
  return child;
};

describe('editor service', () => {
  it('lists only installed macOS applications and opens a worktree', async () => {
    const unref = vi.fn();
    const spawn = vi.fn().mockImplementation(() => {
      const child = createSuccessfulChild();
      child.unref = unref;
      return child;
    });
    const service = createEditorService({
      platform: 'darwin',
      exists: (file) => file === '/Applications/Cursor.app' || file === '/tmp/worktree',
      commandExists: vi.fn(),
      spawn,
    });

    await expect(service.listAvailableEditors()).resolves.toEqual([
      { id: 'cursor', name: 'Cursor' },
    ]);

    await service.openEditor('cursor', '/tmp/worktree');

    expect(spawn).toHaveBeenCalledWith('open', ['-a', 'Cursor', '/tmp/worktree'], {
      detached: true,
      stdio: 'ignore',
    });
    expect(unref).toHaveBeenCalledOnce();
  });

  it('discovers macOS applications in the user Applications directory', async () => {
    const service = createEditorService({
      platform: 'darwin',
      homeDirectory: '/Users/tester',
      exists: (file) => file === '/Users/tester/Applications/Cursor.app',
      isDirectory: () => true,
      commandExists: vi.fn(),
      spawn: vi.fn(),
    });

    await expect(service.listAvailableEditors()).resolves.toEqual([
      { id: 'cursor', name: 'Cursor' },
    ]);
  });

  it('rejects an unavailable editor before launching it', async () => {
    const spawn = vi.fn();
    const service = createEditorService({
      platform: 'linux',
      homeDirectory: '/home/tester',
      exists: () => true,
      isDirectory: () => true,
      commandExists: vi.fn().mockResolvedValue(false),
      spawn,
    });

    await expect(service.openEditor('vscode', '/tmp/worktree')).rejects.toThrow(
      'Editor is not installed: vscode',
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects when the editor process cannot be spawned', async () => {
    const service = createEditorService({
      platform: 'linux',
      homeDirectory: '/home/tester',
      exists: () => true,
      isDirectory: () => true,
      commandExists: vi.fn().mockResolvedValue(true),
      spawn: vi.fn(() => undefined),
    });

    await expect(service.openEditor('vscode', '/tmp/worktree')).rejects.toThrow(
      'Failed to start editor: vscode',
    );
  });

  it('resolves after starting a direct GUI editor without waiting for it to close', async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const service = createEditorService({
      platform: 'linux',
      homeDirectory: '/home/tester',
      exists: () => true,
      isDirectory: () => true,
      commandExists: vi.fn().mockResolvedValue(true),
      spawn: vi.fn(() => child as never),
    });

    const opening = service.openEditor('vscode', '/tmp/worktree');
    await vi.waitFor(() => expect(child.listenerCount('spawn')).toBe(1));
    child.emit('spawn');

    await expect(opening).resolves.toBeUndefined();
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it('rejects a direct GUI launch when its child emits an asynchronous error', async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const service = createEditorService({
      platform: 'linux',
      homeDirectory: '/home/tester',
      exists: () => true,
      isDirectory: () => true,
      commandExists: vi.fn().mockResolvedValue(true),
      spawn: vi.fn(() => child as never),
    });

    const opening = service.openEditor('vscode', '/tmp/worktree');
    await vi.waitFor(() => expect(child.listenerCount('error')).toBe(1));
    child.emit('error', new Error('command failed'));

    await expect(opening).rejects.toThrow('Failed to start editor: vscode');
  });

  it('rejects when the editor process exits unsuccessfully', async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const service = createEditorService({
      platform: 'darwin',
      homeDirectory: '/Users/tester',
      exists: () => true,
      isDirectory: () => true,
      commandExists: vi.fn().mockResolvedValue(true),
      spawn: vi.fn(() => child as never),
    });

    const opening = service.openEditor('vscode', '/tmp/worktree');
    await vi.waitFor(() => expect(child.listenerCount('close')).toBe(1));
    child.emit('close', 1);

    await expect(opening).rejects.toThrow('Editor exited with code 1: vscode');
  });

  it('rejects an editor ID outside the catalog', async () => {
    const service = createEditorService({
      platform: 'darwin',
      exists: () => true,
      commandExists: vi.fn(),
      spawn: vi.fn(),
    });

    await expect(service.openEditor('unknown' as never, '/tmp/worktree')).rejects.toThrow(
      'Unsupported editor: unknown',
    );
  });

  it('rejects a worktree path that does not exist', async () => {
    const spawn = vi.fn();
    const service = createEditorService({
      platform: 'darwin',
      exists: () => false,
      commandExists: vi.fn(),
      spawn,
    });

    await expect(service.openEditor('cursor', '/tmp/missing')).rejects.toThrow(
      'Worktree does not exist: /tmp/missing',
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it('discovers Linux editors through command resolution', async () => {
    const unref = vi.fn();
    const spawn = vi.fn().mockImplementation(() => {
      const child = createSuccessfulChild();
      child.unref = unref;
      return child;
    });
    const commandExists = vi.fn((command: string) => Promise.resolve(command === 'code'));
    const service = createEditorService({
      platform: 'linux',
      exists: (file) => file === '/tmp/worktree',
      commandExists,
      spawn,
    });

    await expect(service.listAvailableEditors()).resolves.toEqual([
      { id: 'vscode', name: 'Visual Studio Code' },
    ]);
    await service.openEditor('vscode', '/tmp/worktree');

    expect(spawn).toHaveBeenCalledWith('code', ['/tmp/worktree'], {
      detached: true,
      stdio: 'ignore',
    });
    expect(commandExists).toHaveBeenCalledWith('code');
    expect(unref).toHaveBeenCalledOnce();
  });

  it('discovers Windows editors through command resolution', async () => {
    const commandExists = vi.fn((command: string) => Promise.resolve(command === 'cursor'));
    const service = createEditorService({
      platform: 'win32',
      exists: () => false,
      commandExists,
      spawn: vi.fn(),
    });

    await expect(service.listAvailableEditors()).resolves.toEqual([
      { id: 'cursor', name: 'Cursor' },
    ]);
    expect(commandExists).toHaveBeenCalledWith('cursor');
  });
});
