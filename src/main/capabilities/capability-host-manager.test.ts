import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { CapabilityHostManager, type CapabilityUtilityProcess } from "./capability-host-manager";
import type { MainToHostMessage } from "./host-protocol";

class FakeChild extends EventEmitter implements CapabilityUtilityProcess {
  sent: MainToHostMessage[] = [];
  killed = false;
  postMessage(message: MainToHostMessage): void { this.sent.push(message); }
  onMessage(listener: (message: unknown) => void): void { this.on("message", listener); }
  onExit(listener: (code: number) => void): void { this.on("exit", listener); }
  kill(): boolean { this.killed = true; return true; }
}

describe("CapabilityHostManager", () => {
  it("owns one host per run, correlates updates and rotates tokens", async () => {
    const children: FakeChild[] = [];
    const resolveSecret = vi.fn().mockResolvedValue("secret");
    const manager = new CapabilityHostManager({ launch: () => { const child = new FakeChild(); children.push(child); return child; }, resolveSecret, startupTimeoutMs: 100 });
    const firstPromise = manager.ensureHost("run-1");
    const samePromise = manager.ensureHost("run-1");
    children[0].emit("message", { type: "host.ready", runId: "run-1", port: 43123 });
    const [first, same] = await Promise.all([firstPromise, samePromise]);
    expect(first).toEqual(same);
    expect(children).toHaveLength(1);
    const applied = manager.setActiveCapabilities("run-1", ["agentic-worktrees.web-search"]);
    await vi.waitFor(() => expect(children[0].sent.at(-1)?.type).toBe("host.capabilities.set"));
    const set = children[0].sent.at(-1);
    if (set?.type !== "host.capabilities.set") throw new Error("expected set message");
    children[0].emit("message", { type: "host.capabilities.applied", requestId: set.requestId, toolNames: ["web_search"] });
    await expect(applied).resolves.toEqual(["web_search"]);
    children[0].emit("message", { type: "host.secret.request", requestId: "secret-1", capabilityId: "cap", settingKey: "key" });
    await vi.waitFor(() => expect(children[0].sent).toContainEqual({ type: "host.secret.result", requestId: "secret-1", value: "secret" }));
    manager.stopHost("run-1");
    const secondPromise = manager.ensureHost("run-1");
    children[1].emit("message", { type: "host.ready", runId: "run-1", port: 43124 });
    const second = await secondPromise;
    expect(second.bearerToken).not.toBe(first.bearerToken);
    await manager.stopAll();
    expect(children.every((child) => child.killed)).toBe(true);
  });
});
