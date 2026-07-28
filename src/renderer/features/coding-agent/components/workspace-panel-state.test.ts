import { describe, expect, it } from 'vitest';
import {
  canCommit,
  canOpenPullRequest,
  canPush,
  getWorkspaceModeLabel,
  shouldShowOpenPullRequest,
  workspacePanelModes,
} from './workspace-panel-state';
import type { WorkspaceGitStatusDto } from '../../../../shared/ipc/schemas';

const status = (
  overrides: Partial<WorkspaceGitStatusDto> = {},
): WorkspaceGitStatusDto => ({
  hasChanges: false,
  hasOrigin: false,
  hasUpstream: false,
  ahead: 0,
  behind: 0,
  hasUnpushedCommits: false,
  currentBranch: 'feat/side-panel',
  baseBranch: 'main',
  githubLinked: false,
  pullRequestEligible: false,
  suggestedPullRequestTitle: 'Add workspace panel',
  ...overrides,
});

describe('workspace panel state', () => {
  it('keeps the three user-facing modes in workflow order', () => {
    expect(workspacePanelModes).toEqual(['review', 'terminal', 'files']);
    expect(workspacePanelModes.map(getWorkspaceModeLabel)).toEqual([
      'Revisione',
      'Terminale',
      'File',
    ]);
  });

  it('derives Git action availability from status and busy state', () => {
    expect(canCommit(status({ hasChanges: true }), false)).toBe(true);
    expect(
      canPush(
        status({ hasOrigin: true, hasUnpushedCommits: true }),
        false,
      ),
    ).toBe(true);
    expect(
      canOpenPullRequest(
        status({ githubLinked: true, pullRequestEligible: true }),
        false,
      ),
    ).toBe(true);
    expect(
      shouldShowOpenPullRequest(status({ githubLinked: false })),
    ).toBe(false);
    expect(canCommit(status({ hasChanges: true }), true)).toBe(false);
    expect(
      canPush(
        status({ hasOrigin: true, hasUnpushedCommits: true }),
        true,
      ),
    ).toBe(false);
  });
});
