import { describe, expect, it, vi } from "vitest";
import type { BranchDto } from "../../shared/ipc/schemas";
import type { IntelligenceRepository } from "../intelligence/intelligence-repository";
import type { ConflictResolutionRepository } from "./conflict-resolution-repository";
import type { IntegrationWorktreeService } from "./integration-worktree-service";
import type { PreparedConflictSession } from "./types";
import { createConflictIntelligenceService } from "./conflict-intelligence-service";

const overlapDetails = {
	repositoryId: "repository",
	snapshotId: "snapshot",
	overlap: {
		id: "overlap",
		leftWorktreeId: "left",
		rightWorktreeId: "right",
		risk: "high" as const,
		category: "symbol" as const,
		reasonCode: "same-symbol",
		summary: "same symbol",
		actionable: true,
		targets: [
			{
				type: "symbol" as const,
				path: "src/session.ts",
				symbol: "createSession",
				leftFilePath: "src/session.ts",
				rightFilePath: "src/session.ts",
				reasonCode: "same-symbol",
				risk: "high" as const,
			},
		],
	},
	left: {
		id: "iw-left",
		worktreeId: "left",
		runId: "run-left",
		task: "Left",
		branch: "feat/left",
		baseBranch: "main",
		agentKind: "codex" as const,
		agentName: "Codex",
		status: "idle",
		additions: 1,
		deletions: 0,
		independent: false,
		warning: null,
		updatedAt: 1,
		files: [],
	},
	right: {
		id: "iw-right",
		worktreeId: "right",
		runId: "run-right",
		task: "Right",
		branch: "feat/right",
		baseBranch: "main",
		agentKind: "opencode" as const,
		agentName: "OpenCode",
		status: "idle",
		additions: 1,
		deletions: 0,
		independent: false,
		warning: null,
		updatedAt: 1,
		files: [],
	},
};

const createDependencies = () => {
	const sessions = new Map<string, PreparedConflictSession>();
	const resolutionRepository: ConflictResolutionRepository = {
		createSession: vi.fn((session) => {
			sessions.set(session.id, structuredClone(session));
			return structuredClone(session);
		}),
		saveSession: vi.fn((session) => {
			sessions.set(session.id, structuredClone(session));
			return structuredClone(session);
		}),
		getSession: vi.fn((id) => sessions.get(id) ?? null),
		listSessions: vi.fn(() => [...sessions.values()]),
		findActive: vi.fn(() => null),
	};
	const lifecycle: IntegrationWorktreeService = {
		prepare: vi.fn(async (input) => {
			input.onStage?.("capturing", "Capturing complete worktree deltas");
			input.onStage?.("simulating", "Simulating merge with Git");
			input.onStage?.(
				"preparing_sandbox",
				"Preparing isolated integration sandbox",
			);
			return {
				targetCommitSha: "target-sha",
				classification: "review_required" as const,
				participants: [],
				files: [],
				integrationBranch: "agentic/integration/session-1",
				integrationPath: "/integration/session-1",
				retained: true,
				cleanupPending: false,
			};
		}),
	};
	const intelligenceRepository = {
		getOverlap: vi.fn(() => overlapDetails),
	} as unknown as IntelligenceRepository;
	const branches: BranchDto[] = [
		{ name: "main", protected: false, headCommitSha: "target-sha" },
	];
	return {
		resolutionRepository,
		lifecycle,
		intelligenceRepository,
		getRepository: vi.fn(() => ({
			id: "repository",
			localRootPath: "/repo",
			defaultBranch: "main",
		})),
		getWorktree: vi.fn((id: string) => ({
			id,
			repositoryId: "repository",
			path: `/${id}`,
			branchName: `feat/${id}`,
		})),
		listBranches: vi.fn(async () => branches),
		createId: vi.fn(() => "session-1"),
		now: vi.fn(() => 1_700_000_000_000),
	};
};

describe("ConflictIntelligenceService", () => {
	it("persists truthful stages and a terminal review session", async () => {
		const dependencies = createDependencies();
		const service = createConflictIntelligenceService(dependencies);
		const events: string[] = [];
		service.onSessionChanged(({ state }) => events.push(state));

		const result = await service.prepareConflict({
			overlapId: "overlap",
			targetBranch: "main",
		});

		expect(result).toMatchObject({
			state: "review_required",
			classification: "review_required",
			retained: true,
		});
		expect(result.operations.map(({ kind }) => kind)).toEqual([
			"capture",
			"simulate",
			"prepare-sandbox",
		]);
		expect(events).toEqual([
			"requested",
			"capturing",
			"simulating",
			"preparing_sandbox",
			"review_required",
		]);
	});

	it("rejects an unavailable target before creating a session", async () => {
		const dependencies = createDependencies();
		const service = createConflictIntelligenceService(dependencies);

		await expect(
			service.prepareConflict({
				overlapId: "overlap",
				targetBranch: "missing",
			}),
		).rejects.toThrow(/target branch/i);
		expect(
			dependencies.resolutionRepository.createSession,
		).not.toHaveBeenCalled();
	});

	it("coalesces duplicate in-flight requests", async () => {
		const dependencies = createDependencies();
		let resolve!: () => void;
		const gate = new Promise<void>((done) => {
			resolve = done;
		});
		vi.mocked(dependencies.lifecycle.prepare).mockImplementationOnce(
			async (input) => {
				input.onStage?.("capturing", "Capturing");
				input.onStage?.("simulating", "Simulating merge with Git");
				await gate;
				return {
					targetCommitSha: "target",
					classification: "safe",
					participants: [],
					files: [],
					integrationBranch: null,
					integrationPath: null,
					retained: false,
					cleanupPending: false,
				};
			},
		);
		const service = createConflictIntelligenceService(dependencies);

		const first = service.prepareConflict({
			overlapId: "overlap",
			targetBranch: "main",
		});
		const second = service.prepareConflict({
			overlapId: "overlap",
			targetBranch: "main",
		});
		resolve();
		await expect(Promise.all([first, second])).resolves.toHaveLength(2);
		expect(dependencies.lifecycle.prepare).toHaveBeenCalledTimes(1);
	});

	it("persists a failed terminal session when preparation throws", async () => {
		const dependencies = createDependencies();
		vi.mocked(dependencies.lifecycle.prepare).mockRejectedValueOnce(
			new Error("Git failed"),
		);
		const service = createConflictIntelligenceService(dependencies);

		await expect(
			service.prepareConflict({ overlapId: "overlap", targetBranch: "main" }),
		).rejects.toThrow("Git failed");
		expect(
			dependencies.resolutionRepository.getSession("session-1"),
		).toMatchObject({ state: "failed", errorMessage: "Git failed" });
	});
});
