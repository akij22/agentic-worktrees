// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	IntelligenceOverlapDto,
	IntelligenceWorktreeDto,
} from "../../../../shared/ipc/schemas";
import { ConflictActions } from "./ConflictActions";
import { ConflictDetails } from "./ConflictDetails";
import { ConflictList } from "./ConflictList";

const worktree = (
	id: string,
	task: string,
	independent = false,
): IntelligenceWorktreeDto => ({
	worktreeId: id,
	runId: `${id}-run`,
	task,
	branch: `feat/${id}`,
	baseBranch: "main",
	agentKind: id === "right" ? "codex" : "opencode",
	agentName: id === "right" ? "Codex" : "OpenCode",
	status: "busy",
	changedFileCount: id === "left" ? 6 : 13,
	additions: id === "left" ? 1827 : 1082,
	deletions: id === "left" ? 415 : 190,
	files: [
		{
			path: "src/session.ts",
			modulePath: "src",
			additions: 10,
			deletions: 2,
			symbols: ["createSession"],
		},
	],
	independent,
	warning: null,
	updatedAt: 1_700_000_000_000,
});

const conflict: IntelligenceOverlapDto = {
	id: "conflict",
	leftWorktreeId: "left",
	rightWorktreeId: "right",
	risk: "high",
	category: "symbol",
	reasonCode: "same-symbol",
	summary: "Both worktrees modify session creation",
	actionable: true,
	targets: [
		{
			id: "target",
			type: "symbol",
			path: "src/session.ts",
			symbol: "createSession",
			leftFilePath: "src/session.ts",
			rightFilePath: "src/session.ts",
			reasonCode: "same-symbol",
			risk: "high",
		},
	],
};

const left = worktree("left", "Home screen");
const right = worktree("right", "First session");

afterEach(() => cleanup());

describe("conflict workspace", () => {
	it("selects a real conflict from the list", () => {
		const onSelect = vi.fn();
		render(
			<ConflictList
				conflicts={[conflict]}
				selectedId={null}
				worktrees={[left, right]}
				onSelect={onSelect}
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: /Home screen.*First session/i }),
		);
		expect(onSelect).toHaveBeenCalledWith("conflict");
		expect(screen.getByText("src/session.ts")).toBeTruthy();
	});

	it("renders selected file and symbol evidence inline", () => {
		render(<ConflictDetails overlap={conflict} left={left} right={right} />);

		expect(
			screen.getByRole("heading", { name: /Home screen.*First session/i }),
		).toBeTruthy();
		expect(screen.getByText("src/session.ts")).toBeTruthy();
		expect(screen.getByText("createSession")).toBeTruthy();
		expect(screen.getByText("Same symbol")).toBeTruthy();
	});

	it("uses snapshot metrics and real chat identifiers", () => {
		const onOpenChat = vi.fn();
		const onCompare = vi.fn();
		render(
			<ConflictActions
				overlap={conflict}
				left={left}
				right={right}
				independentWorktrees={[worktree("safe", "Settings cleanup", true)]}
				onOpenChat={onOpenChat}
				onCompare={onCompare}
			/>,
		);

		expect(screen.getByText("+1,827")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Open Home screen chat" }),
		);
		expect(onOpenChat).toHaveBeenCalledWith("left", "left-run");
		fireEvent.click(screen.getByRole("button", { name: "Compare diffs" }));
		expect(onCompare).toHaveBeenCalledWith("conflict");
		expect(
			screen.getByRole("heading", { name: "Independent worktrees" }),
		).toBeTruthy();
		expect(screen.getByText("Settings cleanup")).toBeTruthy();
	});
});
