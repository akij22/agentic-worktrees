import type { Repository, Worktree } from '../db/schema';
import type {
  BranchDto,
  CodingAgentModelDto,
  CodingAgentSessionDto,
  CodingAgentSessionSnapshotDto,
  CodingAgentStatusDto,
  CodingAgentUiEventDto,
  CodingAgentWorktreeContextDto,
  AvailableEditorDto,
  EditorId,
  RemoteRepositoryDto,
} from './schemas';

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
    listAll: () => Promise<Worktree[]>;
  };
  editors: {
    listAvailable: () => Promise<AvailableEditorDto[]>;
    open: (request: {
      editorId: EditorId;
      worktreeId: string;
    }) => Promise<void>;
  };
  codingAgent: {
    selectExecutable: () => Promise<CodingAgentStatusDto | null>;
    getStatus: () => Promise<CodingAgentStatusDto>;
    listModels: (request: {
      worktreeId: string;
    }) => Promise<CodingAgentModelDto[]>;
    listWorktrees: () => Promise<CodingAgentWorktreeContextDto[]>;
    listSessions: (request?: {
      worktreeId?: string;
    }) => Promise<CodingAgentSessionDto[]>;
    createSession: (request: {
      worktreeId: string;
      title: string;
    }) => Promise<CodingAgentSessionDto>;
    setSessionModel: (request: {
      runId: string;
      providerId: string;
      modelId: string;
    }) => Promise<CodingAgentSessionDto>;
    getSession: (request: {
      runId: string;
    }) => Promise<CodingAgentSessionSnapshotDto>;
    sendMessage: (request: {
      runId: string;
      content: string;
      reasoningVariant?: string;
    }) => Promise<void>;
    abortSession: (request: { runId: string }) => Promise<void>;
    respondPermission: (request: {
      runId: string;
      permissionId: string;
      response: 'once' | 'always' | 'reject';
    }) => Promise<void>;
    onEvent: (listener: (event: CodingAgentUiEventDto) => void) => () => void;
  };
}
