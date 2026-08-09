// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntelligenceSnapshotDto } from "../../../../shared/ipc/schemas";
import { DiffComparison } from "./DiffComparison";
import { IntelligenceSummary } from "./IntelligenceSummary";

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
							files: [{ path: "src/session.ts", modulePath: "src", additions: 1, deletions: 1, patch: "-old\n+left", binary: false }],
						},
						right: {
							worktreeId: "right",
							runId: "right-run",
							files: [{ path: "src/session.ts", modulePath: "src", additions: 1, deletions: 1, patch: "-old\n+right", binary: false }],
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
});
