import { beforeEach, expect, it, vi } from "vitest";
import { ipcRenderer } from "electron";
import type { Api } from "./shared/ipc/api";
import { IPC_CHANNELS } from "./shared/ipc/channels";
const boundary = vi.hoisted(() => ({
  api: null as unknown,
  listeners: new Map<string, (event: unknown, payload: unknown) => void>(),
  remove: vi.fn(),
}));
vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, value: unknown) => {
      boundary.api = value;
    },
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: (
      channel: string,
      listener: (event: unknown, payload: unknown) => void,
    ) => boundary.listeners.set(channel, listener),
    removeListener: boundary.remove,
  },
}));
let api: Api;
beforeEach(async () => {
  vi.resetModules();
  vi.mocked(ipcRenderer.invoke).mockReset();
  boundary.listeners.clear();
  boundary.remove.mockClear();
  await import("./preload");
  api = boundary.api as Api;
});
it("validates Assignment requests and responses and converts transport failures into safe results", async () => {
  vi.mocked(ipcRenderer.invoke).mockRejectedValueOnce(
    new Error("/private token"),
  );
  await expect(
    api.resourceAssignment.get({ worktreeId: "wt", agentKind: "codex" }),
  ).resolves.toMatchObject({ ok: false, error: { code: "internal_error" } });
  expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(
    IPC_CHANNELS.RESOURCE_ASSIGNMENT_GET,
    { worktreeId: "wt", agentKind: "codex" },
  );
  vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({
    ok: true,
    value: { path: "/private" },
  });
  await expect(
    api.resourceAssignment.get({ worktreeId: "wt", agentKind: "codex" }),
  ).resolves.toMatchObject({ ok: false, error: { code: "internal_error" } });
  const calls = vi.mocked(ipcRenderer.invoke).mock.calls.length;
  await expect(
    api.resourceAssignment.setDesired({
      worktreeId: "wt",
      expectedRevision: "01",
      resources: [],
    }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: "assignment_invalid_resource" },
  });
  expect(vi.mocked(ipcRenderer.invoke).mock.calls.length).toBe(calls);
});
it("exposes exactly the narrow operations and validates activity snapshots, deltas and unsubscribe identity", async () => {
  expect(Object.keys(api.resourceAssignment).sort()).toEqual([
    "cancelPending",
    "get",
    "onChanged",
    "recover",
    "retry",
    "setDesired",
  ]);
  expect(Object.keys(api.resourceActivity).sort()).toEqual([
    "list",
    "onChanged",
  ]);
  vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({
    ok: true,
    value: { runId: "run", sequence: "0", items: [] },
  });
  await expect(api.resourceActivity.list({ runId: "run" })).resolves.toEqual({
    ok: true,
    value: { runId: "run", sequence: "0", items: [] },
  });
  expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(
    IPC_CHANNELS.RESOURCE_ACTIVITY_LIST,
    { runId: "run" },
  );
  const listener = vi.fn(),
    invalid = vi.fn(),
    off = api.resourceActivity.onChanged(listener, invalid);
  const registered = boundary.listeners.get(
    IPC_CHANNELS.RESOURCE_ACTIVITY_CHANGED,
  );
  if (!registered) throw new Error("Activity listener was not installed.");
  const event = {
    eventId: "e",
    runId: "run",
    sequence: "1",
    change: { type: "remove", activityId: "activity" },
  };
  registered({}, event);
  registered({}, { ...event, receipt: "private-token" });
  expect(listener).toHaveBeenCalledExactlyOnceWith(event);
  expect(invalid).toHaveBeenCalledOnce();
  off();
  expect(boundary.remove).toHaveBeenCalledWith(
    IPC_CHANNELS.RESOURCE_ACTIVITY_CHANGED,
    registered,
  );
});
it("maps all Assignment mutations to their distinct channels and rejects oversized requests before invoke", async () => {
  const safe = {
    ok: false,
    error: {
      code: "assignment_waiting_for_idle",
      message: "Waiting for active sessions.",
      retryable: false,
    },
  };
  vi.mocked(ipcRenderer.invoke).mockResolvedValue(safe);
  const revision = { worktreeId: "wt", expectedRevision: "0" };
  await expect(
    api.resourceAssignment.setDesired({ ...revision, resources: [] }),
  ).resolves.toEqual(safe);
  expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(
    IPC_CHANNELS.RESOURCE_ASSIGNMENT_SET,
    { ...revision, resources: [] },
  );
  await api.resourceAssignment.retry(revision);
  expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(
    IPC_CHANNELS.RESOURCE_ASSIGNMENT_RETRY,
    revision,
  );
  await api.resourceAssignment.cancelPending(revision);
  expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(
    IPC_CHANNELS.RESOURCE_ASSIGNMENT_CANCEL_PENDING,
    revision,
  );
  await api.resourceAssignment.recover({
    ...revision,
    action: "retry_recovery",
  });
  expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(
    IPC_CHANNELS.RESOURCE_ASSIGNMENT_RECOVER,
    { ...revision, action: "retry_recovery" },
  );
  const count = vi.mocked(ipcRenderer.invoke).mock.calls.length;
  const result = await api.resourceAssignment.setDesired({
    ...revision,
    expectedRevision: "1".repeat(70_000),
    resources: [],
  });
  expect(result).toMatchObject({
    ok: false,
    error: { code: "assignment_invalid_resource" },
  });
  expect(vi.mocked(ipcRenderer.invoke).mock.calls.length).toBe(count);
});
