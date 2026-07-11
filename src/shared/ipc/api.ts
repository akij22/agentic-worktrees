import type { Repository, Worktree } from '../db/schema';
import type { BranchDto, RemoteRepositoryDto } from './schemas';

export interface Api {
  github: {
    listRepos: (request?: { refresh?: boolean }) => Promise<Repository[]>;
    listRemoteRepos: () => Promise<RemoteRepositoryDto[]>;
    listBranches: (request: {
      repositoryId: string;
    }) => Promise<BranchDto[]>;
  };
  repositories: {
    importLocal: () => Promise<Repository | null>;
    importRemote: (request: { repositoryIds: number[] }) => Promise<Repository[]>;
  };
  worktrees: {
    create: (request: {
      repositoryId: string;
      baseBranch: string;
      newBranchName: string;
      worktreeName: string;
    }) => Promise<{ worktree: Worktree; repository: Repository }>;
    list: (request: { repositoryId: string }) => Promise<Worktree[]>;
  };
}
