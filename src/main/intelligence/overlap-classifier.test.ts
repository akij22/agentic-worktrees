import { describe, expect, it } from 'vitest';
import { classifyWorktreeOverlaps } from './overlap-classifier';
import type {
  ChangedSymbol,
  CollectedFileChange,
  CollectedWorktreeChanges,
} from './types';

const symbol = (qualifiedName: string): ChangedSymbol => ({
  kind: 'method',
  name: qualifiedName.split('.').at(-1) ?? qualifiedName,
  qualifiedName,
  declarationStart: 1,
  declarationEnd: 5,
  changedStart: 2,
  changedEnd: 2,
});

const file = (
  filePath: string,
  modulePath: string,
  options: Partial<CollectedFileChange> = {},
): CollectedFileChange => ({
  path: filePath,
  previousPath: null,
  changeType: 'modified',
  folderPath: filePath.split('/').slice(0, -1).join('/'),
  modulePath,
  additions: 1,
  deletions: 1,
  patch: '',
  ranges: [{ oldStart: 2, oldLines: 1, newStart: 2, newLines: 1 }],
  binary: false,
  fingerprint: `${filePath}-fingerprint`,
  afterContent: 'content',
  symbols: [],
  ...options,
});

const worktree = (
  worktreeId: string,
  files: CollectedFileChange[],
): CollectedWorktreeChanges => ({
  worktreeId,
  repositoryId: 'repository-1',
  mergeBase: 'base',
  headSha: `${worktreeId}-head`,
  files,
  warnings: [],
});

describe('worktree overlap classifier', () => {
  it('classifies the same qualified symbol in the same file as high risk', () => {
    const result = classifyWorktreeOverlaps([
      worktree('left', [
        file('src/session.ts', 'src', { symbols: [symbol('Service.createSession')] }),
      ]),
      worktree('right', [
        file('src/session.ts', 'src', { symbols: [symbol('Service.createSession')] }),
      ]),
    ]);

    expect(result.overlaps[0]).toMatchObject({
      risk: 'high',
      category: 'symbol',
      reasonCode: 'same-symbol',
      actionable: true,
    });
    expect(result.overlaps[0].summary).toContain('createSession');
  });

  it('classifies overlapping original ranges in one file as high risk', () => {
    const result = classifyWorktreeOverlaps([
      worktree('left', [file('src/session.ts', 'src')]),
      worktree('right', [
        file('src/session.ts', 'src', {
          ranges: [{ oldStart: 2, oldLines: 2, newStart: 2, newLines: 2 }],
        }),
      ]),
    ]);

    expect(result.overlaps[0]).toMatchObject({
      risk: 'high',
      reasonCode: 'overlapping-original-range',
      actionable: true,
    });
  });

  it('classifies one file with distinct symbols as actionable medium risk', () => {
    const result = classifyWorktreeOverlaps([
      worktree('left', [
        file('src/session.ts', 'src', {
          ranges: [{ oldStart: 2, oldLines: 1, newStart: 2, newLines: 1 }],
          symbols: [symbol('Service.createSession')],
        }),
      ]),
      worktree('right', [
        file('src/session.ts', 'src', {
          ranges: [{ oldStart: 8, oldLines: 1, newStart: 8, newLines: 1 }],
          symbols: [symbol('Service.resumeSession')],
        }),
      ]),
    ]);

    expect(result.overlaps[0]).toMatchObject({
      risk: 'medium',
      category: 'file',
      reasonCode: 'same-file',
      actionable: true,
    });
  });

  it('keeps a two-worktree shared module out of Attention', () => {
    const result = classifyWorktreeOverlaps([
      worktree('left', [file('src/main/auth/a.ts', 'src/main/auth')]),
      worktree('right', [file('src/main/auth/b.ts', 'src/main/auth')]),
    ]);

    expect(result.overlaps[0]).toMatchObject({
      risk: 'medium',
      category: 'module',
      reasonCode: 'same-module',
      actionable: false,
    });
  });

  it('makes a shared module actionable when three worktrees touch it', () => {
    const result = classifyWorktreeOverlaps([
      worktree('one', [file('src/main/auth/a.ts', 'src/main/auth')]),
      worktree('two', [file('src/main/auth/b.ts', 'src/main/auth')]),
      worktree('three', [file('src/main/auth/c.ts', 'src/main/auth')]),
    ]);

    expect(result.overlaps).toHaveLength(3);
    expect(result.overlaps.every(({ actionable }) => actionable)).toBe(true);
    expect(result.overlaps.every(({ reasonCode }) => reasonCode === 'crowded-module'))
      .toBe(true);
  });

  it('classifies only a shared parent folder as low risk', () => {
    const result = classifyWorktreeOverlaps([
      worktree('left', [file('src/main/auth/a.ts', 'src/main/auth')]),
      worktree('right', [file('src/main/git/b.ts', 'src/main/git')]),
    ]);

    expect(result.overlaps[0]).toMatchObject({
      risk: 'low',
      category: 'folder',
      reasonCode: 'shared-folder',
      actionable: false,
    });
  });

  it('marks unrelated worktrees as independent', () => {
    const result = classifyWorktreeOverlaps([
      worktree('left', [file('src/main/auth/a.ts', 'src/main/auth')]),
      worktree('unrelated', [file('docs/guide.md', 'docs')]),
    ]);

    expect(result.overlaps).toEqual([]);
    expect(result.independentWorktreeIds).toEqual(['left', 'unrelated']);
  });

  it('orders high risk before medium and low relationships', () => {
    const result = classifyWorktreeOverlaps([
      worktree('alpha', [file('src/main/auth/a.ts', 'src/main/auth')]),
      worktree('beta', [file('src/main/git/b.ts', 'src/main/git')]),
      worktree('gamma', [file('src/main/auth/a.ts', 'src/main/auth')]),
      worktree('delta', [file('src/main/auth/c.ts', 'src/main/auth')]),
    ]);
    const ranks = result.overlaps.map(({ risk }) =>
      ({ high: 0, medium: 1, low: 2 })[risk]);

    expect(ranks).toEqual([...ranks].sort((left, right) => left - right));
    expect(result.overlaps[0].risk).toBe('high');
    expect(result.overlaps.at(-1)?.risk).toBe('low');
  });
});
