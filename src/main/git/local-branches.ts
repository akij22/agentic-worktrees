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

export const createLocalBranch = async (
  repositoryPath: string,
  branchName: string,
): Promise<BranchDto> => {
  const git = simpleGit(repositoryPath);
  await git.raw(['branch', branchName]);
  const branches = await git.branchLocal();
  const branch = branches.branches[branchName];
  if (!branch) {
    throw new Error(`Branch "${branchName}" was not found after creation.`);
  }
  return {
    name: branchName,
    protected: false,
    headCommitSha: branch.commit ?? null,
  };
};
