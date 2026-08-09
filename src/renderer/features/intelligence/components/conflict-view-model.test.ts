import { describe, expect, it } from "vitest";
import type {
	IntelligenceOverlapDto,
	IntelligenceSnapshotDto,
} from "../../../../shared/ipc/schemas";
import { conflictFileCount, selectConflicts } from "./conflict-view-model";

const overlap = (
	id: string,
	risk: IntelligenceOverlapDto["risk"],
	paths: string[] = [`src/${id}.ts`],
): IntelligenceOverlapDto => ({
	id,
	leftWorktreeId: "left",
	rightWorktreeId: "right",
	risk,
	category: risk === "high" ? "file" : "module",
	reasonCode: `${risk}-reason`,
	summary: `${risk} overlap`,
	actionable: risk === "high",
	targets: paths.map((path, index) => ({
		id: `${id}-${index}`,
		type: risk === "high" ? "file" : "module",
		path,
		symbol: null,
		leftFilePath: path,
		rightFilePath: path,
		reasonCode: `${risk}-reason`,
		risk,
	})),
});

const snapshot = (overlaps: IntelligenceOverlapDto[]): IntelligenceSnapshotDto => ({
	id: "snapshot",
	repositoryId: "repository",
	startedAt: 1,
	completedAt: 2,
	stale: false,
	refreshError: null,
	warnings: [],
	worktrees: [],
	overlaps,
});

describe("conflict view model", () => {
	it("keeps only high and medium conflicts with stable severity ordering", () => {
		const mediumA = overlap("medium-a", "medium");
		const low = overlap("low", "low");
		const high = overlap("high", "high");
		const mediumB = overlap("medium-b", "medium");

		expect(selectConflicts(snapshot([mediumA, low, high, mediumB])).map(({ id }) => id)).toEqual([
			"high",
			"medium-a",
			"medium-b",
		]);
	});

	it("counts unique affected files", () => {
		expect(conflictFileCount(overlap("high", "high", ["src/a.ts", "src/a.ts", "src/b.ts"]))).toBe(2);
	});
});
