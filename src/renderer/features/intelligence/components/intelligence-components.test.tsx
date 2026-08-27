// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	IntelligenceOverlapDto,
	IntelligenceSnapshotDto,
	IntelligenceWorktreeDto,
} from "../../../../shared/ipc/schemas";
import { AttentionPanel } from "./AttentionPanel";
import { DiffComparison } from "./DiffComparison";
import { IntelligenceSummary } from "./IntelligenceSummary";
import { IntelligenceWorktreeNode } from "./IntelligenceWorktreeNode";
import { OverlapDetails } from "./OverlapDetails";
import { WorktreeOverlapMap } from "./WorktreeOverlapMap";

const emptySnapshot: IntelligenceSnapshotDto = {
	id: "snapshot",
	repositoryId: "repository",
	startedAt: 1,
	completedAt: 2,
	stale: false,
	refreshError: null,
	warnings: [],
	worktrees: [],
	overlaps: [],
};

const worktree = (
	index: number,
	independent = false,
): IntelligenceWorktreeDto => ({
	worktreeId: `wt-${index}`,
	runId: `run-${index}`,
	task: `Worktree ${["one", "two", "three", "four", "five"][index - 1]}`,
	branch: `feat/worktree-${index}`,
	baseBranch: "main",
	agentKind: index % 2 === 0 ? "codex" : "opencode",
	agentName: index % 2 === 0 ? "Codex" : "OpenCode",
	status: index === 1 ? "busy" : "idle",
	changedFileCount: 1,
	additions: index * 10,
	deletions: index,
	files: [
		{
			path: `src/worktree-${index}.ts`,
			modulePath: "src",
			additions: index * 10,
			deletions: index,
			symbols: [`worktree${index}`],
		},
	],
	independent,
	warning: index === 4 ? "Base branch could not be resolved" : null,
	updatedAt: index,
});

const overlap = (
	id: string,
	risk: IntelligenceOverlapDto["risk"],
	actionable: boolean,
	leftWorktreeId = "wt-1",
	rightWorktreeId = "wt-2",
): IntelligenceOverlapDto => ({
	id,
	leftWorktreeId,
	rightWorktreeId,
	risk,
	category: risk === "high" ? "symbol" : risk === "medium" ? "module" : "folder",
	reasonCode: risk === "high" ? "same-symbol" : `${risk}-relationship`,
	summary: `${risk} ${actionable ? "actionable" : "passive"} overlap`,
	actionable,
	targets: [
		{
			id: `${id}-target`,
			type: risk === "high" ? "symbol" : risk === "medium" ? "module" : "folder",
			path: "src/session.ts",
			symbol: risk === "high" ? "SessionService.createSession" : null,
			leftFilePath: "src/session.ts",
			rightFilePath: "src/session.ts",
			reasonCode: risk === "high" ? "same-symbol" : `${risk}-relationship`,
			risk,
		},
	],
});

const high = overlap("overlap-high", "high", true);
const mediumPassive = overlap("overlap-medium", "medium", false);
const low = overlap("overlap-low", "low", false, "wt-3", "wt-4");

const fiveWorktreeSnapshot: IntelligenceSnapshotDto = {
	...emptySnapshot,
	worktrees: [worktree(1), worktree(2), worktree(3, true), worktree(4), worktree(5)],
	overlaps: [high, mediumPassive, low],
};

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("conflict UI support", () => {
	it("renders summary values from the persisted snapshot", () => {
		render(<IntelligenceSummary snapshot={emptySnapshot} />);
		expect(screen.getByText("Active worktrees")).toBeTruthy();
		expect(screen.getByText("High-risk conflicts")).toBeTruthy();
		expect(screen.getByText("Medium overlaps")).toBeTruthy();
		expect(screen.getByText("Independent worktrees")).toBeTruthy();
	});

	it("renders four deterministic worktrees per page and paginates the remainder", () => {
		render(<WorktreeOverlapMap snapshot={fiveWorktreeSnapshot} />);

		expect(screen.getAllByTestId("intelligence-worktree-node")).toHaveLength(4);
		expect(screen.queryByText("Worktree five")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Next worktrees" }));

		expect(screen.getAllByTestId("intelligence-worktree-node")).toHaveLength(1);
		expect(screen.getByText("Worktree five")).toBeTruthy();
	});

	it("describes visible relationship risk without relying on connector color", () => {
		render(<WorktreeOverlapMap snapshot={fiveWorktreeSnapshot} />);

		expect(
			screen.getByText(
				"High risk connection between Worktree one and Worktree two: high actionable overlap",
			),
		).toBeTruthy();
		expect(screen.getAllByText("High").length).toBeGreaterThan(0);
	});

	it("shows only actionable overlaps in Attention and preserves server order", () => {
		render(<AttentionPanel overlaps={[high, mediumPassive, low]} />);

		expect(screen.getByText(high.summary)).toBeTruthy();
		expect(screen.queryByText(mediumPassive.summary)).toBeNull();
		expect(screen.queryByText(low.summary)).toBeNull();
	});

	it("exposes overlap actions with the persisted overlap identifier", () => {
		const onReview = vi.fn();
		const onCompare = vi.fn();
		const onInspect = vi.fn();
		render(
			<AttentionPanel
				overlaps={[high]}
				onReview={onReview}
				onCompare={onCompare}
				onInspect={onInspect}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Review overlap" }));
		fireEvent.click(screen.getByRole("button", { name: "Compare diff" }));
		fireEvent.click(screen.getByRole("button", { name: "Inspect files" }));

		expect(onReview).toHaveBeenCalledWith(high.id);
		expect(onCompare).toHaveBeenCalledWith(high.id);
		expect(onInspect).toHaveBeenCalledWith(high.id);
	});

	it("opens chat with persisted worktree and run identifiers", () => {
		const onOpenChat = vi.fn();
		render(
			<IntelligenceWorktreeNode
				worktree={worktree(1)}
				onOpenChat={onOpenChat}
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Open Worktree one chat" }),
		);
		expect(onOpenChat).toHaveBeenCalledWith("wt-1", "run-1");
	});

	it("labels independent worktrees and warnings with text", () => {
		const { rerender } = render(
			<IntelligenceWorktreeNode worktree={worktree(3, true)} />,
		);
		expect(screen.getByText("Safely independent")).toBeTruthy();

		rerender(<IntelligenceWorktreeNode worktree={worktree(4)} />);
		expect(screen.getByText("Base branch could not be resolved")).toBeTruthy();
	});

	it("loads persisted patches for two-sided comparison", async () => {
		Object.defineProperty(window, "api", {
			configurable: true,
			value: {
				intelligence: {
					compareDiffs: vi.fn().mockResolvedValue({
						overlapId: "conflict",
						left: {
							worktreeId: "left",
							runId: "left-run",
							files: [
								{
									path: "src/session.ts",
									modulePath: "src",
									additions: 1,
									deletions: 1,
									patch: "-old\n+left",
									binary: false,
								},
							],
						},
						right: {
							worktreeId: "right",
							runId: "right-run",
							files: [
								{
									path: "src/session.ts",
									modulePath: "src",
									additions: 1,
									deletions: 1,
									patch: "-old\n+right",
									binary: false,
								},
							],
						},
					}),
				},
			},
		});

		render(
			<DiffComparison
				overlapId="conflict"
				open
				onClose={() => undefined}
				onOpenChat={() => undefined}
			/>,
		);

		await waitFor(() => expect(screen.getByText("+left")).toBeTruthy());
		expect(screen.getByText("+right")).toBeTruthy();
	});

	it("loads overlap evidence only when details are opened", async () => {
		const getOverlap = vi.fn().mockResolvedValue({
			overlap: {
				...high,
				targets: high.targets.map((target) => ({
					...target,
					leftRanges: [{ oldStart: 1, oldLines: 1, newStart: 2, newLines: 2 }],
					rightRanges: [{ oldStart: 4, oldLines: 1, newStart: 5, newLines: 1 }],
				})),
			},
			left: worktree(1),
			right: worktree(2),
		});
		Object.defineProperty(window, "api", {
			configurable: true,
			value: { intelligence: { getOverlap } },
		});
		const onCompare = vi.fn();
		const { rerender } = render(
			<OverlapDetails
				overlapId={high.id}
				open={false}
				onClose={() => undefined}
				onCompare={onCompare}
			/>,
		);

		expect(getOverlap).not.toHaveBeenCalled();
		rerender(
			<OverlapDetails
				overlapId={high.id}
				open
				onClose={() => undefined}
				onCompare={onCompare}
			/>,
		);

		expect(await screen.findByText("SessionService.createSession")).toBeTruthy();
		expect(screen.getByText("Same symbol")).toBeTruthy();
		expect(screen.getByText("Worktree one")).toBeTruthy();
		expect(screen.getByText("Worktree two")).toBeTruthy();
		expect(screen.getByText("Old 1,1 → new 2,2")).toBeTruthy();
		expect(screen.getByText("Old 4,1 → new 5,1")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Compare diff" }));
		expect(onCompare).toHaveBeenCalledWith(high.id);
	});

	it("selects one persisted file and synchronizes the two diff panes", async () => {
		const compareDiffs = vi.fn().mockResolvedValue({
			overlapId: high.id,
			left: {
				worktreeId: "wt-1",
				runId: "run-1",
				files: [
					{
						path: "src/session.ts",
						modulePath: "src",
						additions: 1,
						deletions: 1,
						patch: "-old session\n+left session",
						binary: false,
					},
					{
						path: "src/other.ts",
						modulePath: "src",
						additions: 1,
						deletions: 0,
						patch: "+left other",
						binary: false,
					},
				],
			},
			right: {
				worktreeId: "wt-2",
				runId: "run-2",
				files: [
					{
						path: "src/session.ts",
						modulePath: "src",
						additions: 1,
						deletions: 1,
						patch: "-old session\n+right session",
						binary: false,
					},
				],
			},
		});
		Object.defineProperty(window, "api", {
			configurable: true,
			value: { intelligence: { compareDiffs } },
		});
		render(
			<DiffComparison
				overlapId={high.id}
				open
				onClose={() => undefined}
				onOpenChat={() => undefined}
			/>,
		);

		expect(await screen.findByText("+left session")).toBeTruthy();
		fireEvent.click(screen.getByRole("tab", { name: "Select src/other.ts" }));
		expect(screen.getByText("+left other")).toBeTruthy();
		expect(screen.getByText("File unchanged in this worktree")).toBeTruthy();

		const leftPane = screen.getByLabelText("Left diff pane");
		const rightPane = screen.getByLabelText("Right diff pane");
		leftPane.scrollTop = 72;
		leftPane.scrollLeft = 18;
		fireEvent.scroll(leftPane);
		expect(rightPane.scrollTop).toBe(72);
		expect(rightPane.scrollLeft).toBe(18);
		expect(compareDiffs).toHaveBeenCalledWith({ overlapId: high.id });
	});
});
