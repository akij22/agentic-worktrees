// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
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

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("useCodingAgentSessions", () => {
	it("publishes the chat list before slow session details finish", async () => {
		Object.defineProperty(window, "api", {
			configurable: true,
			value: {
				codingAgent: {
					getStatus: vi.fn().mockResolvedValue({
						installations: [
							{
								kind: "opencode",
								name: "OpenCode",
								configured: true,
								executablePath: "/usr/local/bin/opencode",
								version: "1.0.0",
								running: true,
								error: null,
							},
						],
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


describe("session event refreshes", () => {
  it("refreshes only the changed chat and coalesces a burst while its read is pending", async () => {
    let onEvent!: (event: { runId: string; type: string; payload: null }) => void;
    const other = { ...session, id: "run-2" };
    const getSession = vi.fn(async ({ runId }: { runId: string }) => ({
      session: runId === session.id ? session : other,
      messages: [], diff: [], capabilities: [],
    }));
    const getStatus = vi.fn().mockResolvedValue({ installations: [] });
    const listWorktrees = vi.fn().mockResolvedValue([]);
    const listSessions = vi.fn().mockResolvedValue([session, other]);
    Object.defineProperty(window, "api", { configurable: true, value: {
      codingAgent: { getStatus, listWorktrees, listSessions, getSession,
        onEvent: vi.fn((listener) => { onEvent = listener; return () => undefined; }),
      },
    } });
    const { result } = renderHook(() => useCodingAgentSessions());
    await waitFor(() => expect(result.current.sessionDetails.size).toBe(2));
    getSession.mockClear();
    let finish!: (value: Awaited<ReturnType<typeof getSession>>) => void;
    getSession.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    act(() => { onEvent({ runId: "run-1", type: "session.status", payload: null }); });
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));
    act(() => {
      for (let i = 0; i < 10; i++) onEvent({ runId: "run-1", type: "messages.updated", payload: null });
    });
    expect(getSession).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ session, messages: [], diff: [], capabilities: [] }); });
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(2));
    expect(getSession.mock.calls.every(([request]) => request.runId === "run-1")).toBe(true);
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(listWorktrees).toHaveBeenCalledTimes(1);
    expect(result.current.sessionDetails.size).toBe(2);
  });
});
