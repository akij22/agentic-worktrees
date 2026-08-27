// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Repository } from "../../shared/db/schema";
import type { IntelligenceSnapshotDto } from "../../shared/ipc/schemas";

const mocks = vi.hoisted(() => ({
	useIntelligence: vi.fn(),
	useConflictPreparation: vi.fn(() => ({
		branches: [{ name: "main", protected: false, headCommitSha: "sha" }],
		targetBranch: "main",
		selectTargetBranch: vi.fn(),
		session: undefined,
		loading: false,
		preparing: false,
		error: undefined,
		prepare: vi.fn(),
	})),
}));
vi.mock("../features/intelligence/hooks/use-intelligence", () => ({
	useIntelligence: mocks.useIntelligence,
}));
vi.mock("../features/intelligence/hooks/use-conflict-preparation", () => ({
	useConflictPreparation: mocks.useConflictPreparation,
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
		<MemoryRouter initialEntries={["/intelligence"]}>
			<Routes>
				<Route path="/intelligence" element={<Intelligence />} />
				<Route
					path="/coding-agent/:worktreeId/:runId"
					element={<p>Chat destination</p>}
				/>
			</Routes>
		</MemoryRouter>,
	);
};

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("Intelligence conflict page", () => {
	it("defaults to the repository overview and opens conflict review from Attention", () => {
		renderPage(snapshot("high"));
		expect(
			screen.getByRole("heading", { name: "Cross-worktree conflicts" }),
		).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Worktree overlap map" }),
		).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Attention" })).toBeTruthy();
		expect(
			screen.queryByRole("heading", { name: "Conflict list" }),
		).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Review overlap" }));

		expect(screen.getByRole("heading", { name: "Conflict list" })).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Conflict details" }),
		).toBeTruthy();
		expect(screen.getAllByText("high persisted overlap")).toHaveLength(2);
	});

	it("navigates directly to a worktree chat from the overview", () => {
		renderPage(snapshot("high"));

		fireEvent.click(
			screen.getByRole("button", { name: "Open Left task chat" }),
		);

		expect(screen.getByText("Chat destination")).toBeTruthy();
	});

	it("keeps passive relationships on the map but out of conflict review", () => {
		renderPage(snapshot("low"));
		expect(screen.getByText("No actionable overlaps")).toBeTruthy();
		expect(
			screen.getByText(
				"Low risk connection between Left task and Right task: low persisted overlap",
			),
		).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Show conflict review" }),
		);
		expect(screen.getByText("No high or medium conflicts")).toBeTruthy();
	});
});
