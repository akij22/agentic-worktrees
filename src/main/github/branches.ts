import { getInstallationOctokit } from './octokit';

export interface RemoteBranch {
  name: string;
  protected: boolean;
  headCommitSha: string | null;
}

export const listBranches = async (
  owner: string,
  repo: string,
): Promise<RemoteBranch[]> => {
  const octokit = await getInstallationOctokit();
  const branches: RemoteBranch[] = [];

  for await (const response of octokit.paginate.iterator(
    octokit.rest.repos.listBranches,
    {
      owner,
      repo,
      per_page: 100,
    },
  )) {
    for (const branch of response.data) {
      branches.push({
        name: branch.name,
        protected: branch.protected ?? false,
        headCommitSha: branch.commit?.sha ?? null,
      });
    }
  }

  return branches;
};