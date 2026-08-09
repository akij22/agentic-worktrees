import type {
	IntelligenceOverlapDto,
	IntelligenceSnapshotDto,
	IntelligenceWorktreeDto,
} from "../../../../shared/ipc/schemas";

const riskRank = { high: 0, medium: 1, low: 2 } as const;

export const selectConflicts = (
	snapshot: IntelligenceSnapshotDto,
): IntelligenceOverlapDto[] =>
	snapshot.overlaps
		.map((overlap, index) => ({ overlap, index }))
		.filter(({ overlap }) => overlap.risk !== "low")
		.sort(
			(left, right) =>
				riskRank[left.overlap.risk] - riskRank[right.overlap.risk] ||
				left.index - right.index,
		)
		.map(({ overlap }) => overlap);

export const worktreeFor = (
	snapshot: IntelligenceSnapshotDto,
	worktreeId: string,
): IntelligenceWorktreeDto | undefined =>
	snapshot.worktrees.find((worktree) => worktree.worktreeId === worktreeId);

export const conflictFileCount = (
	overlap: IntelligenceOverlapDto,
): number => new Set(overlap.targets.map(({ path }) => path)).size;
