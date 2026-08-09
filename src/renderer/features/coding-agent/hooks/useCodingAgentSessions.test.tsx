// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	CodingAgentSessionDto,
	CodingAgentSessionSnapshotDto,
} from "../../../../shared/ipc/schemas";
import { useCodingAgentSessions } from "./useCodingAgentSessions";

const session: CodingAgentSessionDto = {
	id: "run-1",
	agentKind: "opencode",
	agentName: "OpenCode",
	worktreeId: "worktree-1",
	repositoryId: "repository-1",
	title: "Existing chat",
	status: "idle",
	errorMessage: null,
	hasUnviewedChanges: false,
	providerId: "provider",
	modelId: "model",
	createdAt: new Date(0),
	updatedAt: new Date(0),
};

const never = new Promise<CodingAgentSessionSnapshotDto>(() => undefined);

afterEach(() => vi.restoreAllMocks());

describe("useCodingAgentSessions", () => {
	it("publishes the chat list before slow session details finish", async () => {
		Object.defineProperty(window, "api", {
			configurable: true,
			value: {
				codingAgent: {
					getStatus: vi.fn().mockResolvedValue({
						installations: [{
							kind: "opencode",
							name: "OpenCode",
							configured: true,
							executablePath: "/usr/local/bin/opencode",
							version: "1.0.0",
							running: true,
							error: null,
						}],
					}),
					listWorktrees: vi.fn().mockResolvedValue([]),
					listSessions: vi.fn().mockResolvedValue([session]),
					getSession: vi.fn(() => never),
					onEvent: vi.fn(() => () => undefined),
				},
			},
		});

		const { result } = renderHook(() => useCodingAgentSessions());

		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.sessions).toEqual([session]);
		expect(result.current.sessionDetails.size).toBe(0);
	});
});
