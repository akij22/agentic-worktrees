import { expect, it, vi } from "vitest";
import { createResourceIpcPublisher } from "./resource-ipc";
import { IPC_CHANNELS } from "../../shared/ipc/channels";
import { assignmentProjectionSchema } from "../../shared/assignments/schemas";
const projection = assignmentProjectionSchema.parse({
  worktreeId: "wt",
  revision: "0",
  projectionSequence: "1",
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
it("broadcasts safe committed changes to all authorized windows and rechecks exact run ownership", () => {
  const windows = [1, 2, 3, 4].map((id) => ({ id, send: vi.fn() }));
  const publisher = createResourceIpcPublisher({
    windows: () => windows,
    isTrustedSender: (id) => id !== 4,
    canAccessWorktree: (id, wt) => id !== 3 && wt === "wt",
    getRunWorktree: (run) => (run === "run" ? "wt" : null),
    canAccessRun: (id, run, wt) => id === 2 && run === "run" && wt === "wt",
  });
  publisher.assignment({
    eventId: "event",
    worktreeId: "wt",
    revision: "0",
    projectionSequence: "1",
    projection,
  });
  for (const window of windows.slice(0, 2))
    expect(window.send).toHaveBeenCalledWith(
      IPC_CHANNELS.RESOURCE_ASSIGNMENT_CHANGED,
      expect.objectContaining({ eventId: "event" }),
    );
  for (const window of windows.slice(2))
    expect(window.send).not.toHaveBeenCalled();
  const activity = {
    eventId: "activity-event",
    runId: "run",
    sequence: "1",
    change: { type: "remove", activityId: "activity" },
  };
  publisher.activity(activity);
  expect(windows[1].send).toHaveBeenLastCalledWith(
    IPC_CHANNELS.RESOURCE_ACTIVITY_CHANGED,
    activity,
  );
  expect(windows[0].send).toHaveBeenCalledTimes(1);
  publisher.activity({ ...activity, receipt: "private" });
  expect(windows[1].send).toHaveBeenCalledTimes(2);
});
it("continues delivery to other windows on a send failure and preserves publication failure for replay", () => {
  const received: unknown[] = [];
  const publisher = createResourceIpcPublisher({
    windows: () => [
      {
        id: 1,
        send: () => {
          throw new Error("Window closed");
        },
      },
      { id: 2, send: (_channel, payload) => received.push(payload) },
    ],
    isTrustedSender: () => true,
    canAccessWorktree: () => true,
    getRunWorktree: () => null,
    canAccessRun: () => false,
  });
  const event = {
    eventId: "replay",
    worktreeId: "wt",
    revision: "0",
    projectionSequence: "1",
    projection,
  };
  expect(() => publisher.assignment(event)).toThrow(
    "Resource IPC delivery failed.",
  );
  expect(received).toHaveLength(1);
  expect(() => publisher.assignment(event)).toThrow();
  expect(received).toHaveLength(2);
});
it("keeps invalid Assignment publication failed rather than acknowledging an undelivered outbox record", () => {
  const send = vi.fn();
  const publisher = createResourceIpcPublisher({
    windows: () => [{ id: 1, send }],
    isTrustedSender: () => true,
    canAccessWorktree: () => true,
    getRunWorktree: () => null,
    canAccessRun: () => false,
  });
  expect(() =>
    publisher.assignment({
      eventId: "invalid",
      worktreeId: "wt",
      revision: "0",
      projectionSequence: "1",
      projection: { ...projection, path: "/private" },
    }),
  ).toThrow("Invalid Assignment publication.");
  expect(send).not.toHaveBeenCalled();
});
