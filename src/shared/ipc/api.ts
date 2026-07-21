import type { Repository, Worktree } from '../db/schema';
import type {
  BranchDto,
  CodingAgentKindDto,
  CodingAgentModelDto,
  CodingAgentSessionDto,
  CodingAgentSessionSnapshotDto,
  CodingAgentStatusDto,
  CodingAgentUiEventDto,
  CodingAgentWorktreeContextDto,
  AvailableEditorDto,
  EditorId,
  GitHubAuthStatusDto,
  GitHubDeviceChallengeDto,
  RemoteRepositoryDto,
} from './schemas';

export interface Api {
  github: {
    auth: {
      getStatus: () => Promise<GitHubAuthStatusDto>;
      startLogin: () => Promise<GitHubDeviceChallengeDto>;
      completeLogin: () => Promise<GitHubAuthStatusDto>;
      cancelLogin: () => Promise<void>;
      refreshInstallations: () => Promise<GitHubAuthStatusDto>;
      logout: () => Promise<GitHubAuthStatusDto>;
      retrySession: () => Promise<GitHubAuthStatusDto>;
      onStatusChanged: (
        listener: (status: GitHubAuthStatusDto) => void,
      ) => () => void;
      openDeviceVerification: () => Promise<void>;
      openInstallation: () => Promise<void>;
      openAuthorizationSettings: () => Promise<void>;
    };
    listRepos: (request?: { refresh?: boolean }) => Promise<Repository[]>;
    listRemoteRepos: () => Promise<RemoteRepositoryDto[]>;
    listBranches: (request: {
      repositoryId: string;
    }) => Promise<BranchDto[]>;
    createBranch: (request: {
      repositoryId: string;
      branchName: string;
    }) => Promise<BranchDto>;
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
    selectExecutable: (request: {
      agentKind: CodingAgentKindDto;
    }) => Promise<CodingAgentStatusDto | null>;
    getStatus: () => Promise<CodingAgentStatusDto>;
    listModels: (request: {
      runId: string;
    }) => Promise<CodingAgentModelDto[]>;
    listWorktrees: () => Promise<CodingAgentWorktreeContextDto[]>;
    listSessions: (request?: {
      worktreeId?: string;
    }) => Promise<CodingAgentSessionDto[]>;
    createSession: (request: {
      agentKind: CodingAgentKindDto;
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
