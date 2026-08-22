// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
      hasUnviewedChanges: false,
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
        tools: [],
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

afterEach(() => cleanup());

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
        branchList={{
          status: 'ready',
          branches: [
            { name: 'main', protected: true, headCommitSha: 'main-sha' },
            {
              name: worktree.branchName,
              protected: false,
              headCommitSha: worktree.headCommitSha,
            },
          ],
        }}
        selectedWorktreeId={worktree.id}
        sessionsByWorktreeId={{
          [worktree.id]: chatSummary.snapshot.session,
        }}
        chatSummary={chatSummary}
        onBranchesRequested={() => undefined}
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
    expect(markup).not.toContain('<span>Status</span>');
  });

  it('renders the four chat states in the worktree table', () => {
    const readyWorktree = {
      ...worktree,
      id: 'ready-worktree',
      name: 'ready-worktree',
      activeRunId: null,
    };
    const completedWorktree = {
      ...worktree,
      id: 'completed-worktree',
      name: 'completed-worktree',
      activeRunId: 'completed-run',
    };
    const errorWorktree = {
      ...worktree,
      id: 'error-worktree',
      name: 'error-worktree',
      activeRunId: 'error-run',
    };
    const session = chatSummary.snapshot.session;
    const markup = renderToStaticMarkup(
      <RepositoryWorkspace
        repository={repository}
        worktrees={[readyWorktree, worktree, completedWorktree, errorWorktree]}
        branchList={{
          status: 'ready',
          branches: [
            { name: 'main', protected: true, headCommitSha: 'main-sha' },
            {
              name: worktree.branchName,
              protected: false,
              headCommitSha: worktree.headCommitSha,
            },
          ],
        }}
        selectedWorktreeId={worktree.id}
        sessionsByWorktreeId={{
          [worktree.id]: session,
          [completedWorktree.id]: {
            ...session,
            id: 'completed-run',
            worktreeId: completedWorktree.id,
            status: 'idle',
            hasUnviewedChanges: true,
          },
          [errorWorktree.id]: {
            ...session,
            id: 'error-run',
            worktreeId: errorWorktree.id,
            status: 'error',
            errorMessage: 'Agent failed.',
          },
        }}
        chatSummary={chatSummary}
        onBranchesRequested={() => undefined}
        onCreateWorktree={() => undefined}
        onOpenCodingAgent={() => undefined}
        onSelectWorktree={() => undefined}
      />,
    );

    expect(markup).toContain('Chat status');
    expect(markup).toContain('Ready');
    expect(markup).toContain('Running');
    expect(markup).toContain('Completed');
    expect(markup).toContain('Error');
    expect(markup).not.toContain('>Active<');
  });

  it('renders repository summaries and the loaded branch table', () => {
    const markup = renderToStaticMarkup(
      <RepositoryWorkspace
        repository={repository}
        worktrees={[worktree]}
        branchList={{
          status: 'ready',
          branches: [
            { name: 'main', protected: true, headCommitSha: 'main-sha' },
            { name: 'feat/new-work', protected: false, headCommitSha: null },
          ],
        }}
        selectedWorktreeId={worktree.id}
        sessionsByWorktreeId={{
          [worktree.id]: chatSummary.snapshot.session,
        }}
        chatSummary={chatSummary}
        onBranchesRequested={() => undefined}
        onCreateWorktree={() => undefined}
        onOpenCodingAgent={() => undefined}
        onSelectWorktree={() => undefined}
      />,
    );

    expect(markup).toContain('Default branch');
    expect(markup).toContain('Branches');
    expect(markup).toContain('2 branches');
    expect(markup).toContain('Worktrees');
    expect(markup).toContain('1 worktree');
    expect(markup).toContain('feat/new-work');
    expect(markup).toContain('Protected');
  });

  it.each([
    [{ status: 'loading' as const }, 'Loading branches'],
    [
      { status: 'error' as const, message: 'Branch request failed.' },
      'Could not load branches',
    ],
    [{ status: 'ready' as const, branches: [] }, 'No branches found'],
  ])('renders branch state %j', (branchList, expected) => {
    const markup = renderToStaticMarkup(
      <RepositoryWorkspace
        repository={repository}
        worktrees={[]}
        branchList={branchList}
        sessionsByWorktreeId={{}}
        chatSummary={{ status: 'idle' }}
        onBranchesRequested={() => undefined}
        onCreateWorktree={() => undefined}
        onOpenCodingAgent={() => undefined}
        onSelectWorktree={() => undefined}
      />,
    );

    expect(markup).toContain(expected);
  });

  it('opens the Coding Agent from a branch with an existing worktree', () => {
    const onOpenCodingAgent = vi.fn();
    render(
      <RepositoryWorkspace
        repository={repository}
        worktrees={[worktree]}
        branchList={{
          status: 'ready',
          branches: [
            {
              name: worktree.branchName,
              protected: false,
              headCommitSha: worktree.headCommitSha,
            },
          ],
        }}
        selectedWorktreeId={worktree.id}
        sessionsByWorktreeId={{
          [worktree.id]: chatSummary.snapshot.session,
        }}
        chatSummary={chatSummary}
        onBranchesRequested={() => undefined}
        onCreateWorktree={() => undefined}
        onOpenCodingAgent={onOpenCodingAgent}
        onSelectWorktree={() => undefined}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: `Open Coding Agent for ${worktree.branchName}`,
      }),
    );

    expect(onOpenCodingAgent).toHaveBeenCalledWith(worktree);
  });

  it('requests a worktree with the clicked branch preselected', () => {
    const onCreateWorktree = vi.fn();
    render(
      <RepositoryWorkspace
        repository={repository}
        worktrees={[]}
        branchList={{
          status: 'ready',
          branches: [
            {
              name: 'feat/new-work',
              protected: false,
              headCommitSha: null,
            },
          ],
        }}
        sessionsByWorktreeId={{}}
        chatSummary={{ status: 'idle' }}
        onBranchesRequested={() => undefined}
        onCreateWorktree={onCreateWorktree}
        onOpenCodingAgent={() => undefined}
        onSelectWorktree={() => undefined}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Create worktree from feat/new-work',
      }),
    );

    expect(onCreateWorktree).toHaveBeenCalledWith(repository, 'feat/new-work');
  });
});
