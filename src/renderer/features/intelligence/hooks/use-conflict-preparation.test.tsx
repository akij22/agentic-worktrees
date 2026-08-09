// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConflictResolutionSessionDto } from "../../../../shared/ipc/schemas";
import { useConflictPreparation } from "./use-conflict-preparation";

const session = (state: ConflictResolutionSessionDto["state"]): ConflictResolutionSessionDto => ({
	id: "session-1",
	repositoryId: "repository-1",
	snapshotId: "snapshot-1",
	overlapId: "overlap-1",
	targetBranch: "develop",
	targetCommitSha: state === "requested" ? null : "target-sha",
	state,
	classification: state === "review_required" ? "review_required" : null,
	currentStage: state === "requested" ? "Requested" : "Semantic review required",
	integrationBranch: state === "review_required" ? "agentic/integration/session-1" : null,
	integrationPath: state === "review_required" ? "/integration/session-1" : null,
	retained: state === "review_required",
	cleanupPending: false,
	errorMessage: null,
	participants: [],
	files: [],
	operations: [],
	createdAt: 1,
	updatedAt: 2,
	completedAt: state === "requested" ? null : 2,
});

afterEach(() => vi.restoreAllMocks());

describe("useConflictPreparation", () => {
	it("loads branches, defaults the target, and prepares the selected overlap", async () => {
		Object.defineProperty(window, "api", {
			configurable: true,
			value: { intelligence: {
				listTargetBranches: vi.fn().mockResolvedValue([
					{ name: "main", protected: false, headCommitSha: "main-sha" },
					{ name: "develop", protected: false, headCommitSha: "develop-sha" },
				]),
				listResolutionSessions: vi.fn().mockResolvedValue([]),
				prepareConflict: vi.fn().mockResolvedValue(session("requested")),
				onResolutionSessionChanged: vi.fn(() => () => undefined),
			} },
		});
		const { result } = renderHook(() =>
			useConflictPreparation("repository-1", "overlap-1", "develop"));

		await waitFor(() => expect(result.current.targetBranch).toBe("develop"));
		await act(async () => result.current.prepare());

		expect(window.api.intelligence.prepareConflict).toHaveBeenCalledWith({
			overlapId: "overlap-1", targetBranch: "develop",
		});
		expect(result.current.session?.id).toBe("session-1");
	});

	it("reloads the selected overlap after a persisted session event", async () => {
		let listener: ((event: { sessionId: string; repositoryId: string; state: "review_required"; updatedAt: number }) => void) | undefined;
		const listSessions = vi.fn()
			.mockResolvedValueOnce([session("requested")])
			.mockResolvedValueOnce([session("review_required")]);
		Object.defineProperty(window, "api", {
			configurable: true,
			value: { intelligence: {
				listTargetBranches: vi.fn().mockResolvedValue([{ name: "main", protected: false, headCommitSha: "sha" }]),
				listResolutionSessions: listSessions,
				prepareConflict: vi.fn(),
				onResolutionSessionChanged: vi.fn((value) => { listener = value; return () => undefined; }),
			} },
		});
		const { result } = renderHook(() =>
			useConflictPreparation("repository-1", "overlap-1", "main"));
		await waitFor(() => expect(result.current.session?.state).toBe("requested"));

		act(() => listener?.({
			sessionId: "session-1", repositoryId: "repository-1",
			state: "review_required", updatedAt: 2,
		}));

		await waitFor(() => expect(result.current.session?.state).toBe("review_required"));
	});
});
