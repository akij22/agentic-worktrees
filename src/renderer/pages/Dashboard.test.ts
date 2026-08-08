import { describe, expect, it } from 'vitest';
import type { Repository } from '../../shared/db/schema';
import { initialOpenDialog } from './Dashboard';

const repository: Repository = {
  id: 'repository',
  githubRepoId: 42,
  ownerLogin: 'owner',
  name: 'agentic-worktrees',
  fullName: 'owner/agentic-worktrees',
  defaultBranch: 'main',
  isPrivate: false,
  isArchived: false,
  cloneUrl: 'https://example.com/repository.git',
  sshUrl: null,
  htmlUrl: 'https://example.com/repository',
  localRootPath: null,
  localCloneStatus: 'ready',
  lastLocalScanAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastSyncedAt: null,
};

describe('Dashboard worktree dialog state', () => {
  it('uses a clicked branch as the initial worktree base', () => {
    const state = initialOpenDialog(repository, 'feat/new-work');

    expect(state).toMatchObject({
      status: 'open',
      repo: repository,
      baseBranch: 'feat/new-work',
      branchesState: 'loading',
    });
  });

  it('falls back to the repository default branch', () => {
    const state = initialOpenDialog(repository);

    expect(state).toMatchObject({
      status: 'open',
      baseBranch: 'main',
    });
  });
});
