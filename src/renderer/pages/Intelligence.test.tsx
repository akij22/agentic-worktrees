// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { Repository } from "../../shared/db/schema";
import type { IntelligenceSnapshotDto } from "../../shared/ipc/schemas";

const mocks = vi.hoisted(() => ({ useIntelligence: vi.fn() }));
vi.mock("../features/intelligence/hooks/use-intelligence", () => ({
	useIntelligence: mocks.useIntelligence,
}));

import { Intelligence } from "./Intelligence";

const repository: Repository = {
	id: "repository",
	githubRepoId: -1,
	ownerLogin: "local",
	name: "repository",
	fullName: "local/repository",
	defaultBranch: "main",
	isPrivate: false,
	isArchived: false,
	cloneUrl: "",
	sshUrl: null,
	htmlUrl: "",
	localRootPath: "/repo",
	localCloneStatus: "ready",
	lastLocalScanAt: null,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	lastSyncedAt: null,
};

const snapshot = (risk: "high" | "low"): IntelligenceSnapshotDto => ({
	id: "snapshot",
	repositoryId: repository.id,
	startedAt: 1,
	completedAt: 2,
	stale: false,
	refreshError: null,
	warnings: [],
	worktrees: [
		{
			worktreeId: "left",
			runId: "left-run",
			task: "Left task",
			branch: "feat/left",
			baseBranch: "main",
			agentKind: "opencode",
			agentName: "OpenCode",
			status: "busy",
			changedFileCount: 1,
			additions: 5,
			deletions: 1,
			files: [
				{
					path: "src/shared.ts",
					modulePath: "src",
					additions: 5,
					deletions: 1,
					symbols: ["shared"],
				},
			],
			independent: false,
			warning: null,
			updatedAt: 1,
		},
		{
			worktreeId: "right",
			runId: "right-run",
			task: "Right task",
			branch: "feat/right",
			baseBranch: "main",
			agentKind: "codex",
			agentName: "Codex",
			status: "busy",
			changedFileCount: 1,
			additions: 3,
			deletions: 2,
			files: [
				{
					path: "src/shared.ts",
					modulePath: "src",
					additions: 3,
					deletions: 2,
					symbols: ["shared"],
				},
			],
			independent: false,
			warning: null,
			updatedAt: 2,
		},
	],
	overlaps: [
		{
			id: "overlap",
			leftWorktreeId: "left",
			rightWorktreeId: "right",
			risk,
			category: risk === "high" ? "symbol" : "folder",
			reasonCode: risk === "high" ? "same-symbol" : "shared-folder",
			summary: `${risk} persisted overlap`,
			actionable: risk === "high",
			targets: [
				{
					type: risk === "high" ? "symbol" : "folder",
					path: "src/shared.ts",
					symbol: risk === "high" ? "shared" : null,
					leftFilePath: "src/shared.ts",
					rightFilePath: "src/shared.ts",
					reasonCode: "evidence",
					risk,
				},
			],
		},
	],
});

const renderPage = (value: IntelligenceSnapshotDto) => {
	mocks.useIntelligence.mockReturnValue({
		repositories: [repository],
		selectedRepositoryId: repository.id,
		selectRepository: vi.fn(),
		snapshot: value,
		loading: false,
		refreshing: false,
		error: undefined,
		refresh: vi.fn(),
	});
	return render(
		<MemoryRouter>
			<Intelligence />
		</MemoryRouter>,
	);
};

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("Intelligence conflict page", () => {
	it("defaults to the first high-risk conflict and excludes the graph", () => {
		renderPage(snapshot("high"));
		expect(
			screen.getByRole("heading", { name: "Cross-worktree conflicts" }),
		).toBeTruthy();
		expect(screen.getAllByText("high persisted overlap")).toHaveLength(2);
		expect(
			screen.queryByRole("heading", { name: "Worktree overlap map" }),
		).toBeNull();
	});

	it("shows a conflict-free state when only low-risk overlaps exist", () => {
		renderPage(snapshot("low"));
		expect(screen.getByText("No high or medium conflicts")).toBeTruthy();
	});
});
