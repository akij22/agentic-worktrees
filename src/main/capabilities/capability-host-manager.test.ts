import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  CapabilityHostManager,
  type CapabilityUtilityProcess,
} from "./capability-host-manager";
import type { MainToHostMessage } from "./host-protocol";
import { createBundledCapability } from "./catalog";
import { webSearchManifest } from "@agentic-worktrees/web-search";

const webEntry = createBundledCapability(webSearchManifest, ["web_search"]);
const testCatalog = {
  list: () => [webEntry],
  get: () => webEntry,
  refresh: async () => undefined,
};

class FakeChild extends EventEmitter implements CapabilityUtilityProcess {
  sent: MainToHostMessage[] = [];
  killed = false;
  killCalls = 0;
  postMessage(message: MainToHostMessage): void {
    this.sent.push(message);
  }
  onMessage(listener: (message: unknown) => void): () => void {
    this.on("message", listener);
    return () => this.off("message", listener);
  }
  onExit(listener: (code: number) => void): () => void {
    this.on("exit", listener);
    return () => this.off("exit", listener);
  }
  removeMessageListener(listener: (message: unknown) => void): void {
    this.off("message", listener);
  }
  removeExitListener(listener: (code: number) => void): void {
    this.off("exit", listener);
  }
  kill(): boolean {
    this.killed = true;
    this.killCalls++;
    return true;
  }
}

describe("CapabilityHostManager", () => {
  it("owns one host per run, correlates updates and rotates tokens", async () => {
    const children: FakeChild[] = [];
    const resolveSecret = vi.fn().mockResolvedValue("secret");
    const manager = new CapabilityHostManager({
      catalog: testCatalog,
      launch: () => {
        const child = new FakeChild();
        children.push(child);
        return child;
      },
      resolveSecret,
      startupTimeoutMs: 100,
    });
    const firstPromise = manager.ensureHost("run-1");
    const samePromise = manager.ensureHost("run-1");
    children[0].emit("message", {
      type: "host.ready",
      runId: "run-1",
      port: 43123,
    });
    const [first, same] = await Promise.all([firstPromise, samePromise]);
    expect(first).toEqual(same);
    expect(children).toHaveLength(1);
    const applied = manager.setActiveCapabilities("run-1", [
      "agentic-worktrees.web-search",
    ]);
    await vi.waitFor(() =>
      expect(children[0].sent.at(-1)?.type).toBe("host.capabilities.set"),
    );
    const set = children[0].sent.at(-1);
    if (set?.type !== "host.capabilities.set")
      throw new Error("expected set message");
    children[0].emit("message", {
      type: "host.capabilities.applied",
      requestId: set.requestId,
      toolNames: ["web_search"],
    });
    await expect(applied).resolves.toEqual(["web_search"]);
    children[0].emit("message", {
      type: "host.secret.request",
      requestId: "secret-1",
      capabilityId: "agentic-worktrees.web-search",
      settingKey: "exaApiKey",
    });
    await vi.waitFor(() =>
      expect(children[0].sent).toContainEqual({
        type: "host.secret.result",
        requestId: "secret-1",
        value: "secret",
      }),
    );
    children[0].emit("message", {
      type: "host.secret.request",
      requestId: "secret-2",
      capabilityId: "inactive-capability",
      settingKey: "key",
    });
    children[0].emit("message", {
      type: "host.secret.request",
      requestId: "secret-3",
      capabilityId: "agentic-worktrees.web-search",
      settingKey: "providerMode",
    });
    expect(children[0].sent).toContainEqual({
      type: "host.secret.result",
      requestId: "secret-2",
      errorCode: "missing_secret",
    });
    expect(children[0].sent).toContainEqual({
      type: "host.secret.result",
      requestId: "secret-3",
      errorCode: "missing_secret",
    });
    expect(resolveSecret).toHaveBeenCalledTimes(1);
    manager.stopHost("run-1");
    const secondPromise = manager.ensureHost("run-1");
    children[1].emit("message", {
      type: "host.ready",
      runId: "run-1",
      port: 43124,
    });
    const second = await secondPromise;
    expect(second.bearerToken).not.toBe(first.bearerToken);
    await manager.stopAll();
    expect(children.every((child) => child.killed)).toBe(true);
  });

  it("rejects stopped startup and updates that receive no acknowledgement", async () => {
    const children: FakeChild[] = [];
    const manager = new CapabilityHostManager({
      catalog: testCatalog,
      launch: () => {
        const child = new FakeChild();
        children.push(child);
        return child;
      },
      resolveSecret: vi.fn(),
      startupTimeoutMs: 100,
      updateTimeoutMs: 5,
    });
    const starting = manager.ensureHost("starting");
    const stopped = expect(starting).rejects.toMatchObject({
      code: "cancelled",
    });
    manager.stopHost("starting");
    await stopped;

    const ready = manager.ensureHost("ready");
    children[1].emit("message", {
      type: "host.ready",
      runId: "ready",
      port: 43123,
    });
    await ready;
    await expect(
      manager.setActiveCapabilities("ready", ["agentic-worktrees.web-search"]),
    ).rejects.toMatchObject({ code: "activation_failed" });
    manager.stopHost("ready");
  });

  it.each(["token", "listener", "postMessage"] as const)(
    "cleans an owned child exactly once when post-launch %s setup throws",
    async (phase) => {
      const child = new FakeChild();
      if (phase === "listener") {
        child.onMessage = (listener) => {
          child.on("message", listener);
          throw new Error("/private/listener");
        };
      }
      if (phase === "postMessage") {
        child.postMessage = () => {
          throw new Error("/private/post");
        };
      }
      const manager = new CapabilityHostManager({
        catalog: testCatalog,
        launch: () => child,
        resolveSecret: async () => undefined,
        ...(phase === "token"
          ? {
              createToken: () => {
                throw new Error("/private/random");
              },
            }
          : {}),
      });
      const failure = manager.ensureHost("failed");
      await expect(failure).rejects.toMatchObject({
        code: "internal_error",
        message: "Capability host failed to start.",
      });
      expect(child.killCalls).toBe(1);
      expect(child.listenerCount("message")).toBe(0);
      expect(child.listenerCount("exit")).toBe(0);
      expect(
        JSON.stringify(
          await failure.catch((error) => ({
            message: error.message,
            code: error.code,
          })),
        ),
      ).not.toContain("/private");
      manager.stopHost("failed");
      expect(child.killCalls).toBe(1);
    },
  );

  it("continues listener and child cleanup when one disposer throws", async () => {
    const child = new FakeChild();
    const logError = vi.fn();
    child.onMessage = (listener) => {
      child.on("message", listener);
      return () => {
        throw new Error("/private/disposer");
      };
    };
    const manager = new CapabilityHostManager({
      catalog: testCatalog,
      launch: () => child,
      resolveSecret: async () => undefined,
      logError,
    });
    const ready = manager.ensureHost("dispose");
    child.emit("message", {
      type: "host.ready",
      runId: "dispose",
      port: 43123,
    });
    await ready;
    const pending = manager.setActiveCapabilities("dispose", [
      "agentic-worktrees.web-search",
    ]);
    await Promise.resolve();
    manager.stopHost("dispose");
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(logError).toHaveBeenCalledWith(
      "capability_host_listener_cleanup_failed",
    );
    expect(child.listenerCount("message")).toBe(0);
    expect(child.listenerCount("exit")).toBe(0);
    expect(child.killCalls).toBe(1);
    manager.stopHost("dispose");
    expect(child.killCalls).toBe(1);
  });

  it("retains local cleanup ownership when exit removes the startup record", async () => {
    const child = new FakeChild();
    child.postMessage = () => {
      child.emit("exit", 1);
      throw new Error("/private/post-after-exit");
    };
    const manager = new CapabilityHostManager({
      catalog: testCatalog,
      launch: () => child,
      resolveSecret: async () => undefined,
    });
    await expect(manager.ensureHost("exit-race")).rejects.toMatchObject({
      code: "internal_error",
      message: "Capability host failed to start.",
    });
    expect(child.listenerCount("message")).toBe(0);
    expect(child.listenerCount("exit")).toBe(0);
    expect(child.killCalls).toBe(0);
    manager.stopHost("exit-race");
    expect(child.killCalls).toBe(0);
  });

  it("fully releases ownership when a running child exits unexpectedly", async () => {
    const child = new FakeChild();
    const manager = new CapabilityHostManager({
      catalog: testCatalog,
      launch: () => child,
      resolveSecret: async () => undefined,
    });
    const ready = manager.ensureHost("unexpected-exit");
    child.emit("message", {
      type: "host.ready",
      runId: "unexpected-exit",
      port: 43123,
    });
    await ready;
    const pending = manager.setActiveCapabilities("unexpected-exit", [
      "agentic-worktrees.web-search",
    ]);
    await Promise.resolve();
    child.emit("exit", 1);
    await expect(pending).rejects.toMatchObject({ code: "internal_error" });
    expect(child.listenerCount("message")).toBe(0);
    expect(child.listenerCount("exit")).toBe(0);
    expect(child.killCalls).toBe(0);
    manager.stopHost("unexpected-exit");
    expect(child.killCalls).toBe(0);
  });

  it("resolves descriptors before launch and kills an existing host on lookup failure", async () => {
    const children: FakeChild[] = [];
    const catalog = {
      ...testCatalog,
      get: (id: string) => {
        if (id === "unknown") throw new Error("catalog_collision");
        return webEntry;
      },
    };
    const manager = new CapabilityHostManager({
      catalog,
      launch: () => {
        const child = new FakeChild();
        children.push(child);
        return child;
      },
      resolveSecret: async () => undefined,
      startupTimeoutMs: 100,
    });
    expect(() => manager.ensureHost("never-launched", ["unknown"])).toThrow(
      "catalog_collision",
    );
    expect(children).toHaveLength(0);
    const ready = manager.ensureHost("existing");
    children[0].emit("message", {
      type: "host.ready",
      runId: "existing",
      port: 43123,
    });
    await ready;
    await expect(
      manager.setActiveCapabilities("existing", ["unknown"]),
    ).rejects.toThrow("catalog_collision");
    expect(children[0].killed).toBe(true);
    expect(children).toHaveLength(1);
  });

  it("ignores malformed host messages", async () => {
    const children: FakeChild[] = [];
    const manager = new CapabilityHostManager({
      catalog: testCatalog,
      launch: () => {
        const child = new FakeChild();
        children.push(child);
        return child;
      },
      resolveSecret: vi.fn(),
      startupTimeoutMs: 5,
    });
    const starting = manager.ensureHost("run-1");
    children[0].emit("message", {
      type: "host.ready",
      runId: "run-1",
      port: 70_000,
    });
    await expect(starting).rejects.toThrow("startup timed out");
  });
  it("forwards owned-generation observations and waits for exact cancellation acknowledgement", async () => {
    const child = new FakeChild();
    const observations: unknown[] = [];
    const manager = new CapabilityHostManager({
      catalog: testCatalog,
      launch: () => child,
      resolveSecret: async () => undefined,
      onObservation: (owner, generation, event) =>
        observations.push({ owner, generation, event }),
    });
    const ready = manager.ensureHost("owner", [], {}, "runtime");
    child.emit("message", { type: "host.ready", runId: "owner", port: 43123 });
    await ready;
    const event = {
      type: "entered",
      invocationId: "11111111-1111-4111-8111-111111111111",
      capabilityId: "test.echo",
      capabilityVersion: "0.1.0",
      toolName: "echo_text",
    };
    child.emit("message", {
      type: "host.observation",
      runtimeGenerationId: "stale",
      observation: event,
    });
    expect(observations).toEqual([]);
    child.emit("message", {
      type: "host.observation",
      runtimeGenerationId: "runtime",
      observation: event,
    });
    expect(observations).toEqual([
      { owner: "owner", generation: "runtime", event },
    ]);
    await expect(
      manager.cancelInvocation("owner", "stale", event.invocationId),
    ).resolves.toBe(false);
    const cancelled = manager.cancelInvocation(
      "owner",
      "runtime",
      event.invocationId,
    );
    const command = child.sent.at(-1);
    if (command?.type !== "host.invocation.cancel")
      throw new Error("Expected exact cancel command");
    child.emit("message", {
      type: "host.invocation.cancelled",
      requestId: command.requestId,
      runtimeGenerationId: "runtime",
      invocationId: event.invocationId,
      accepted: true,
    });
    await expect(cancelled).resolves.toBe(true);
    await manager.stopAll();
  });
});

it("does not report owned host shutdown until the exact utility process exits",async()=>{
  const child=new FakeChild();
  const manager=new CapabilityHostManager({launch:()=>child,resolveSecret:async()=>undefined});
  const ready=manager.ensureHost("owned",[],{},"generation");
  child.emit("message",{type:"host.ready",runId:"owned",port:3333});
  await ready;
  let stopped=false;
  const stopping=manager.stopOwnedHost("owned","generation").then(()=>{stopped=true;});
  await Promise.resolve();expect(stopped).toBe(false);
  child.emit("exit",0);await stopping;expect(stopped).toBe(true);
});

it("does not finish failed owned startup until the exact child exits",async()=>{
  const child=new FakeChild();
  child.postMessage=()=>{throw new Error("Synthetic initialization failure");};
  const manager=new CapabilityHostManager({catalog:testCatalog,launch:()=>child,resolveSecret:async()=>undefined});
  let finished=false;
  const starting=manager.ensureHost("owned",[],{},"generation").catch(error=>{finished=true;throw error;});
  const rejected=expect(starting).rejects.toThrow("Capability host failed to start");
  await new Promise<void>(resolve=>setImmediate(resolve));
  expect(finished).toBe(false);
  expect(child.killCalls).toBe(1);
  child.emit("exit",0);
  await rejected;
  expect(child.listenerCount("message")).toBe(0);
  expect(child.listenerCount("exit")).toBe(0);
});
