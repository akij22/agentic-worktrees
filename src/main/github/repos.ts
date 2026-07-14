import { getAuthenticatedOctokit } from './octokit';

interface UserInstallationsResponse {
  installations: Array<{ id: number }>;
}

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
  const octokit = await getAuthenticatedOctokit();
  const repositoriesById = new Map<number, InstallationRepo>();

  for await (const installationResponse of octokit.paginate.iterator(
    octokit.rest.apps.listInstallationsForAuthenticatedUser,
    {
      per_page: 100,
    },
  )) {
    const installationData = installationResponse.data as unknown as
      | UserInstallationsResponse
      | UserInstallationsResponse['installations'];
    const installations = Array.isArray(installationData)
      ? installationData
      : installationData.installations ?? [];
    for (const installation of installations) {
      for await (const repositoryResponse of octokit.paginate.iterator(
        'GET /user/installations/{installation_id}/repositories',
        {
          installation_id: installation.id,
          per_page: 100,
        },
      )) {
        const repositoryData = repositoryResponse.data as
          | InstallationRepositoriesResponse
          | InstallationRepositoriesResponse['repositories'];
        const repositories = Array.isArray(repositoryData)
          ? repositoryData
          : repositoryData.repositories ?? [];
        for (const repo of repositories) {
          if (repositoriesById.has(repo.id)) {
            continue;
          }
          repositoriesById.set(repo.id, {
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
    }
  }

  const repositories = [...repositoriesById.values()];
  repositories.sort((a, b) => a.fullName.localeCompare(b.fullName));

  return repositories;
};
