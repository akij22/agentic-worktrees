import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Repository, Worktree } from '../../../../shared/db/schema';
import { RepositorySidebar } from './RepositorySidebar';
import { RepositoryWorkspace } from './RepositoryWorkspace';
import type { WorktreeChatSummaryState } from '../hooks/use-worktree-chat-summary';

const repository: Repository = {
  id: 'repository',
  githubRepoId: 42,
  ownerLogin: 'owner',
  name: 'agentic-worktrees',
  fullName: 'owner/agentic-worktrees',
  defaultBranch: 'main',
  isPrivate: true,
  isArchived: false,
  cloneUrl: 'https://example.com/repository.git',
  sshUrl: null,
  htmlUrl: 'https://example.com/repository',
  localRootPath: '/workspace/agentic-worktrees',
  localCloneStatus: 'ready',
  lastLocalScanAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastSyncedAt: null,
};

const worktree: Worktree = {
  id: 'worktree',
  repositoryId: repository.id,
  name: 'dashboard-redesign',
  path: '/workspace/.worktrees/dashboard-redesign',
  branchName: 'feat/redesign-dashboard-ui',
  baseBranchName: 'main',
  headCommitSha: null,
  status: 'ready',
  activeRunId: 'run',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastSyncedAt: null,
};

const chatSummary: WorktreeChatSummaryState = {
  status: 'ready',
  snapshot: {
    session: {
      id: 'run',
      agentKind: 'opencode',
      agentName: 'OpenCode',
      worktreeId: worktree.id,
      repositoryId: repository.id,
      title: 'Dashboard work',
      status: 'busy',
      errorMessage: null,
      providerId: 'provider',
      modelId: 'model',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    context: { worktree, repository },
    messages: [
      {
        id: 'message',
        role: 'assistant',
        content: 'Implemented the repository workspace.',
        reasoning: '',
        createdAt: 0,
        completedAt: 0,
      },
    ],
    diff: [
      {
        file: 'src/renderer/pages/Dashboard.tsx',
        before: '',
        after: '',
        additions: 12,
        deletions: 3,
      },
    ],
    turnDiff: [
      {
        file: 'src/renderer/pages/Dashboard.tsx',
        before: '',
        after: '',
        additions: 12,
        deletions: 3,
      },
    ],
  },
};

describe('Dashboard repository workspace components', () => {
  it('renders the repository navigation and marks the selected repository', () => {
    const markup = renderToStaticMarkup(
      <RepositorySidebar
        repositories={[repository]}
        selectedRepositoryId={repository.id}
        branchLists={{
          [repository.id]: {
            status: 'ready',
            branches: [
              {
                name: 'main',
                protected: true,
                headCommitSha: 'abc123',
              },
              {
                name: worktree.branchName,
                protected: false,
                headCommitSha: null,
              },
              {
                name: 'feat/idle-chat',
                protected: false,
                headCommitSha: null,
              },
            ],
          },
        }}
        branchChatStatuses={{
          [repository.id]: {
            [worktree.branchName]: {
              status: 'busy',
              errorMessage: null,
            },
            'feat/idle-chat': {
              status: 'idle',
              errorMessage: null,
            },
          },
        }}
        query=""
        loading={false}
        onAdd={() => undefined}
        onBranchesRequested={() => undefined}
        onRefresh={() => undefined}
        onQueryChange={() => undefined}
        onSelect={() => undefined}
      />,
    );

    expect(markup).toContain('Repositories');
    expect(markup).toContain(repository.fullName);
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('Search repositories');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('main');
    expect(markup).toContain(worktree.branchName);
    expect(markup).toContain('Protected branch');
    expect(markup.match(/Coding agent chat: Chat/g)).toHaveLength(2);
    expect(markup).not.toContain('Active');
    expect(markup).not.toContain('Running');
    expect(markup).not.toContain('Coding agent chat: Idle');
    expect(markup).not.toContain('Coding Agent');
    expect(markup).not.toContain('Settings');
  });

  it('renders the selected worktree and its contextual action', () => {
    const markup = renderToStaticMarkup(
      <RepositoryWorkspace
        repository={repository}
        worktrees={[worktree]}
        selectedWorktreeId={worktree.id}
        chatSummary={chatSummary}
        onCreateWorktree={() => undefined}
        onOpenCodingAgent={() => undefined}
        onSelectWorktree={() => undefined}
      />,
    );

    expect(markup).toContain(repository.fullName);
    expect(markup).toContain(worktree.branchName);
    expect(markup).toContain(worktree.path);
    expect(markup).toContain('Open Coding Agent');
    expect(markup).toContain('Latest message');
    expect(markup).toContain('Implemented the repository workspace.');
    expect(markup).toContain('Changed files');
    expect(markup).toContain('src/renderer/pages/Dashboard.tsx');
    expect(markup).toContain('aria-current="true"');
  });
});
