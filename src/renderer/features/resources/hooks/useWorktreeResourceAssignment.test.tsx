// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  assignmentProjectionSchema,
  type AssignmentChangedEventDto,
} from "../../../../shared/assignments/schemas";
import { useWorktreeResourceAssignment } from "./useWorktreeResourceAssignment";
const projection = (sequence = "1", revision = "0") =>
  assignmentProjectionSchema.parse({
    worktreeId: "wt",
    revision,
    projectionSequence: sequence,
    phase: "stable",
    currentAgentKind: "codex",
    resources: [],
    blockers: [],
    progress: null,
    admission: {
      canCreateSession: true,
      canResumeSession: true,
      canSend: true,
      reason: null,
      message: null,
    },
    allowedActions: [],
    failure: null,
    updatedAt: "2026-10-03T10:00:00.000Z",
  });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("loads once, applies ordered events, ignores another Worktree and removes subscriptions", async () => {
  let changed: (event: AssignmentChangedEventDto) => void = () => undefined;
  const off = vi.fn(),
    get = vi.fn(async () => ({ ok: true as const, value: projection() }));
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      resourceAssignment: {
        get,
        onChanged: (listener: typeof changed) => {
          changed = listener;
          return off;
        },
      },
    },
  });
  const hook = renderHook(() => useWorktreeResourceAssignment("wt", "codex"));
  await waitFor(() =>
    expect(hook.result.current.projection?.projectionSequence).toBe("1"),
  );
  const next = projection("2", "1");
  act(() =>
    changed({
      eventId: "event-2",
      worktreeId: "wt",
      revision: "1",
      projectionSequence: "2",
      projection: next,
    }),
  );
  expect(hook.result.current.projection?.revision).toBe("1");
  act(() =>
    changed({
      eventId: "other",
      worktreeId: "other",
      revision: "1",
      projectionSequence: "2",
      projection: { ...next, worktreeId: "other" },
    }),
  );
  expect(hook.result.current.projection?.worktreeId).toBe("wt");
  expect(get).toHaveBeenCalledTimes(1);
  hook.unmount();
  expect(off).toHaveBeenCalledOnce();
});
it("refetches gaps and equal-sequence conflicts, retains the latest projection on stale replies, and refreshes on focus", async () => {
  let changed: (event: AssignmentChangedEventDto) => void = () => undefined;
  const get = vi.fn().mockResolvedValue({ ok: true, value: projection() });
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      resourceAssignment: {
        get,
        onChanged: (listener: typeof changed) => {
          changed = listener;
          return () => undefined;
        },
      },
    },
  });
  const hook = renderHook(() => useWorktreeResourceAssignment("wt", "codex"));
  await waitFor(() =>
    expect(hook.result.current.projection?.projectionSequence).toBe("1"),
  );
  const event = {
    eventId: "gap",
    worktreeId: "wt",
    revision: "1",
    projectionSequence: "4",
    projection: projection("4", "1"),
  };
  act(() => changed(event));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  expect(hook.result.current.projection?.projectionSequence).toBe("4");
  expect(hook.result.current.stale).toBe(true);
  get.mockResolvedValue({ ok: true, value: projection("4", "1") });
  act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(hook.result.current.stale).toBe(false));
  act(() =>
    changed({
      ...event,
      eventId: "conflicting-event",
      projection: { ...event.projection, phase: "reconciling" },
    }),
  );
  await waitFor(() => expect(get).toHaveBeenCalledTimes(4));
  hook.unmount();
});
it("returns a revision conflict without replaying the stale complete-set mutation", async () => {
  const setDesired = vi
    .fn()
    .mockResolvedValue({
      ok: false,
      error: {
        code: "assignment_conflict",
        message: "Resources changed in another window.",
        retryable: true,
        current: projection("3", "2"),
      },
    });
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      resourceAssignment: {
        get: async () => ({ ok: true, value: projection() }),
        setDesired,
        onChanged: () => () => undefined,
      },
    },
  });
  const hook = renderHook(() => useWorktreeResourceAssignment("wt", "codex"));
  await waitFor(() => expect(hook.result.current.stale).toBe(false));
  await act(async () => {
    await expect(hook.result.current.setDesired([])).resolves.toMatchObject({
      ok: false,
      error: { code: "assignment_conflict" },
    });
  });
  expect(setDesired).toHaveBeenCalledExactlyOnceWith({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [],
  });
  expect(hook.result.current.projection?.revision).toBe("2");
  expect(hook.result.current.error).toBe(
    "Resources changed in another window.",
  );
  hook.unmount();
});
it("treats a mutation response and its committed event as idempotent and refetches provider-specific projections", async () => {
  let changed: (event: AssignmentChangedEventDto) => void = () => undefined;
  const get = vi.fn().mockResolvedValue({ ok: true, value: projection() });
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      resourceAssignment: {
        get,
        setDesired: async () => ({ ok: true, value: projection("2", "1") }),
        onChanged: (listener: typeof changed) => {
          changed = listener;
          return () => undefined;
        },
      },
    },
  });
  const hook = renderHook(() => useWorktreeResourceAssignment("wt", "codex"));
  await waitFor(() => expect(hook.result.current.stale).toBe(false));
  await act(async () => {
    await hook.result.current.setDesired([]);
  });
  act(() =>
    changed({
      eventId: "committed",
      worktreeId: "wt",
      revision: "1",
      projectionSequence: "2",
      projection: projection("2", "1"),
    }),
  );
  expect(get).toHaveBeenCalledTimes(1);
  get.mockResolvedValue({
    ok: true,
    value: { ...projection("3", "1"), currentAgentKind: "opencode" },
  });
  hook.rerender();
  hook.unmount();
  const opencode = renderHook(() =>
    useWorktreeResourceAssignment("wt", "opencode"),
  );
  await waitFor(() => expect(opencode.result.current.stale).toBe(false));
  get.mockResolvedValue({
    ok: true,
    value: { ...projection("4", "2"), currentAgentKind: "opencode" },
  });
  act(() =>
    changed({
      eventId: "codex-update",
      worktreeId: "wt",
      revision: "2",
      projectionSequence: "4",
      projection: projection("4", "2"),
    }),
  );
  await waitFor(() =>
    expect(opencode.result.current.projection?.revision).toBe("2"),
  );
  expect(opencode.result.current.projection?.currentAgentKind).toBe("opencode");
  opencode.unmount();
});
