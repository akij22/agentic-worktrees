import { simpleGit } from 'simple-git';
import type { BranchDto } from '../../shared/ipc/schemas';

export const listLocalBranches = async (
  repositoryPath: string,
): Promise<BranchDto[]> => {
  const git = simpleGit(repositoryPath);
  const summary = await git.branchLocal();

  return summary.all
    .map((name) => ({
      name,
      protected: false,
      headCommitSha: summary.branches[name]?.commit ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};
