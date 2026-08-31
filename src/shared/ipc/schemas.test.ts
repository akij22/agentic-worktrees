import { describe, expect, it } from "vitest";

import {
	capabilityActivateRequestSchema,
	capabilityConfigureRequestSchema,
	capabilityDetailSchema,
	codingAgentAccountUsageSchema,
	codingAgentKindSchema,
	codingAgentModelsRequestSchema,
	codingAgentSessionCreateRequestSchema,
	codingAgentSessionUsageSchema,
	codingAgentSessionViewedRequestSchema,
	conflictPrepareRequestSchema,
	conflictResolutionSessionSchema,
	editorOpenRequestSchema,
	githubAuthStatusSchema,
	githubDeviceChallengeSchema,
	intelligenceOverlapDetailsSchema,
	intelligenceRepositoryRequestSchema,
	intelligenceSnapshotSchema,
	workspaceCommitRequestSchema,
	workspaceDirectoryRequestSchema,
	workspaceFileSearchRequestSchema,
	workspaceFileSearchResponseSchema,
	workspacePullRequestRequestSchema,
	workspaceTerminalResizeRequestSchema,
} from "./schemas";

describe("GitHub authentication IPC schemas", () => {
	it("accepts structured sanitized authentication errors", () => {
		expect(
			githubAuthStatusSchema.parse({
				state: "error",
				profile: null,
				installationCount: 0,
				persistent: true,
				message: "GitHub is temporarily unreachable.",
				errorCode: "network",
				recoverable: true,
				accessToken: "must-not-cross-ipc",
			}),
		).toEqual({
			state: "error",
			profile: null,
			installationCount: 0,
			persistent: true,
			message: "GitHub is temporarily unreachable.",
			errorCode: "network",
			recoverable: true,
		});
	});
	it("accepts a public authentication profile and strips token fields", () => {
		expect(
			githubAuthStatusSchema.parse({
				state: "authenticated",
				profile: {
					id: 1,
					login: "octocat",
					name: "Mona",
					avatarUrl: "https://example.test/a.png",
				},
				installationCount: 1,
				persistent: true,
				accessToken: "must-not-cross-ipc",
			}),
		).not.toHaveProperty("accessToken");
	});

	it("accepts only the public device challenge fields", () => {
		expect(
			githubDeviceChallengeSchema.parse({
				userCode: "ABCD-EFGH",
				verificationUri: "https://github.com/login/device",
				expiresAt: 1_800_000,
			}),
		).toEqual({
			userCode: "ABCD-EFGH",
			verificationUri: "https://github.com/login/device",
			expiresAt: 1_800_000,
		});
	});
});

describe("editor IPC schemas", () => {
	it("accepts known editor IDs and a worktree ID", () => {
		expect(
			editorOpenRequestSchema.parse({
				editorId: "vscode",
				worktreeId: "worktree-123",
			}),
		).toEqual({ editorId: "vscode", worktreeId: "worktree-123" });
	});

	it("rejects unknown editor IDs", () => {
		expect(() =>
			editorOpenRequestSchema.parse({
				editorId: "unknown",
				worktreeId: "worktree-123",
			}),
		).toThrow();
	});

	it("rejects empty worktree IDs after trimming", () => {
		expect(() =>
			editorOpenRequestSchema.parse({ editorId: "vscode", worktreeId: "  " }),
		).toThrow();
	});

	it("rejects filesystem paths instead of a worktree ID", () => {
		expect(() =>
			editorOpenRequestSchema.parse({
				editorId: "vscode",
				worktreePath: "/tmp/untrusted-path",
			}),
		).toThrow();
	});
});

describe("coding agent IPC schemas", () => {
	it("accepts normalized account quota windows without external provider fields", () => {
		expect(
			codingAgentAccountUsageSchema.parse({
				providerId: "openai",
				availability: "available",
				planType: "plus",
				windows: [
					{
						durationMinutes: 300,
						remainingPercentage: 77,
						resetsAt: 1_800_000_000_000,
					},
				],
			}),
		).toEqual({
			providerId: "openai",
			availability: "available",
			planType: "plus",
			windows: [
				{
					durationMinutes: 300,
					remainingPercentage: 77,
					resetsAt: 1_800_000_000_000,
				},
			],
		});
	});

	it("accepts Codex session usage without provider cost data", () => {
		expect(
			codingAgentSessionUsageSchema.parse({
				contextTokens: 40_000,
				contextWindow: 200_000,
				contextPercentage: 20,
				providerId: "openai",
				modelId: "gpt-5.4",
			}),
		).not.toHaveProperty("totalCost");
	});

	it.each(["opencode", "codex"] as const)(
		"accepts the %s harness",
		(agentKind) => {
			expect(codingAgentKindSchema.parse(agentKind)).toBe(agentKind);
		},
	);

	it("requires an explicit harness when creating a session", () => {
		expect(() =>
			codingAgentSessionCreateRequestSchema.parse({
				worktreeId: "worktree-1",
				title: "Chat",
			}),
		).toThrow();
		expect(
			codingAgentSessionCreateRequestSchema.parse({
				agentKind: "codex",
				worktreeId: "worktree-1",
				title: "Chat",
			}),
		).toEqual({ agentKind: "codex", worktreeId: "worktree-1", title: "Chat" });
	});

	it("routes model lookup by session run ID", () => {
		expect(codingAgentModelsRequestSchema.parse({ runId: "run-1" })).toEqual({
			runId: "run-1",
		});
		expect(() =>
			codingAgentModelsRequestSchema.parse({ worktreeId: "worktree-1" }),
		).toThrow();
	});

	it("validates the session viewed acknowledgement by run ID", () => {
		expect(
			codingAgentSessionViewedRequestSchema.parse({ runId: "run-1" }),
		).toEqual({ runId: "run-1" });
		expect(() =>
			codingAgentSessionViewedRequestSchema.parse({ runId: "  " }),
		).toThrow();
	});
});

describe("intelligence IPC schemas", () => {
	const snapshot = {
		id: "snapshot-1",
		repositoryId: "repository-1",
		startedAt: 1,
		completedAt: 2,
		stale: false,
		refreshError: null,
		warnings: [],
		worktrees: [
			{
				worktreeId: "worktree-1",
				runId: "run-1",
				task: "Harden sessions",
				branch: "feat/sessions",
				baseBranch: "main",
				agentKind: "codex",
				agentName: "Codex",
				status: "busy",
				changedFileCount: 1,
				additions: 4,
				deletions: 1,
				files: [
					{
						path: "src/session.ts",
						modulePath: "src",
						additions: 4,
						deletions: 1,
						symbols: ["createSession"],
					},
				],
				independent: false,
				warning: null,
				updatedAt: 2,
			},
		],
		overlaps: [],
	};

	it("accepts a public snapshot and strips unknown fields", () => {
		expect(
			intelligenceSnapshotSchema.parse({
				...snapshot,
				secret: "/tmp/private-worktree",
			}),
		).toEqual(snapshot);
	});

	it("requires a non-empty repository ID", () => {
		expect(
			intelligenceRepositoryRequestSchema.parse({ repositoryId: "repo-1" }),
		).toEqual({ repositoryId: "repo-1" });
		expect(() =>
			intelligenceRepositoryRequestSchema.parse({ repositoryId: " " }),
		).toThrow();
	});

	it("validates focused overlap ranges without leaking internal file data", () => {
		const target = {
			type: "symbol" as const,
			path: "src/session.ts",
			symbol: "createSession",
			leftFilePath: "src/session.ts",
			rightFilePath: "src/session.ts",
			reasonCode: "same-symbol",
			risk: "high" as const,
			leftRanges: [{ oldStart: 1, oldLines: 1, newStart: 2, newLines: 2 }],
			rightRanges: [{ oldStart: 4, oldLines: 1, newStart: 5, newLines: 1 }],
			absolutePath: "/tmp/private/session.ts",
		};
		const details = {
			overlap: {
				id: "overlap-1",
				leftWorktreeId: "worktree-1",
				rightWorktreeId: "worktree-1",
				risk: "high" as const,
				category: "symbol" as const,
				reasonCode: "same-symbol",
				summary: "Both worktrees change createSession",
				actionable: true,
				targets: [target],
			},
			left: snapshot.worktrees[0],
			right: snapshot.worktrees[0],
		};

		const parsed = intelligenceOverlapDetailsSchema.parse(details);
		expect(parsed.overlap.targets[0]).toMatchObject({
			leftRanges: target.leftRanges,
			rightRanges: target.rightRanges,
		});
		expect(parsed.overlap.targets[0]).not.toHaveProperty("absolutePath");
		expect(() =>
			intelligenceOverlapDetailsSchema.parse({
				...details,
				overlap: {
					...details.overlap,
					targets: [
						{
							...target,
							leftRanges: [{ oldStart: -1, oldLines: 1, newStart: 2, newLines: 2 }],
						},
					],
				},
			}),
		).toThrow();
	});

	it("accepts safe conflict targets and rejects option-like branch names", () => {
		expect(
			conflictPrepareRequestSchema.parse({
				overlapId: "overlap-1",
				targetBranch: "release/next",
			}),
		).toEqual({ overlapId: "overlap-1", targetBranch: "release/next" });
		expect(() =>
			conflictPrepareRequestSchema.parse({
				overlapId: "overlap-1",
				targetBranch: "--upload-pack=evil",
			}),
		).toThrow();
	});

	it("rejects unknown persisted preparation states", () => {
		expect(() =>
			conflictResolutionSessionSchema.parse({
				id: "session-1",
				repositoryId: "repository-1",
				snapshotId: "snapshot-1",
				overlapId: "overlap-1",
				targetBranch: "main",
				targetCommitSha: null,
				state: "guessed-safe",
				classification: null,
				currentStage: "Unknown",
				integrationBranch: null,
				integrationPath: null,
				retained: false,
				cleanupPending: false,
				errorMessage: null,
				participants: [],
				files: [],
				operations: [],
				createdAt: 1,
				updatedAt: 1,
				completedAt: null,
			}),
		).toThrow();
	});
});

describe("workspace IPC schemas", () => {
	it("validates bounded worktree file searches", () => {
		expect(
			workspaceFileSearchRequestSchema.parse({
				worktreeId: "worktree-1",
				query: "composer",
				limit: 20,
			}),
		).toEqual({
			worktreeId: "worktree-1",
			query: "composer",
			limit: 20,
		});
		expect(() =>
			workspaceFileSearchRequestSchema.parse({
				worktreeId: "worktree-1",
				query: "x".repeat(513),
				limit: 20,
			}),
		).toThrow();
		expect(() =>
			workspaceFileSearchRequestSchema.parse({
				worktreeId: "worktree-1",
				query: "",
				limit: 101,
			}),
		).toThrow();
	});

	it("accepts only safe relative file-search results", () => {
		expect(
			workspaceFileSearchResponseSchema.parse([
				"src/renderer/App.tsx",
				"README.md",
			]),
		).toEqual(["src/renderer/App.tsx", "README.md"]);
		expect(() =>
			workspaceFileSearchResponseSchema.parse(["/tmp/secret.txt"]),
		).toThrow();
	});

	it("accepts worktree-relative directory requests", () => {
		expect(
			workspaceDirectoryRequestSchema.parse({
				worktreeId: "worktree-1",
				relativePath: "src/renderer",
			}),
		).toEqual({
			worktreeId: "worktree-1",
			relativePath: "src/renderer",
		});
	});

	it.each([
		"../outside",
		"src/../../outside",
		"/Users/example/project",
		"\\\\server\\share",
		"C:\\workspace",
	])("rejects unsafe workspace path %s", (relativePath) => {
		expect(() =>
			workspaceDirectoryRequestSchema.parse({
				worktreeId: "worktree-1",
				relativePath,
			}),
		).toThrow();
	});

	it("bounds terminal dimensions", () => {
		expect(() =>
			workspaceTerminalResizeRequestSchema.parse({
				worktreeId: "worktree-1",
				terminalId: "terminal-1",
				cols: 0,
				rows: 24,
			}),
		).toThrow();
		expect(
			workspaceTerminalResizeRequestSchema.parse({
				worktreeId: "worktree-1",
				terminalId: "terminal-1",
				cols: 120,
				rows: 32,
			}),
		).toEqual({
			worktreeId: "worktree-1",
			terminalId: "terminal-1",
			cols: 120,
			rows: 32,
		});
	});

	it("requires a non-empty commit message", () => {
		expect(() =>
			workspaceCommitRequestSchema.parse({
				worktreeId: "worktree-1",
				message: "   ",
			}),
		).toThrow();
		expect(
			workspaceCommitRequestSchema.parse({
				worktreeId: "worktree-1",
				message: "Add workspace panel",
			}),
		).toEqual({
			worktreeId: "worktree-1",
			message: "Add workspace panel",
		});
	});

	it("accepts editable pull request metadata", () => {
		expect(
			workspacePullRequestRequestSchema.parse({
				worktreeId: "worktree-1",
				title: "Add workspace panel",
				body: "Implements integrated workspace tools.",
				baseBranch: "main",
			}),
		).toEqual({
			worktreeId: "worktree-1",
			title: "Add workspace panel",
			body: "Implements integrated workspace tools.",
			baseBranch: "main",
		});
	});
});


describe("capability IPC schemas", () => {
	it("validates activation and keyless configuration requests", () => {
		expect(capabilityActivateRequestSchema.parse({ runId: "run-1", capabilityId: "agentic-worktrees.web-search" })).toEqual({ runId: "run-1", capabilityId: "agentic-worktrees.web-search" });
		expect(capabilityConfigureRequestSchema.parse({
			capabilityId: "agentic-worktrees.web-search",
			acceptedPermissionDigest: "digest",
			settings: { providerMode: "auto", resultLimit: 5 },
			secrets: { exaApiKey: null },
			bearerToken: "must-not-cross-ipc",
		})).toEqual({
			capabilityId: "agentic-worktrees.web-search",
			acceptedPermissionDigest: "digest",
			settings: { providerMode: "auto", resultLimit: 5 },
			secrets: { exaApiKey: null },
		});
		expect(() => capabilityConfigureRequestSchema.parse({
			capabilityId: "agentic-worktrees.url-fetch",
			acceptedPermissionDigest: "digest",
			settings: { nested: { unsafe: true } },
			secrets: {},
		})).toThrow();
	});

	it("strips private fields from capability details", () => {
		const parsed = capabilityDetailSchema.parse({ id: "agentic-worktrees.web-search", name: "Web Search", version: "0.1.0", description: "Search", category: "web-browser", compatibility: { codex: "supported", opencode: "supported" }, state: "ready", secretConfigured: false, sdkVersion: "^0.1.0", author: { name: "Agentic Worktrees" }, license: "MIT", permissions: { network: [], secrets: [] }, settings: [], reviewStatus: "bundled-reviewed", providedTools: ["web_search"], permissionDigest: "digest", bearerToken: "private" });
		expect(parsed).not.toHaveProperty("bearerToken");
	});
});
