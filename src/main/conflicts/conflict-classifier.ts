import type {
	ClassifyConfirmedConflictInput,
	ConflictClassification,
	ConflictResolutionState,
} from "./types";

const transitions: Record<ConflictResolutionState, readonly ConflictResolutionState[]> = {
	requested: ["capturing", "failed"],
	capturing: ["simulating", "failed"],
	simulating: ["preparing_sandbox", "safe", "failed"],
	preparing_sandbox: ["review_required", "conflict", "failed"],
	safe: [],
	review_required: [],
	conflict: [],
	failed: [],
};

const reviewReasonCodes = new Set([
	"same-symbol",
	"overlapping-original-range",
	"same-original-range-replacement",
	"same-original-range-deletion",
]);

export const assertResolutionTransition = (
	from: ConflictResolutionState,
	to: ConflictResolutionState,
): void => {
	if (!transitions[from].includes(to)) {
		throw new Error(`Invalid conflict resolution transition: ${from} → ${to}`);
	}
};

export const classifyConfirmedConflict = ({
	git,
	targets,
}: ClassifyConfirmedConflictInput): ConflictClassification => {
	if (git.kind === "conflict" && git.files.length > 0) return "conflict";
	return targets.some(({ reasonCode }) => reviewReasonCodes.has(reasonCode))
		? "review_required"
		: "safe";
};
