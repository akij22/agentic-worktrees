import { describe, expect, it, vi } from 'vitest';
import { createIntelligenceService } from './intelligence-service';
import type {
  CollectedWorktreeChanges,
  PersistedIntelligenceSnapshot,
  PersistedIntelligenceWorktree,
  PersistedOverlapDetails,
} from './types';

const worktrees = ['changed', 'active-empty', 'idle-empty'].map((id) => ({
  id,
  repositoryId: 'repository-1',
  path: `/tmp/${id}`,
  branchName: `feat/${id}`,
  baseBranchName: 'main',
}));

const sessions = worktrees.map((worktree, index) => ({
  id: `run-${worktree.id}`,
  worktreeId: worktree.id,
  repositoryId: worktree.repositoryId,
  title: `${worktree.id} task`,
  agentKind: index === 0 ? 'codex' as const : 'opencode' as const,
  agentName: index === 0 ? 'Codex' : 'OpenCode',
  status: worktree.id === 'active-empty' ? 'busy' : 'idle',
  updatedAt: new Date(index + 1),
}));

const collected = (
  worktreeId: string,
  hasChanges: boolean,
): CollectedWorktreeChanges => ({
  worktreeId,
  repositoryId: 'repository-1',
  mergeBase: 'base',
  headSha: 'head',
  warnings: [],
  files: hasChanges ? [{
    path: 'src/session.ts',
    previousPath: null,
    changeType: 'modified',
    folderPath: 'src',
    modulePath: 'src',
    additions: 1,
    deletions: 1,
    patch: '@@ -1 +1 @@',
    ranges: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 }],
    binary: false,
    fingerprint: `${worktreeId}-file`,
    afterContent: 'export function createSession() {}',
    symbols: [],
  }] : [],
});

const persistedWorktree = (worktreeId: string): PersistedIntelligenceWorktree => ({
  id: `${worktreeId}-snapshot-worktree`,
  worktreeId,
  runId: `run-${worktreeId}`,
  task: `${worktreeId} task`,
  branch: `feat/${worktreeId}`,
  baseBranch: 'main',
  agentKind: 'codex',
  agentName: 'Codex',
  status: 'idle',
  additions: 1,
  deletions: 1,
  independent: false,
  warning: null,
  updatedAt: 1,
  files: collected(worktreeId, true).files,
});

const createHarness = () => {
  let persisted: PersistedIntelligenceSnapshot | null = null;
  const repository = {
    replaceSnapshot: vi.fn((snapshot: PersistedIntelligenceSnapshot) => {
      persisted = snapshot;
      return snapshot;
    }),
    getLatestSnapshot: vi.fn(() => persisted),
    getOverlap: vi.fn(),
    compareDiffs: vi.fn(),
  };
  const collector = {
    collect: vi.fn(async ({ worktreeId }: { worktreeId: string }) =>
      collected(worktreeId, worktreeId === 'changed')),
  };
  const service = createIntelligenceService({
    listWorktrees: () => worktrees,
    listSessions: () => sessions,
    collector,
    repository,
    now: () => 100,
    createId: (() => {
      let index = 0;
      return () => `id-${index += 1}`;
    })(),
  });
  return { service, collector, repository };
};

describe('intelligence service', () => {
  it('includes changed worktrees and active sessions without first edits', async () => {
    const { service } = createHarness();

    const snapshot = await service.refresh('repository-1');

    expect(snapshot.worktrees.map(({ worktreeId }) => worktreeId)).toEqual([
      'active-empty',
      'changed',
    ]);
    expect(snapshot.worktrees.find(({ worktreeId }) => worktreeId === 'changed'))
      .toMatchObject({ changedFileCount: 1, additions: 1, deletions: 1 });
  });

  it('coalesces concurrent refreshes for one repository', async () => {
    const { service, collector, repository } = createHarness();

    const [left, right] = await Promise.all([
      service.refresh('repository-1'),
      service.refresh('repository-1'),
    ]);

    expect(left.id).toBe(right.id);
    expect(collector.collect).toHaveBeenCalledTimes(3);
    expect(repository.replaceSnapshot).toHaveBeenCalledTimes(1);
  });

  it('persists valid worktrees when one collection fails', async () => {
    const { service, collector } = createHarness();
    collector.collect.mockImplementation(async ({ worktreeId }) => {
      if (worktreeId === 'idle-empty') throw new Error('missing base');
      return collected(worktreeId, worktreeId === 'changed');
    });

    const snapshot = await service.refresh('repository-1');

    expect(snapshot.warnings).toContainEqual(
      expect.stringContaining('idle-empty: missing base'),
    );
    expect(snapshot.worktrees).toHaveLength(2);
  });

  it('notifies subscribers after a successful commit', async () => {
    const { service } = createHarness();
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);

    const snapshot = await service.refresh('repository-1');

    expect(listener).toHaveBeenCalledWith({
      repositoryId: 'repository-1',
      snapshotId: snapshot.id,
      completedAt: snapshot.completedAt,
    });
    unsubscribe();
  });

  it('exposes persisted changed ranges only in focused overlap details', () => {
    const { service, repository } = createHarness();
    const details: PersistedOverlapDetails = {
      repositoryId: 'repository-1',
      snapshotId: 'snapshot-1',
      overlap: {
        id: 'overlap-1',
        leftWorktreeId: 'left',
        rightWorktreeId: 'right',
        risk: 'high',
        category: 'symbol',
        reasonCode: 'same-symbol',
        summary: 'Both worktrees change createSession',
        actionable: true,
        targets: [{
          type: 'symbol',
          path: 'src/session.ts',
          symbol: 'createSession',
          leftFilePath: 'src/session.ts',
          rightFilePath: 'src/session.ts',
          reasonCode: 'same-symbol',
          risk: 'high',
        }],
      },
      left: persistedWorktree('left'),
      right: persistedWorktree('right'),
    };
    repository.getOverlap.mockReturnValue(details);

    const result = service.getOverlap('overlap-1');

    expect(result.overlap.targets[0]).toMatchObject({
      leftRanges: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 }],
      rightRanges: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 }],
    });
  });
});
