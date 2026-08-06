import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceFileService } from './workspace-file-service';

describe('workspace file service', () => {
  let fixtureRoot: string;
  let outsideRoot: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), 'workspace-files-'));
    outsideRoot = mkdtempSync(path.join(tmpdir(), 'workspace-outside-'));

    mkdirSync(path.join(fixtureRoot, 'src'));
    mkdirSync(path.join(fixtureRoot, '.git'));
    writeFileSync(
      path.join(fixtureRoot, 'src', 'index.ts'),
      'export const value = 1;\n',
    );
    writeFileSync(path.join(fixtureRoot, '.env.example'), 'TOKEN=\n');
    writeFileSync(path.join(fixtureRoot, 'empty.txt'), '');
    writeFileSync(path.join(fixtureRoot, 'image.bin'), Buffer.from([1, 0, 2]));
    writeFileSync(
      path.join(fixtureRoot, 'large.log'),
      Buffer.alloc(1_048_577, 65),
    );
    writeFileSync(path.join(outsideRoot, 'secret.txt'), 'outside\n');
    symlinkSync(outsideRoot, path.join(fixtureRoot, 'escape-link'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(fixtureRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  });

  const createService = () =>
    createWorkspaceFileService({
      getWorktree: (worktreeId) =>
        worktreeId === 'worktree-1'
          ? { id: worktreeId, path: fixtureRoot }
          : undefined,
    });

  const listedFiles = [
    'README.md',
    'src/renderer/App.tsx',
    'src/renderer/features/coding-agent/components/SessionComposer.tsx',
    'docs/Session Composer notes.md',
  ];

  const createSearchService = (listFiles = async () => listedFiles) =>
    createWorkspaceFileService({
      getWorktree: (worktreeId) =>
        worktreeId === 'worktree-1'
          ? { id: worktreeId, path: fixtureRoot }
          : undefined,
      listFiles,
    });

  it('ranks case-insensitive basename and path matches', async () => {
    const service = createSearchService();

    await expect(
      service.searchFiles('worktree-1', 'session', 20),
    ).resolves.toEqual([
      'docs/Session Composer notes.md',
      'src/renderer/features/coding-agent/components/SessionComposer.tsx',
    ]);
    await expect(service.searchFiles('worktree-1', 'app', 1)).resolves.toEqual([
      'src/renderer/App.tsx',
    ]);
  });

  it('sorts and bounds results for an empty query', async () => {
    await expect(
      createSearchService().searchFiles('worktree-1', '', 2),
    ).resolves.toEqual(['docs/Session Composer notes.md', 'README.md']);
  });

  it('returns safe file-search errors with their original cause', async () => {
    const gitFailure = new Error('git failed');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      createSearchService().searchFiles('missing-worktree', '', 20),
    ).rejects.toThrow('Worktree not found.');

    const failure = await createSearchService(async () =>
      Promise.reject(gitFailure),
    )
      .searchFiles('worktree-1', '', 20)
      .catch((cause: unknown) => cause);
    expect(failure).toMatchObject({
      message: 'File search is unavailable.',
      cause: gitFailure,
    });
  });

  it('lists directories before files and omits internal Git metadata', async () => {
    const entries = await createService().listDirectory('worktree-1', '');

    expect(entries.map(({ name }) => name)).not.toContain('.git');
    expect(entries[0]).toMatchObject({
      name: 'escape-link',
      kind: 'directory',
    });
    expect(entries[1]).toMatchObject({ name: 'src', kind: 'directory' });
    expect(entries.find(({ name }) => name === '.env.example')).toMatchObject({
      kind: 'file',
      hidden: true,
      size: 7,
    });
  });

  it('rejects traversal and symlinks outside the canonical worktree', async () => {
    const service = createService();

    await expect(
      service.listDirectory('worktree-1', '../outside'),
    ).rejects.toThrow('Path must stay inside the worktree.');
    await expect(
      service.listDirectory('worktree-1', 'escape-link'),
    ).rejects.toThrow('Path must stay inside the worktree.');
  });

  it('returns text and empty read-only previews', async () => {
    const service = createService();

    await expect(
      service.readFile('worktree-1', 'src/index.ts'),
    ).resolves.toEqual({
      relativePath: 'src/index.ts',
      size: 24,
      kind: 'text',
      content: 'export const value = 1;\n',
    });
    await expect(
      service.readFile('worktree-1', 'empty.txt'),
    ).resolves.toEqual({
      relativePath: 'empty.txt',
      size: 0,
      kind: 'empty',
    });
  });

  it('classifies binary and oversized files without returning content', async () => {
    const service = createService();

    await expect(
      service.readFile('worktree-1', 'image.bin'),
    ).resolves.toMatchObject({
      relativePath: 'image.bin',
      size: 3,
      kind: 'binary',
    });
    await expect(
      service.readFile('worktree-1', 'large.log'),
    ).resolves.toMatchObject({
      relativePath: 'large.log',
      size: 1_048_577,
      kind: 'too_large',
    });
  });

  it('returns safe errors for unknown worktrees and missing files', async () => {
    const service = createService();

    await expect(service.listDirectory('missing', '')).rejects.toThrow(
      'Worktree not found.',
    );
    await expect(
      service.readFile('worktree-1', 'missing.txt'),
    ).rejects.toThrow('File is unavailable.');
  });
});
