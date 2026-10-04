// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SessionResourceActivityChangedEvent } from "../../../../shared/resource-activity/schemas";
import { useSessionResourceActivity } from "./useSessionResourceActivity";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const item = {
  id: "activity",
  resourceKind: "skill" as const,
  resourceId: "review",
  resourceVersion: "1",
  requestState: "requested" as const,
  useState: "not_confirmed" as const,
  lifecycle: "open" as const,
  outcome: "not_observed" as const,
  mode: "explicit" as const,
  coverage: "qualified" as const,
  occurredAt: "2026-10-03T10:00:00.000Z",
};
it("applies exact-run deltas, upserts once, removes conflicts, refetches gaps and cleans up without polling", async () => {
  let changed: (event: SessionResourceActivityChangedEvent) => void = () =>
    undefined;
  const off = vi.fn(),
    list = vi.fn().mockResolvedValue({
      ok: true,
      value: { runId: "run", sequence: "0", items: [] },
    });
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      resourceActivity: {
        list,
        onChanged: (listener: typeof changed) => {
          changed = listener;
          return off;
        },
      },
    },
  });
  const hook = renderHook(() => useSessionResourceActivity("run"));
  await waitFor(() => expect(hook.result.current.snapshot?.sequence).toBe("0"));
  const event = {
    eventId: "e1",
    runId: "run",
    sequence: "1",
    change: { type: "upsert" as const, item },
  };
  act(() => {
    changed({ ...event, runId: "another-run" });
    changed(event);
    changed(event);
  });
  expect(hook.result.current.snapshot?.items).toHaveLength(1);
  expect(list).toHaveBeenCalledTimes(1);
  act(() =>
    changed({
      eventId: "e2",
      runId: "run",
      sequence: "2",
      change: { type: "remove", activityId: "activity" },
    }),
  );
  expect(hook.result.current.snapshot?.items).toEqual([]);
  list.mockResolvedValue({
    ok: true,
    value: { runId: "run", sequence: "4", items: [item] },
  });
  act(() => changed({ ...event, eventId: "e4", sequence: "4" }));
  await waitFor(() => expect(hook.result.current.snapshot?.sequence).toBe("4"));
  expect(list).toHaveBeenCalledTimes(2);
  hook.unmount();
  expect(off).toHaveBeenCalledOnce();
});
it("preserves events arriving during the initial list and rejects old-run replies after navigation", async () => {
  let changed: (event: SessionResourceActivityChangedEvent) => void = () =>
    undefined;
  let resolveInitial: (value: unknown) => void = () => undefined;
  const first = new Promise((resolve) => {
    resolveInitial = resolve;
  });
  const list = vi
    .fn()
    .mockReturnValueOnce(first)
    .mockResolvedValue({
      ok: true,
      value: { runId: "run", sequence: "1", items: [item] },
    });
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      resourceActivity: {
        list,
        onChanged: (listener: typeof changed) => {
          changed = listener;
          return () => undefined;
        },
      },
    },
  });
  const hook = renderHook(({ run }) => useSessionResourceActivity(run), {
    initialProps: { run: "run" },
  });
  act(() =>
    changed({
      eventId: "e1",
      runId: "run",
      sequence: "1",
      change: { type: "upsert", item },
    }),
  );
  await act(async () => {
    resolveInitial({
      ok: true,
      value: { runId: "run", sequence: "0", items: [] },
    });
    await first;
  });
  await waitFor(() =>
    expect(hook.result.current.snapshot?.items).toEqual([item]),
  );
  list.mockResolvedValue({
    ok: true,
    value: { runId: "other", sequence: "0", items: [] },
  });
  hook.rerender({ run: "other" });
  await waitFor(() =>
    expect(hook.result.current.snapshot?.runId).toBe("other"),
  );
  act(() =>
    changed({
      eventId: "late",
      runId: "run",
      sequence: "2",
      change: { type: "upsert", item },
    }),
  );
  expect(hook.result.current.snapshot?.runId).toBe("other");
  hook.unmount();
});
it("refetches a retained-history boundary instead of throwing when a delta exceeds the snapshot limit", async () => {
  let changed: (event: SessionResourceActivityChangedEvent) => void = () =>
    undefined;
  const items = Array.from({ length: 1000 }, (_, index) => ({
    ...item,
    id: `history-${index}`,
  }));
  const list = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      value: { runId: "run", sequence: "1", items },
    });
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      resourceActivity: {
        list,
        onChanged: (listener: typeof changed) => {
          changed = listener;
          return () => undefined;
        },
      },
    },
  });
  const hook = renderHook(() => useSessionResourceActivity("run"));
  await waitFor(() =>
    expect(hook.result.current.snapshot?.items).toHaveLength(1000),
  );
  list.mockResolvedValue({
    ok: true,
    value: { runId: "run", sequence: "2", items: [...items.slice(1), item] },
  });
  expect(() =>
    act(() =>
      changed({
        eventId: "e2",
        runId: "run",
        sequence: "2",
        change: { type: "upsert", item },
      }),
    ),
  ).not.toThrow();
  await waitFor(() => expect(hook.result.current.snapshot?.sequence).toBe("2"));
  expect(list).toHaveBeenCalledTimes(2);
  hook.unmount();
});
