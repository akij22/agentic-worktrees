import type {
	ConflictResolutionSessionDto,
	IntelligenceOverlapDto,
	IntelligenceSnapshotDto,
	IntelligenceWorktreeDto,
} from "../../../../shared/ipc/schemas";

const riskRank = { high: 0, medium: 1, low: 2 } as const;

export type ConflictDisplayKind =
	| "overlap"
	| "predicted_conflict"
	| "safe"
	| "review_required"
	| "conflict";

export interface ConflictPresentation {
	kind: ConflictDisplayKind;
	label: string;
	confirmation: string;
}

const predictedReasons = new Set([
	"same-symbol",
	"overlapping-original-range",
	"same-original-range-replacement",
	"same-original-range-deletion",
]);

export const conflictPresentation = (
	overlap: IntelligenceOverlapDto,
	session?: ConflictResolutionSessionDto,
): ConflictPresentation => {
	if (session?.classification === "conflict") {
		return {
			kind: "conflict",
			label: "Conflict",
			confirmation: "Git confirmed",
		};
	}
	if (session?.classification === "review_required") {
		return {
			kind: "review_required",
			label: "Review Required",
			confirmation: "Git mergeable",
		};
	}
	if (session?.classification === "safe") {
		return { kind: "safe", label: "Safe", confirmation: "Git mergeable" };
	}
	return predictedReasons.has(overlap.reasonCode)
		? {
				kind: "predicted_conflict",
				label: "Predicted conflict",
				confirmation: "Not confirmed",
			}
		: { kind: "overlap", label: "Overlap", confirmation: "Not confirmed" };
};

export const selectConflicts = (
	snapshot: IntelligenceSnapshotDto,
	sessions: ConflictResolutionSessionDto[] = [],
): IntelligenceOverlapDto[] => {
	const latestByOverlap = new Map<string, ConflictResolutionSessionDto>();
	for (const session of sessions) {
		if (!latestByOverlap.has(session.overlapId))
			latestByOverlap.set(session.overlapId, session);
	}
	return snapshot.overlaps
		.map((overlap, index) => ({ overlap, index }))
		.filter(({ overlap }) => overlap.risk !== "low")
		.filter(
			({ overlap }) =>
				conflictPresentation(overlap, latestByOverlap.get(overlap.id)).kind !==
				"safe",
		)
		.sort(
			(left, right) =>
				riskRank[left.overlap.risk] - riskRank[right.overlap.risk] ||
				left.index - right.index,
		)
		.map(({ overlap }) => overlap);
};

export const worktreeFor = (
	snapshot: IntelligenceSnapshotDto,
	worktreeId: string,
): IntelligenceWorktreeDto | undefined =>
	snapshot.worktrees.find((worktree) => worktree.worktreeId === worktreeId);

export const conflictFileCount = (overlap: IntelligenceOverlapDto): number =>
	new Set(overlap.targets.map(({ path }) => path)).size;
