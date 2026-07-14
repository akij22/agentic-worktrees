import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../shared/db/schema';

const { getGitHubAccessToken, simpleGit } = vi.hoisted(() => ({
  getGitHubAccessToken: vi.fn(),
  simpleGit: vi.fn(),
}));

vi.mock('../github/octokit', () => ({
  getGitHubAccessToken,
}));

vi.mock('../config/env', () => ({
  getEnvConfig: () => ({ workspaceRoot: '/workspace' }),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn((filePath: string) => filePath === '/workspace/acme'),
  mkdirSync: vi.fn(),
}));

vi.mock('simple-git', () => ({ simpleGit }));

import { ensureClone } from './worktree';

const repository: Repository = {
  id: 'repo-id',
  githubRepoId: 42,
  ownerLogin: 'acme',
  name: 'widgets',
  fullName: 'acme/widgets',
  defaultBranch: 'main',
  isPrivate: true,
  isArchived: false,
  cloneUrl: 'https://github.com/acme/widgets.git',
  sshUrl: 'git@github.com:acme/widgets.git',
  htmlUrl: 'https://github.com/acme/widgets',
  localRootPath: null,
  localCloneStatus: 'not_cloned',
  lastLocalScanAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastSyncedAt: null,
};

describe('Git worktree authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the user token through the Git HTTP header but not clone arguments or errors', async () => {
    const accessToken = 'user-token-that-must-stay-secret';
    const clone = vi.fn((...args: unknown[]) =>
      Promise.reject(new Error(`clone failed: ${JSON.stringify(args)}`)),
    );
    let environment: Record<string, string> | undefined;
    const env = vi.fn((value: Record<string, string>) => {
      environment = value;
      return { clone, env };
    });
    simpleGit.mockReturnValue({ env });
    getGitHubAccessToken.mockResolvedValue(accessToken);

    const error = await ensureClone(repository).catch((caught: unknown) => caught);

    expect(getGitHubAccessToken).toHaveBeenCalledOnce();
    expect(environment).toBeDefined();
    const authorization = environment?.GIT_CONFIG_VALUE_0;
    expect(authorization).toMatch(/^AUTHORIZATION: basic /);
    const encodedCredentials = authorization?.replace('AUTHORIZATION: basic ', '');
    expect(Buffer.from(encodedCredentials ?? '', 'base64').toString('utf8')).toBe(
      `x-access-token:${accessToken}`,
    );
    expect(JSON.stringify(clone.mock.calls)).not.toContain(accessToken);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(accessToken);
  });
});
