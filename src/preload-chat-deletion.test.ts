import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "./shared/ipc/api";
import { IPC_CHANNELS } from "./shared/ipc/channels";
const mocks = vi.hoisted(() => ({ api: null as unknown, invoke: vi.fn() }));
vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: unknown) => {
      mocks.api = api;
    },
  },
  ipcRenderer: { invoke: mocks.invoke },
}));

beforeEach(async () => {
  mocks.invoke.mockReset();
  vi.resetModules();
  await import("./preload");
});

describe("chat deletion preload", () => {
  it("uses the dedicated channel and returns the validated result", async () => {
    mocks.invoke.mockResolvedValue({ success: true });
    const result = await (mocks.api as Api).codingAgent.deleteSession({
      runId: "chat-1",
    });
    expect(result).toEqual({ success: true });
    expect(mocks.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.CODING_AGENT_SESSION_DELETE,
      { runId: "chat-1" },
    );
  });
  it("rejects malformed responses containing unexpected data", async () => {
    mocks.invoke.mockResolvedValue({ success: true, token: "private" });
    await expect(
      (mocks.api as Api).codingAgent.deleteSession({ runId: "chat-1" }),
    ).rejects.toThrow();
  });
});

describe("native chat menu preload", () => {
  it("uses the dedicated menu channel and validates selection", async () => {
    mocks.invoke.mockResolvedValue({ success: true, action: "delete" });
    const request = { runId: "chat-1", x: 10, y: 20 };
    expect(
      await (mocks.api as Api).codingAgent.showSessionContextMenu(request),
    ).toEqual({ success: true, action: "delete" });
    expect(mocks.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.CODING_AGENT_CONTEXT_MENU,
      request,
    );
  });
  it("rejects arbitrary menu actions from malformed responses", async () => {
    mocks.invoke.mockResolvedValue({ success: true, action: "execute" });
    await expect(
      (mocks.api as Api).codingAgent.showSessionContextMenu({
        runId: "chat-1",
        x: 0,
        y: 0,
      }),
    ).rejects.toThrow();
  });
});
