import { describe, expect, it } from "vitest";
import type { OverlapTarget } from "../intelligence/types";
import {
	assertResolutionTransition,
	classifyConfirmedConflict,
} from "./conflict-classifier";

const target = (reasonCode: string, risk: "high" | "medium" = "high"): OverlapTarget => ({
	type: reasonCode === "same-symbol" ? "symbol" : "file",
	path: "src/session.ts",
	reasonCode,
	risk,
	leftFilePath: "src/session.ts",
	rightFilePath: "src/session.ts",
	symbol: reasonCode === "same-symbol" ? "createSession" : null,
});

describe("confirmed conflict classification", () => {
	it("treats Git unresolved entries as a confirmed conflict", () => {
		expect(classifyConfirmedConflict({
			git: { kind: "conflict", files: [{ path: "src/session.ts", stages: [], markerRanges: [] }] },
			targets: [],
		})).toBe("conflict");
	});

	it.each(["same-symbol", "overlapping-original-range"])(
		"requires review for clean Git merges with %s evidence",
		(reasonCode) => {
			expect(classifyConfirmedConflict({
				git: { kind: "clean", files: [] },
				targets: [target(reasonCode)],
			})).toBe("review_required");
		},
	);

	it("marks a clean same-file merge safe", () => {
		expect(classifyConfirmedConflict({
			git: { kind: "clean", files: [] },
			targets: [target("same-file", "medium")],
		})).toBe("safe");
	});
});

describe("resolution state transitions", () => {
	it.each([
		["requested", "capturing"],
		["capturing", "simulating"],
		["simulating", "preparing_sandbox"],
		["simulating", "safe"],
		["preparing_sandbox", "review_required"],
		["preparing_sandbox", "conflict"],
		["capturing", "failed"],
	] as const)("allows %s → %s", (from, to) => {
		expect(() => assertResolutionTransition(from, to)).not.toThrow();
	});

	it.each([
		["safe", "capturing"],
		["conflict", "failed"],
		["requested", "safe"],
		["capturing", "review_required"],
	] as const)("rejects %s → %s", (from, to) => {
		expect(() => assertResolutionTransition(from, to)).toThrow(/Invalid conflict resolution transition/);
	});
});
