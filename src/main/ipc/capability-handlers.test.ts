import { describe, expect, it, vi } from "vitest";
import { createCapabilityHandlers } from "./capability-handlers";

describe("capability IPC handlers", () => {
  it("rejects malformed payloads before service delegation", async () => {
    const service = { activateCapability: vi.fn(), deactivateCapability: vi.fn(), listCapabilities: vi.fn(), getCapability: vi.fn(), configureCapability: vi.fn() };
    const handlers = createCapabilityHandlers(service as never);
    await expect(handlers.activate({ capabilityId: "Invalid" })).rejects.toThrow();
    expect(service.activateCapability).not.toHaveBeenCalled();
  });
  it("delegates validated activation without leaking connection fields", async () => {
    const response = { runId: "run-1", capabilityId: "agentic-worktrees.web-search", name: "Web Search", version: "0.1.0", state: "active", bearerToken: "private", url: "private" };
    const service = { activateCapability: vi.fn().mockResolvedValue(response), deactivateCapability: vi.fn(), listCapabilities: vi.fn(), getCapability: vi.fn(), configureCapability: vi.fn() };
    const value = await createCapabilityHandlers(service as never).activate({ runId: "run-1", capabilityId: "agentic-worktrees.web-search" });
    expect(service.activateCapability).toHaveBeenCalledWith("run-1", "agentic-worktrees.web-search");
    expect(value).not.toHaveProperty("bearerToken");
    expect(value).not.toHaveProperty("url");
  });
});
