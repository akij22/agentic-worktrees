// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  IntelligenceOverlapDto,
  IntelligenceSnapshotDto,
  IntelligenceWorktreeDto,
} from '../../../../shared/ipc/schemas';
import { AttentionPanel } from './AttentionPanel';
import { DiffComparison } from './DiffComparison';
import { IntelligenceWorktreeNode } from './IntelligenceWorktreeNode';
import { OverlapDetails } from './OverlapDetails';
import { WorktreeOverlapMap } from './WorktreeOverlapMap';

const worktree = (
  index: number,
  independent = false,
): IntelligenceWorktreeDto => ({
  worktreeId: `worktree-${index}`,
  runId: `run-${index}`,
  task: `Task ${index}`,
  branch: `feat/task-${index}`,
  baseBranch: 'main',
  agentKind: index % 2 === 0 ? 'codex' : 'opencode',
  agentName: index % 2 === 0 ? 'Codex' : 'OpenCode',
  status: 'busy',
  changedFileCount: 1,
  additions: index * 10,
  deletions: index,
  files: [{
    path: `src/file-${index}.ts`,
    modulePath: 'src',
    additions: index * 10,
    deletions: index,
    symbols: index === 1 ? ['createSession'] : [],
  }],
  independent,
  warning: null,
  updatedAt: index,
});

const high: IntelligenceOverlapDto = {
  id: 'overlap-high',
  leftWorktreeId: 'worktree-1',
  rightWorktreeId: 'worktree-2',
  risk: 'high',
  category: 'symbol',
  reasonCode: 'same-symbol',
  summary: 'Both agents modified createSession',
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
};

const low: IntelligenceOverlapDto = {
  ...high,
  id: 'overlap-low',
  risk: 'low',
  category: 'folder',
  reasonCode: 'shared-folder',
  summary: 'Agents share folder src',
  actionable: false,
  targets: [],
};

const snapshot: IntelligenceSnapshotDto = {
  id: 'snapshot',
  repositoryId: 'repository-1',
  startedAt: 1,
  completedAt: 2,
  stale: false,
  refreshError: null,
  warnings: [],
  worktrees: [1, 2, 3, 4, 5].map((index) => worktree(index, index === 5)),
  overlaps: [high, low],
};

afterEach(() => cleanup());

describe('Intelligence Mission Control components', () => {
  it('renders four worktrees at once and paginates deterministically', () => {
    render(
      <WorktreeOverlapMap
        snapshot={snapshot}
        onReview={() => undefined}
        onCompare={() => undefined}
        onOpenChat={() => undefined}
      />,
    );

    expect(screen.getAllByTestId('intelligence-worktree-node')).toHaveLength(4);
    expect(screen.queryByText('Task 5')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next worktrees' }));
    expect(screen.getByText('Task 5')).toBeTruthy();
  });

  it('shows only actionable overlaps in Attention', () => {
    const onCompare = vi.fn();
    render(
      <AttentionPanel
        overlaps={[high, low]}
        onReview={() => undefined}
        onCompare={onCompare}
      />,
    );

    expect(screen.getByText(high.summary)).toBeTruthy();
    expect(screen.queryByText(low.summary)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Compare diff' }));
    expect(onCompare).toHaveBeenCalledWith(high.id);
  });

  it('labels a worktree with no relationships as safely independent', () => {
    render(
      <IntelligenceWorktreeNode
        worktree={worktree(5, true)}
        risk="low"
        onOpenChat={() => undefined}
      />,
    );

    expect(screen.getByText('Safely independent')).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('loads overlap details and opens the related chat', async () => {
    const onOpenChat = vi.fn();
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        intelligence: {
          getOverlap: vi.fn().mockResolvedValue({
            overlap: high,
            left: worktree(1),
            right: worktree(2),
          }),
        },
      },
    });

    render(
      <OverlapDetails
        overlapId={high.id}
        open
        onClose={() => undefined}
        onCompare={() => undefined}
        onOpenChat={onOpenChat}
      />,
    );

    await screen.findByText('createSession');
    fireEvent.click(screen.getByRole('button', { name: 'Open chat for Task 1' }));
    expect(onOpenChat).toHaveBeenCalledWith('worktree-1', 'run-1');
  });

  it('loads persisted patches for two-sided comparison', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        intelligence: {
          compareDiffs: vi.fn().mockResolvedValue({
            overlapId: high.id,
            left: {
              worktreeId: 'worktree-1',
              runId: 'run-1',
              files: [{
                path: 'src/session.ts', modulePath: 'src', additions: 1,
                deletions: 1, patch: '-old\n+left', binary: false,
              }],
            },
            right: {
              worktreeId: 'worktree-2',
              runId: 'run-2',
              files: [{
                path: 'src/session.ts', modulePath: 'src', additions: 1,
                deletions: 1, patch: '-old\n+right', binary: false,
              }],
            },
          }),
        },
      },
    });

    render(
      <DiffComparison
        overlapId={high.id}
        open
        onClose={() => undefined}
        onOpenChat={() => undefined}
      />,
    );

    await waitFor(() => expect(screen.getByText('+left')).toBeTruthy());
    expect(screen.getByText('+right')).toBeTruthy();
  });
});
