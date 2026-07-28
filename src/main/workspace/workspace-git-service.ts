import type { Repository, Worktree } from '../../shared/db/schema';
import type {
  WorkspaceGitStatusDto,
  WorkspacePullRequestResultDto,
} from '../../shared/ipc/schemas';
import { createAuthenticatedGitClient } from '../git/worktree';
import { getAuthenticatedOctokit, getGitHubAccessToken } from '../github/octokit';
import {
  getRepositoryById,
  isLocalRepository,
} from '../repositories/repository-service';
import { getWorktreeById } from '../worktrees/worktree-service';

type GitStatusSnapshot = {
  files: Array<{ path: string }>;
  current: string | null;
  tracking: string | null;
  ahead: number;
  behind: number;
};

type GitRemote = {
  name: string;
  refs: {
    fetch: string;
    push: string;
  };
};

export interface WorkspaceGitClient {
  status(): Promise<GitStatusSnapshot>;
  getRemotes(): Promise<GitRemote[]>;
  raw(args: string[]): Promise<string>;
  add(args: string[]): Promise<unknown>;
  commit(message: string): Promise<unknown>;
  logLatestSubject(): Promise<string | null>;
}

export type WorkspaceGitContext = {
  worktree: Pick<
    Worktree,
    'id' | 'path' | 'branchName' | 'baseBranchName'
  >;
  repository: Pick<Repository, 'githubRepoId' | 'ownerLogin' | 'name'>;
};

type PullRequestClient = {
  rest: {
    pulls: {
      create(input: {
        owner: string;
        repo: string;
        head: string;
        base: string;
        title: string;
        body: string;
        draft: false;
      }): Promise<{
        data: {
          number: number;
          html_url: string;
        };
      }>;
    };
  };
};

type WorkspaceGitServiceDependencies = {
  createGitClient: (
    context: WorkspaceGitContext,
  ) => Promise<WorkspaceGitClient>;
  getContext: (worktreeId: string) => WorkspaceGitContext | undefined;
  getOctokit: () => Promise<PullRequestClient>;
};

export interface WorkspaceGitService {
  getStatus(worktreeId: string): Promise<WorkspaceGitStatusDto>;
  commit(
    worktreeId: string,
    message: string,
  ): Promise<WorkspaceGitStatusDto>;
  push(worktreeId: string): Promise<WorkspaceGitStatusDto>;
  createPullRequest(input: {
    worktreeId: string;
    title: string;
    body: string;
    baseBranch: string;
  }): Promise<WorkspacePullRequestResultDto>;
}

const parseCount = (value: string): number => {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const createWorkspaceGitService = (
  dependencies: WorkspaceGitServiceDependencies,
): WorkspaceGitService => {
  const requireContext = (worktreeId: string): WorkspaceGitContext => {
    const context = dependencies.getContext(worktreeId);
    if (!context) throw new Error('Worktree not found.');
    return context;
  };

  const loadStatus = async (
    context: WorkspaceGitContext,
    git: WorkspaceGitClient,
  ): Promise<WorkspaceGitStatusDto> => {
    const [status, remotes, latestSubject] = await Promise.all([
      git.status(),
      git.getRemotes(),
      git.logLatestSubject(),
    ]);
    const currentBranch =
      status.current?.trim() || context.worktree.branchName;
    const baseBranch = context.worktree.baseBranchName;
    const hasOrigin = remotes.some(({ name }) => name === 'origin');
    const hasUpstream = Boolean(status.tracking);
    let ahead = Math.max(0, status.ahead);
    const behind = Math.max(0, status.behind);

    if (!hasUpstream && baseBranch) {
      try {
        ahead = parseCount(
          await git.raw([
            'rev-list',
            '--count',
            `${baseBranch}..HEAD`,
          ]),
        );
      } catch (error) {
        console.error(
          `Failed to compare ${currentBranch} with ${baseBranch}`,
          error,
        );
        ahead = 0;
      }
    }

    const hasUnpushedCommits = hasOrigin && ahead > 0;
    const githubLinked = !isLocalRepository(context.repository);
    const pullRequestEligible =
      githubLinked &&
      hasOrigin &&
      hasUpstream &&
      !hasUnpushedCommits &&
      Boolean(baseBranch) &&
      currentBranch !== baseBranch;

    return {
      hasChanges: status.files.length > 0,
      hasOrigin,
      hasUpstream,
      ahead,
      behind,
      hasUnpushedCommits,
      currentBranch,
      baseBranch,
      githubLinked,
      pullRequestEligible,
      suggestedPullRequestTitle:
        latestSubject?.trim() || context.worktree.branchName,
    };
  };

  const getClient = async (
    worktreeId: string,
  ): Promise<{
    context: WorkspaceGitContext;
    git: WorkspaceGitClient;
  }> => {
    const context = requireContext(worktreeId);
    const git = await dependencies.createGitClient(context);
    return { context, git };
  };

  return {
    async getStatus(worktreeId) {
      const { context, git } = await getClient(worktreeId);
      return loadStatus(context, git);
    },

    async commit(worktreeId, message) {
      const normalizedMessage = message.trim();
      if (!normalizedMessage) throw new Error('Commit message is required.');
      const { context, git } = await getClient(worktreeId);
      const status = await loadStatus(context, git);
      if (!status.hasChanges) throw new Error('No changes to commit.');
      await git.add(['-A']);
      await git.commit(normalizedMessage);
      return loadStatus(context, git);
    },

    async push(worktreeId) {
      const { context, git } = await getClient(worktreeId);
      const status = await loadStatus(context, git);
      if (!status.hasOrigin) {
        throw new Error('The worktree has no origin remote.');
      }
      if (!status.hasUnpushedCommits) {
        throw new Error('There are no commits to push.');
      }
      await git.raw(
        status.hasUpstream
          ? ['push', 'origin', status.currentBranch]
          : [
              'push',
              '--set-upstream',
              'origin',
              status.currentBranch,
            ],
      );
      return loadStatus(context, git);
    },

    async createPullRequest({
      worktreeId,
      title,
      body,
      baseBranch,
    }) {
      const { context, git } = await getClient(worktreeId);
      if (isLocalRepository(context.repository)) {
        throw new Error(
          'Pull requests require a GitHub-linked repository.',
        );
      }
      const status = await loadStatus(context, git);
      if (!status.pullRequestEligible || status.baseBranch !== baseBranch) {
        throw new Error(
          'Publish the branch before opening a pull request.',
        );
      }
      const octokit = await dependencies.getOctokit();
      const response = await octokit.rest.pulls.create({
        owner: context.repository.ownerLogin,
        repo: context.repository.name,
        head: status.currentBranch,
        base: baseBranch,
        title: title.trim(),
        body,
        draft: false,
      });
      return {
        number: response.data.number,
        url: response.data.html_url,
      };
    },
  };
};

const getProductionContext = (
  worktreeId: string,
): WorkspaceGitContext | undefined => {
  const worktree = getWorktreeById(worktreeId);
  if (!worktree) return undefined;
  const repository = getRepositoryById(worktree.repositoryId);
  if (!repository) return undefined;
  return { worktree, repository };
};

export const workspaceGitService = createWorkspaceGitService({
  getContext: getProductionContext,
  createGitClient: async (context) => {
    const accessToken = isLocalRepository(context.repository)
      ? undefined
      : await getGitHubAccessToken();
    const git = createAuthenticatedGitClient(
      context.worktree.path,
      accessToken,
    );
    return {
      add: (args) => git.add(args),
      commit: (message) => git.commit(message),
      getRemotes: () => git.getRemotes(true),
      raw: (args) => git.raw(args),
      status: async () => {
        const status = await git.status();
        return {
          files: status.files.map(({ path }) => ({ path })),
          current: status.current,
          tracking: status.tracking,
          ahead: status.ahead,
          behind: status.behind,
        };
      },
      logLatestSubject: async () =>
        (await git.log({ maxCount: 1 })).latest?.message ?? null,
    };
  },
  getOctokit: getAuthenticatedOctokit,
});
