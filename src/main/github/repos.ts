import { getInstallationOctokit } from './octokit';

interface InstallationRepositoriesResponse {
  total_count: number;
  repositories: Array<{
    id: number;
    name: string;
    full_name: string;
    private: boolean | null;
    archived: boolean | null;
    default_branch: string | null;
    clone_url: string;
    ssh_url: string | null;
    html_url: string;
    owner: { login: string } | null;
  }>;
}

interface InstallationRepo {
  githubRepoId: number;
  ownerLogin: string;
  name: string;
  fullName: string;
  defaultBranch: string | null;
  isPrivate: boolean;
  isArchived: boolean;
  cloneUrl: string;
  sshUrl: string | null;
  htmlUrl: string;
}

export type { InstallationRepo as RemoteRepository };

export const listRemoteRepositories = async (): Promise<InstallationRepo[]> => {
  const octokit = await getInstallationOctokit();

  const repositories: InstallationRepo[] = [];

  const endpoint = octokit.rest.apps.listReposAccessibleToInstallation;

  for await (const response of octokit.paginate.iterator(
    endpoint as unknown as string,
    {
      per_page: 100,
    } as Record<string, unknown>,
  )) {
    const data = response.data as
      | InstallationRepositoriesResponse
      | InstallationRepositoriesResponse['repositories'];
    const items = Array.isArray(data) ? data : data.repositories ?? [];
    for (const repo of items) {
      repositories.push({
        githubRepoId: repo.id,
        ownerLogin: repo.owner?.login ?? repo.full_name.split('/')[0],
        name: repo.name,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch ?? null,
        isPrivate: repo.private ?? false,
        isArchived: repo.archived ?? false,
        cloneUrl: repo.clone_url,
        sshUrl: repo.ssh_url ?? null,
        htmlUrl: repo.html_url,
      });
    }
  }

  repositories.sort((a, b) => a.fullName.localeCompare(b.fullName));

  return repositories;
};
