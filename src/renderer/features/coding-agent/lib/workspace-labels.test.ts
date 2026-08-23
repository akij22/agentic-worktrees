import { describe, expect, it } from "vitest";
import type { CodingAgentWorktreeContextDto } from "../../../../shared/ipc/schemas";
import { getWorkspaceLabel, getWorkspaceShortLabel } from "./workspace-labels";

const context = (
	kind: "primary" | "linked",
): CodingAgentWorktreeContextDto =>
	({
		worktree: {
			kind,
			name: kind === "primary" ? "Main checkout" : "feature-ui",
			branchName: kind === "primary" ? "main" : "feat/ui",
		},
	} as CodingAgentWorktreeContextDto);

describe("workspace labels", () => {
	it("distinguishes primary and linked coding workspaces", () => {
		expect(getWorkspaceLabel(context("primary"))).toBe(
			"Main checkout · main",
		);
		expect(getWorkspaceLabel(context("linked"))).toBe(
			"feature-ui · feat/ui",
		);
		expect(getWorkspaceShortLabel(context("primary"))).toBe("Main checkout");
		expect(getWorkspaceShortLabel(context("linked"))).toBe("feat/ui");
	});
});
