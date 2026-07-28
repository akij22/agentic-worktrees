import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkspaceGitService,
  type WorkspaceGitClient,
  type WorkspaceGitContext,
} from './workspace-git-service';

const context = (
  githubRepoId = 42,
  overrides: Partial<WorkspaceGitContext['worktree']> = {},
): WorkspaceGitContext => ({
  repository: {
    githubRepoId,
    ownerLogin: 'owner',
    name: 'agentic-worktrees',
  },
  worktree: {
    id: 'worktree-1',
    path: '/workspace/worktree-1',
    branchName: 'feat/side-panel',
    baseBranchName: 'main',
    ...overrides,
  },
});

const createGit = (
  overrides: Partial<WorkspaceGitClient> = {},
): WorkspaceGitClient => ({
  add: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined),
  getRemotes: vi
    .fn()
    .mockResolvedValue([{ name: 'origin', refs: { fetch: '', push: '' } }]),
  logLatestSubject: vi.fn().mockResolvedValue('Add workspace side panel'),
  raw: vi.fn().mockResolvedValue(''),
  status: vi.fn().mockResolvedValue({
    files: [{ path: 'src/index.ts' }],
    current: 'feat/side-panel',
    tracking: null,
    ahead: 0,
    behind: 0,
  }),
  ...overrides,
});

describe('workspace Git service', () => {
  const pullCreate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    pullCreate.mockResolvedValue({
      data: {
        number: 41,
        html_url: 'https://github.com/owner/agentic-worktrees/pull/41',
      },
    });
  });

  const createService = ({
    git = createGit(),
    gitContext = context(),
  }: {
    git?: WorkspaceGitClient;
    gitContext?: WorkspaceGitContext;
  } = {}) =>
    createWorkspaceGitService({
      createGitClient: vi.fn().mockResolvedValue(git),
      getContext: (worktreeId) =>
        worktreeId === 'worktree-1' ? gitContext : undefined,
      getOctokit: vi.fn().mockResolvedValue({
        rest: { pulls: { create: pullCreate } },
      }),
    });

  it('derives unpublished GitHub branch availability', async () => {
    const git = createGit({
      raw: vi.fn().mockImplementation(async (args: string[]) =>
        args[0] === 'rev-list' ? '2\n' : '',
      ),
    });

    await expect(
      createService({ git }).getStatus('worktree-1'),
    ).resolves.toEqual({
      hasChanges: true,
      hasOrigin: true,
      hasUpstream: false,
      ahead: 2,
      behind: 0,
      hasUnpushedCommits: true,
      currentBranch: 'feat/side-panel',
      baseBranch: 'main',
      githubLinked: true,
      pullRequestEligible: false,
      suggestedPullRequestTitle: 'Add workspace side panel',
    });
  });

  it('marks a published GitHub branch as pull-request eligible', async () => {
    const git = createGit({
      status: vi.fn().mockResolvedValue({
        files: [],
        current: 'feat/side-panel',
        tracking: 'origin/feat/side-panel',
        ahead: 0,
        behind: 0,
      }),
    });

    await expect(
      createService({ git }).getStatus('worktree-1'),
    ).resolves.toMatchObject({
      hasChanges: false,
      hasUpstream: true,
      hasUnpushedCommits: false,
      githubLinked: true,
      pullRequestEligible: true,
    });
  });

  it('stages every worktree change before committing', async () => {
    const status = vi
      .fn()
      .mockResolvedValueOnce({
        files: [{ path: 'new.ts' }],
        current: 'feat/side-panel',
        tracking: null,
        ahead: 0,
        behind: 0,
      })
      .mockResolvedValueOnce({
        files: [],
        current: 'feat/side-panel',
        tracking: null,
        ahead: 0,
        behind: 0,
      });
    const git = createGit({ status });
    const service = createService({ git });

    await service.commit('worktree-1', 'Add workspace side panel');

    expect(git.add).toHaveBeenCalledWith(['-A']);
    expect(git.commit).toHaveBeenCalledWith('Add workspace side panel');
  });

  it('publishes an untracked branch and sets its upstream', async () => {
    const raw = vi.fn().mockImplementation(async (args: string[]) =>
      args[0] === 'rev-list' ? '2\n' : '',
    );
    const git = createGit({ raw });
    const service = createService({ git });

    await service.push('worktree-1');

    expect(raw).toHaveBeenCalledWith([
      'push',
      '--set-upstream',
      'origin',
      'feat/side-panel',
    ]);
  });

  it('creates a normal pull request for a published GitHub branch', async () => {
    const git = createGit({
      status: vi.fn().mockResolvedValue({
        files: [],
        current: 'feat/side-panel',
        tracking: 'origin/feat/side-panel',
        ahead: 0,
        behind: 0,
      }),
    });
    const service = createService({ git });

    await expect(
      service.createPullRequest({
        worktreeId: 'worktree-1',
        title: 'Add workspace side panel',
        body: 'Adds integrated workspace tools.',
        baseBranch: 'main',
      }),
    ).resolves.toEqual({
      number: 41,
      url: 'https://github.com/owner/agentic-worktrees/pull/41',
    });
    expect(pullCreate).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'agentic-worktrees',
      head: 'feat/side-panel',
      base: 'main',
      title: 'Add workspace side panel',
      body: 'Adds integrated workspace tools.',
      draft: false,
    });
  });

  it('rejects unavailable commit, push, and pull-request operations', async () => {
    const cleanGit = createGit({
      getRemotes: vi.fn().mockResolvedValue([]),
      status: vi.fn().mockResolvedValue({
        files: [],
        current: 'feat/side-panel',
        tracking: null,
        ahead: 0,
        behind: 0,
      }),
    });
    const service = createService({
      git: cleanGit,
      gitContext: context(-1),
    });

    await expect(service.commit('worktree-1', 'Message')).rejects.toThrow(
      'No changes to commit.',
    );
    await expect(service.push('worktree-1')).rejects.toThrow(
      'The worktree has no origin remote.',
    );
    await expect(
      service.createPullRequest({
        worktreeId: 'worktree-1',
        title: 'Title',
        body: '',
        baseBranch: 'main',
      }),
    ).rejects.toThrow('Pull requests require a GitHub-linked repository.');
  });
});
