import type { Repository, Worktree } from "../db/schema";
import type {
	BranchDto,
	CodingAgentKindDto,
	CodingAgentModelDto,
	CodingAgentSessionDto,
	CodingAgentSessionSnapshotDto,
	CodingAgentSessionUsageDto,
	CodingAgentStatusDto,
	CodingAgentUiEventDto,
	CodingAgentWorktreeContextDto,
	ConflictResolutionSessionDto,
	ConflictResolutionSessionEventDto,
	AvailableEditorDto,
	EditorId,
	GitHubAuthStatusDto,
	GitHubDeviceChallengeDto,
	IntelligenceDiffComparisonDto,
	IntelligenceOverlapDetailsDto,
	IntelligenceSnapshotDto,
	IntelligenceSnapshotEventDto,
	RemoteRepositoryDto,
	WorkspaceEntryDto,
	WorkspaceFileSearchResultDto,
	WorkspaceFilePreviewDto,
	WorkspaceGitStatusDto,
	WorkspacePullRequestResultDto,
	WorkspaceTerminalEventDto,
} from "./schemas";

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
		listBranches: (request: { repositoryId: string }) => Promise<BranchDto[]>;
		createBranch: (request: {
			repositoryId: string;
			branchName: string;
		}) => Promise<BranchDto>;
	};
	repositories: {
		importLocal: () => Promise<Repository | null>;
		importRemote: (request: {
			repositoryIds: number[];
		}) => Promise<Repository[]>;
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
	workspace: {
		files: {
			listDirectory: (request: {
				worktreeId: string;
				relativePath: string;
			}) => Promise<WorkspaceEntryDto[]>;
			readFile: (request: {
				worktreeId: string;
				relativePath: string;
			}) => Promise<WorkspaceFilePreviewDto>;
			search: (request: {
				worktreeId: string;
				query: string;
				limit?: number;
			}) => Promise<WorkspaceFileSearchResultDto>;
		};
		terminal: {
			create: (request: {
				worktreeId: string;
				cols: number;
				rows: number;
			}) => Promise<{ terminalId: string }>;
			write: (request: {
				worktreeId: string;
				terminalId: string;
				data: string;
			}) => Promise<void>;
			resize: (request: {
				worktreeId: string;
				terminalId: string;
				cols: number;
				rows: number;
			}) => Promise<void>;
			restart: (request: {
				worktreeId: string;
				terminalId: string;
				cols: number;
				rows: number;
			}) => Promise<void>;
			dispose: (request: {
				worktreeId: string;
				terminalId: string;
			}) => Promise<void>;
			onEvent: (
				listener: (event: WorkspaceTerminalEventDto) => void,
			) => () => void;
		};
		git: {
			getStatus: (request: {
				worktreeId: string;
			}) => Promise<WorkspaceGitStatusDto>;
			commit: (request: {
				worktreeId: string;
				message: string;
			}) => Promise<WorkspaceGitStatusDto>;
			push: (request: { worktreeId: string }) => Promise<WorkspaceGitStatusDto>;
			openPullRequest: (request: {
				worktreeId: string;
				title: string;
				body: string;
				baseBranch: string;
			}) => Promise<WorkspacePullRequestResultDto>;
		};
	};
	intelligence: {
		listRepositories: () => Promise<Repository[]>;
		getSnapshot: (request: {
			repositoryId: string;
		}) => Promise<IntelligenceSnapshotDto | null>;
		refresh: (request: {
			repositoryId: string;
		}) => Promise<IntelligenceSnapshotDto>;
		getOverlap: (request: {
			overlapId: string;
		}) => Promise<IntelligenceOverlapDetailsDto>;
		compareDiffs: (request: {
			overlapId: string;
			targetId?: string;
		}) => Promise<IntelligenceDiffComparisonDto>;
		listTargetBranches: (request: {
			repositoryId: string;
		}) => Promise<BranchDto[]>;
		prepareConflict: (request: {
			overlapId: string;
			targetBranch: string;
		}) => Promise<ConflictResolutionSessionDto>;
		getResolutionSession: (request: {
			sessionId: string;
		}) => Promise<ConflictResolutionSessionDto>;
		listResolutionSessions: (request: {
			repositoryId: string;
			overlapId?: string;
		}) => Promise<ConflictResolutionSessionDto[]>;
		openIntegrationWorktree: (request: {
			sessionId: string;
			editorId: EditorId;
		}) => Promise<void>;
		onSnapshotChanged: (
			listener: (event: IntelligenceSnapshotEventDto) => void,
		) => () => void;
		onResolutionSessionChanged: (
			listener: (event: ConflictResolutionSessionEventDto) => void,
		) => () => void;
	};
	codingAgent: {
		selectExecutable: (request: {
			agentKind: CodingAgentKindDto;
		}) => Promise<CodingAgentStatusDto | null>;
		getStatus: () => Promise<CodingAgentStatusDto>;
		listModels: (request: { runId: string }) => Promise<CodingAgentModelDto[]>;
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
		markSessionViewed: (request: { runId: string }) => Promise<void>;
		getSessionUsage: (request: {
			runId: string;
		}) => Promise<CodingAgentSessionUsageDto>;
		sendMessage: (request: {
			runId: string;
			content: string;
			reasoningVariant?: string;
		}) => Promise<void>;
		compactSession: (request: { runId: string }) => Promise<void>;
		abortSession: (request: { runId: string }) => Promise<void>;
		respondPermission: (request: {
			runId: string;
			permissionId: string;
			response: "once" | "always" | "reject";
		}) => Promise<void>;
		onEvent: (listener: (event: CodingAgentUiEventDto) => void) => () => void;
	};
}
