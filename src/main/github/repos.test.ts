import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAuthenticatedOctokit } = vi.hoisted(() => ({
  getAuthenticatedOctokit: vi.fn(),
}));

vi.mock('./octokit', () => ({
  getAuthenticatedOctokit,
}));

import { listRemoteRepositories } from './repos';

describe('listRemoteRepositories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists repositories for every user installation and deduplicates by repository ID', async () => {
    const listInstallationsForAuthenticatedUser = vi.fn();
    const iterator = vi.fn((endpoint: unknown, parameters: Record<string, unknown>) => {
      if (endpoint === listInstallationsForAuthenticatedUser) {
        expect(parameters).toEqual({ per_page: 100 });
        return (async function* () {
          yield { data: { installations: [{ id: 20 }, { id: 10 }] } };
        })();
      }

      expect(endpoint).toBe(
        'GET /user/installations/{installation_id}/repositories',
      );
      const installationId = parameters.installation_id;
      return (async function* () {
        if (installationId === 20) {
          yield {
            data: {
              repositories: [
                {
                  id: 2,
                  name: 'zeta',
                  full_name: 'octocat/zeta',
                  private: false,
                  archived: false,
                  default_branch: 'main',
                  clone_url: 'https://github.com/octocat/zeta.git',
                  ssh_url: 'git@github.com:octocat/zeta.git',
                  html_url: 'https://github.com/octocat/zeta',
                  owner: { login: 'octocat' },
                },
              ],
            },
          };
        } else {
          yield {
            data: {
              repositories: [
                {
                  id: 1,
                  name: 'alpha',
                  full_name: 'acme/alpha',
                  private: true,
                  archived: null,
                  default_branch: null,
                  clone_url: 'https://github.com/acme/alpha.git',
                  ssh_url: null,
                  html_url: 'https://github.com/acme/alpha',
                  owner: null,
                },
                {
                  id: 2,
                  name: 'duplicate-zeta',
                  full_name: 'octocat/duplicate-zeta',
                  private: false,
                  archived: false,
                  default_branch: 'main',
                  clone_url: 'https://github.com/octocat/duplicate-zeta.git',
                  ssh_url: null,
                  html_url: 'https://github.com/octocat/duplicate-zeta',
                  owner: { login: 'octocat' },
                },
              ],
            },
          };
        }
      })();
    });
    getAuthenticatedOctokit.mockResolvedValue({
      rest: {
        apps: {
          listInstallationsForAuthenticatedUser,
        },
      },
      paginate: { iterator },
    });

    await expect(listRemoteRepositories()).resolves.toEqual([
      {
        githubRepoId: 1,
        ownerLogin: 'acme',
        name: 'alpha',
        fullName: 'acme/alpha',
        defaultBranch: null,
        isPrivate: true,
        isArchived: false,
        cloneUrl: 'https://github.com/acme/alpha.git',
        sshUrl: null,
        htmlUrl: 'https://github.com/acme/alpha',
      },
      {
        githubRepoId: 2,
        ownerLogin: 'octocat',
        name: 'zeta',
        fullName: 'octocat/zeta',
        defaultBranch: 'main',
        isPrivate: false,
        isArchived: false,
        cloneUrl: 'https://github.com/octocat/zeta.git',
        sshUrl: 'git@github.com:octocat/zeta.git',
        htmlUrl: 'https://github.com/octocat/zeta',
      },
    ]);
    expect(iterator).toHaveBeenCalledWith(
      'GET /user/installations/{installation_id}/repositories',
      { installation_id: 20, per_page: 100 },
    );
    expect(iterator).toHaveBeenCalledWith(
      'GET /user/installations/{installation_id}/repositories',
      { installation_id: 10, per_page: 100 },
    );
  });
});
