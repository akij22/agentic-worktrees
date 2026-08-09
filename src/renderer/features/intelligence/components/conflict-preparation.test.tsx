// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConflictResolutionSessionDto } from "../../../../shared/ipc/schemas";
import { ConflictFileEvidence } from "./ConflictFileEvidence";
import { ConflictPreparation } from "./ConflictPreparation";

const session = (
	state: ConflictResolutionSessionDto["state"],
): ConflictResolutionSessionDto => ({
	id: "session-1",
	repositoryId: "repository-1",
	snapshotId: "snapshot-1",
	overlapId: "overlap-1",
	targetBranch: "main",
	targetCommitSha: "target-sha",
	state,
	classification: state === "conflict" ? "conflict" : null,
	currentStage:
		state === "conflict"
			? "Git confirmed conflict"
			: "Simulating merge with Git",
	integrationBranch:
		state === "conflict" ? "agentic/integration/session-1" : null,
	integrationPath: state === "conflict" ? "/integration/session-1" : null,
	retained: state === "conflict",
	cleanupPending: false,
	errorMessage: null,
	participants: [],
	files:
		state === "conflict"
			? [
					{
						path: "src/session.ts",
						kind: "git_conflict",
						risk: "high",
						reasonCode: "git-merge-conflict",
						leftPath: "src/session.ts",
						rightPath: "src/session.ts",
						symbol: "createSession",
						staticRanges: [],
						gitStages: [
							{
								stage: 1,
								mode: "100644",
								objectId: "base",
								path: "src/session.ts",
							},
						],
						markerRanges: [
							{ oldStart: 5, oldLines: 4, newStart: 5, newLines: 4 },
						],
					},
				]
			: [],
	operations: [],
	createdAt: 1,
	updatedAt: 2,
	completedAt: state === "conflict" ? 2 : null,
});

const overlap = {
	id: "overlap-1",
	leftWorktreeId: "left",
	rightWorktreeId: "right",
	risk: "high" as const,
	category: "symbol" as const,
	reasonCode: "same-symbol",
	summary: "Both agents changed createSession",
	actionable: true,
	targets: [
		{
			id: "target",
			type: "symbol" as const,
			path: "src/session.ts",
			symbol: "createSession",
			leftFilePath: "src/session.ts",
			rightFilePath: "src/session.ts",
			reasonCode: "same-symbol",
			risk: "high" as const,
		},
	],
};

afterEach(() => cleanup());

describe("ConflictPreparation", () => {
	it("selects a target branch and confirms with Git", () => {
		const selectTargetBranch = vi.fn();
		const prepare = vi.fn();
		render(
			<ConflictPreparation
				branches={[
					{ name: "main", protected: false, headCommitSha: "sha" },
					{ name: "develop", protected: false, headCommitSha: "sha-2" },
				]}
				targetBranch="main"
				selectTargetBranch={selectTargetBranch}
				session={undefined}
				loading={false}
				preparing={false}
				error={undefined}
				onPrepare={prepare}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Target branch"), {
			target: { value: "develop" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Confirm with Git" }));
		expect(selectTargetBranch).toHaveBeenCalledWith("develop");
		expect(prepare).toHaveBeenCalledOnce();
	});

	it("shows truthful persisted preparation stages", () => {
		render(
			<ConflictPreparation
				branches={[]}
				targetBranch="main"
				selectTargetBranch={() => undefined}
				session={session("simulating")}
				loading={false}
				preparing
				error={undefined}
				onPrepare={() => undefined}
			/>,
		);
		expect(screen.getByText("Simulating merge with Git")).toBeTruthy();
		expect(screen.queryByText(/%/)).toBeNull();
	});

	it("renders Git-confirmed file stages and marker ranges", () => {
		render(
			<ConflictFileEvidence
				overlap={overlap}
				session={session("conflict")}
				leftTask="Left"
				rightTask="Right"
			/>,
		);
		expect(screen.getByText("Git confirmed")).toBeTruthy();
		expect(screen.getByText("src/session.ts")).toBeTruthy();
		expect(screen.getByText("Stages 1")).toBeTruthy();
		expect(screen.getByText("Lines 5–8")).toBeTruthy();
	});
});
