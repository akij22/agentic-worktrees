import { describe, expect, it, vi } from "vitest";
import { createOwnedWorktreeRuntime } from "./owned-worktree-runtime";
import {
  WorktreeRuntimeManager,
  type OwnedWorktreeRuntime,
  type WorktreeRuntimeFactory,
} from "./worktree-runtime-manager";

const createFactory = () => {
  const runtimes: OwnedWorktreeRuntime[] = [];
  const factory: WorktreeRuntimeFactory = {
    create: vi.fn(async ({ agentKind, worktreeId, generation }) => {
      const runtime: OwnedWorktreeRuntime = {
        agentKind,
        worktreeId,
        generation,
        providerVersion: "1.0.0",
        stop: vi.fn(async () => undefined),
      };
      runtimes.push(runtime);
      return runtime;
    }),
  };
  return { factory, runtimes };
};

describe("WorktreeRuntimeManager", () => {
  it("reuses one owned runtime within a Worktree and never shares across Worktrees", async () => {
    const { factory } = createFactory();
    const manager = new WorktreeRuntimeManager({ factory });

    const first = await manager.acquireRuntime("codex", "worktree-a");
    const second = await manager.acquireRuntime("codex", "worktree-a");
    const other = await manager.acquireRuntime("codex", "worktree-b");

    expect(second.runtime).toBe(first.runtime);
    expect(other.runtime).not.toBe(first.runtime);
    expect(first.runtime.generation).toMatch(/:codex:worktree-a:1$/);
    expect(other.runtime.generation).toMatch(/:codex:worktree-b:1$/);
    expect(factory.create).toHaveBeenCalledTimes(2);

    second.release();
    first.release();
    other.release();
  });

  it("coalesces concurrent acquisitions before reserving capacity", async () => {
    const { factory } = createFactory();
    const manager = new WorktreeRuntimeManager({ factory, maximumRuntimes: 1 });
    const acquisitions = Promise.all([
      manager.acquireRuntime("codex", "same"),
      manager.acquireRuntime("codex", "same"),
    ]);
    const leases = await acquisitions;
    expect(leases[0].runtime).toBe(leases[1].runtime);
    leases.forEach((lease) => lease.release());
    await manager.shutdown();
  });

  it("waits for in-flight startup and stops its owner during application shutdown", async () => {
    let complete!: () => void;
    const stop = vi.fn(async () => undefined);
    const manager = new WorktreeRuntimeManager({ factory: {
      create: ({ agentKind, worktreeId, generation }) => new Promise((resolve) => {
        complete = () => resolve({ agentKind, worktreeId, generation, providerVersion: "1", stop });
      }),
    } });
    const pending = manager.acquireRuntime("codex", "starting");
    const rejected = expect(pending).rejects.toThrow(/shutting down/);
    await new Promise<void>((resolve) => setImmediate(resolve));
    let finished = false;
    const shutdown = manager.shutdown().then(() => { finished = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(finished).toBe(false);
    complete();
    await shutdown;
    await rejected;
    expect(stop).toHaveBeenCalledWith(5_000);
  });

  it("cancels one coalesced waiter without cancelling the other owner's startup", async () => {
    const { factory } = createFactory();
    const manager = new WorktreeRuntimeManager({ factory, maximumRuntimes: 1 });
    const occupied = await manager.acquireRuntime("codex", "occupied");
    const controller = new AbortController();
    const cancelled = manager.acquireRuntime("codex", "same", { signal: controller.signal });
    const other = manager.acquireRuntime("codex", "same");
    controller.abort();
    await expect(cancelled).rejects.toThrow(/cancelled/);
    occupied.release();
    (await other).release();
    await manager.shutdown();
  });

  it("allocates separate opaque private namespaces per runtime generation", async () => {
    const namespaces: string[] = [];
    const { factory } = createFactory();
    const create = factory.create;
    factory.create = async (input) => {
      namespaces.push(input.namespaceId);
      return create(input);
    };
    const manager = new WorktreeRuntimeManager({ factory });
    const first = await manager.acquireRuntime("codex", "a");
    const reused = await manager.acquireRuntime("codex", "a");
    const other = await manager.acquireRuntime("codex", "b");
    expect(namespaces).toHaveLength(2);
    expect(new Set(namespaces).size).toBe(2);
    expect(namespaces.every((id) => /^[a-f0-9-]{36}$/.test(id))).toBe(true);
    first.release(); reused.release(); other.release();
    await manager.shutdown();
  });

  it("gracefully stops only captured process owners and verifies ownership before force", async () => {
    const force = vi.fn(async () => undefined);
    const verifyOwnership = vi.fn(async () => false);
    const process = { requestStop: vi.fn(async () => undefined),
      waitForExit: vi.fn(async () => false), verifyOwnership, forceStop: force };
    const manager = new WorktreeRuntimeManager({ factory: { create: async (input) =>
      createOwnedWorktreeRuntime({ ...input, providerVersion: "1" }, [process]) } });
    (await manager.acquireRuntime("codex", "owned")).release();
    await expect(manager.shutdown()).rejects.toThrow(/ownership/);
    expect(process.waitForExit).toHaveBeenCalledWith(5_000);
    expect(force).not.toHaveBeenCalled();
    verifyOwnership.mockResolvedValue(true);
    process.waitForExit.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await manager.shutdown();
    expect(force).toHaveBeenCalledOnce();
  });

  it("never reuses persisted generation identity after manager restart", async () => {
    const { factory } = createFactory();
    const firstManager = new WorktreeRuntimeManager({ factory });
    const first = await firstManager.acquireRuntime("codex", "same");
    const generation = first.runtime.generation;
    first.release();
    await firstManager.shutdown();
    const secondManager = new WorktreeRuntimeManager({ factory });
    const second = await secondManager.acquireRuntime("codex", "same");
    expect(second.runtime.generation).not.toBe(generation);
    second.release();
    await secondManager.shutdown();
  });

  it("reports a failed capacity eviction without hanging queued admission", async () => {
    const { factory, runtimes } = createFactory();
    const manager = new WorktreeRuntimeManager({ factory, maximumRuntimes: 1 });
    (await manager.acquireRuntime("codex", "a")).release();
    vi.mocked(runtimes[0].stop).mockRejectedValue(new Error("owned process did not exit"));
    await expect(manager.acquireRuntime("codex", "b")).rejects.toThrow(/shutdown|evict/);
    vi.mocked(runtimes[0].stop).mockResolvedValue(undefined);
    await manager.shutdown();
  });

  it("waits for every owned shutdown even when another owner fails", async () => {
    const { factory, runtimes } = createFactory();
    const manager = new WorktreeRuntimeManager({ factory });
    (await manager.acquireRuntime("codex", "fails")).release();
    (await manager.acquireRuntime("opencode", "slow")).release();
    vi.mocked(runtimes[0].stop).mockRejectedValue(new Error("failed shutdown"));
    let finish!: () => void;
    vi.mocked(runtimes[1].stop).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    let finished = false;
    const shutdown = manager.shutdown().catch((error: unknown) => { finished = true; return error; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(finished).toBe(false);
    finish();
    expect(await shutdown).toBeInstanceOf(Error);
    vi.mocked(runtimes[0].stop).mockResolvedValue(undefined);
    await manager.shutdown();
  });

  it("queues a fifth runtime, never evicts leased runtimes, and supports queue cancellation", async () => {
    const { factory, runtimes } = createFactory();
    const manager = new WorktreeRuntimeManager({ factory, maximumRuntimes: 4 });
    const leases = await Promise.all(
      ["a", "b", "c", "d"].map((worktreeId) => manager.acquireRuntime("codex", worktreeId)),
    );

    const controller = new AbortController();
    const cancelled = manager.acquireRuntime("codex", "cancelled", {
      signal: controller.signal,
    });
    controller.abort();
    await expect(cancelled).rejects.toThrow(/cancelled/i);

    let acquired = false;
    const fifth = manager.acquireRuntime("codex", "e").then((lease) => {
      acquired = true;
      return lease;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(acquired).toBe(false);
    expect(runtimes.every((runtime) => !vi.mocked(runtime.stop).mock.calls.length)).toBe(true);

    leases[0].release();
    const fifthLease = await fifth;
    expect(fifthLease.runtime.worktreeId).toBe("e");
    expect(runtimes.find((runtime) => runtime.worktreeId === "a")?.stop).toHaveBeenCalledWith(5_000);
    fifthLease.release();
    leases.slice(1).forEach((lease) => lease.release());
  });

  it("does not hold an Assignment reader while waiting for capacity", async () => {
    const { factory } = createFactory();
    const manager = new WorktreeRuntimeManager({ factory, maximumRuntimes: 1,
      attestationVerifier: { verify: async () => true } });
    const occupied = await manager.acquireRuntime("codex", "occupied");
    const queued = manager.acquireProviderSession({ agentKind: "codex", worktreeId: "waiting",
      runId: "run", operation: "create", assignmentGenerationId: "assignment",
      catalogGenerationId: "catalog" });
    let writerAcquired = false;
    const writer = manager.acquireAdmission("waiting", "exclusive").then((lease) => {
      writerAcquired = true;
      return lease;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(writerAcquired).toBe(true);
    (await writer).release();
    occupied.release();
    (await queued).release();
    await manager.shutdown();
  });

  it("rejects pending Assignment admission on application exit", async () => {
    const { factory } = createFactory();
    const manager = new WorktreeRuntimeManager({ factory });
    const writer = await manager.acquireAdmission("a", "exclusive");
    const queued = manager.acquireAdmission("a", "normal");
    const rejected = expect(queued).rejects.toThrow(/shutting down/);
    await manager.shutdown();
    writer.release();
    await rejected;
  });

  it("cancels queued provider admission behind an Assignment writer", async () => {
    const { factory } = createFactory();
    const manager = new WorktreeRuntimeManager({ factory,
      attestationVerifier: { verify: async () => true } });
    const writer = await manager.acquireAdmission("a", "exclusive");
    const controller = new AbortController();
    const queued = manager.acquireProviderSession({ agentKind: "codex", worktreeId: "a",
      runId: "run", operation: "create", assignmentGenerationId: "assignment",
      catalogGenerationId: "catalog", signal: controller.signal });
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    writer.release();
    await expect(queued).rejects.toThrow(/cancelled/);
    await manager.shutdown();
  });

  it("prefers an Assignment writer while keeping the control lane available", async () => {
    const { factory } = createFactory();
    const manager = new WorktreeRuntimeManager({ factory });
    const firstReader = await manager.acquireAdmission("worktree-a", "normal");
    let writerAcquired = false;
    const writer = manager.acquireAdmission("worktree-a", "exclusive").then((lease) => {
      writerAcquired = true;
      return lease;
    });
    let lateReaderAcquired = false;
    const lateReader = manager.acquireAdmission("worktree-a", "normal").then((lease) => {
      lateReaderAcquired = true;
      return lease;
    });

    const control = await manager.acquireAdmission("worktree-a", "control");
    expect(writerAcquired).toBe(false);
    expect(lateReaderAcquired).toBe(false);
    control.release();

    firstReader.release();
    const writerLease = await writer;
    expect(writerAcquired).toBe(true);
    expect(lateReaderAcquired).toBe(false);
    writerLease.release();
    (await lateReader).release();
  });

  it("routes provider events only by exact Worktree, runtime and app-run lineage", async () => {
    const { factory } = createFactory();
    const manager = new WorktreeRuntimeManager({ factory });
    const a = await manager.acquireRuntime("codex", "a");
    const b = await manager.acquireRuntime("codex", "b");
    const route = { agentKind: "codex" as const, externalSessionId: "provider-local-id",
      assignmentGenerationId: "assignment", catalogGenerationId: "catalog" };
    manager.registerSessionRoute({ ...route, worktreeId: "a", runtimeGeneration: a.runtime.generation, runId: "run-a" });
    manager.registerSessionRoute({ ...route, worktreeId: "b", runtimeGeneration: b.runtime.generation, runId: "run-b" });
    expect(manager.resolveSessionRoute({ ...route, worktreeId: "a", runtimeGeneration: a.runtime.generation })).toEqual({ runId: "run-a" });
    expect(manager.resolveSessionRoute({ ...route, worktreeId: "a", runtimeGeneration: b.runtime.generation })).toBeNull();
    a.release();
    b.release();
    await manager.shutdown();
  });

  it("admits provider work only with exact attestation and session-route lineage", async () => {
    const { factory } = createFactory();
    const verify = vi.fn(async () => true);
    const manager = new WorktreeRuntimeManager({
      factory,
      attestationVerifier: { verify },
    });
    const lineage = {
      assignmentGenerationId: "assignment-a",
      catalogGenerationId: "catalog-a",
    };

    const created = await manager.acquireProviderSession({
      agentKind: "codex",
      worktreeId: "worktree-a",
      runId: "run-a",
      operation: "create",
      ...lineage,
    });
    manager.registerSessionRoute({
      agentKind: "codex",
      worktreeId: "worktree-a",
      runId: "run-a",
      externalSessionId: "provider-session-a",
      runtimeGeneration: created.runtime.generation,
      ...lineage,
    });
    created.release();

    const resumed = await manager.acquireProviderSession({
      agentKind: "codex",
      worktreeId: "worktree-a",
      runId: "run-a",
      externalSessionId: "provider-session-a",
      operation: "resume",
      ...lineage,
    });
    expect(verify).toHaveBeenLastCalledWith({
      agentKind: "codex",
      worktreeId: "worktree-a",
      runtimeGeneration: created.runtime.generation,
      providerVersion: "1.0.0",
      ...lineage,
    });
    resumed.release();

    await expect(manager.acquireProviderSession({
      agentKind: "codex",
      worktreeId: "worktree-a",
      runId: "run-b",
      externalSessionId: "provider-session-a",
      operation: "turn",
      ...lineage,
    })).rejects.toThrow(/session route/i);
  });

  it("allows only one active turn per owned runtime", async () => {
    const { factory } = createFactory();
    const manager = new WorktreeRuntimeManager({
      factory,
      attestationVerifier: { verify: async () => true },
    });
    const lineage = {
      assignmentGenerationId: "assignment-a",
      catalogGenerationId: "catalog-a",
    };
    const created = await manager.acquireProviderSession({
      agentKind: "opencode",
      worktreeId: "worktree-a",
      runId: "run-a",
      operation: "create",
      ...lineage,
    });
    manager.registerSessionRoute({
      agentKind: "opencode",
      worktreeId: "worktree-a",
      runId: "run-a",
      externalSessionId: "session-a",
      runtimeGeneration: created.runtime.generation,
      ...lineage,
    });
    created.release();
    const turnInput = {
      agentKind: "opencode" as const,
      worktreeId: "worktree-a",
      runId: "run-a",
      externalSessionId: "session-a",
      operation: "turn" as const,
      ...lineage,
    };
    const first = await manager.acquireProviderSession(turnInput);
    let secondAcquired = false;
    const second = manager.acquireProviderSession(turnInput).then((lease) => {
      secondAcquired = true;
      return lease;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(secondAcquired).toBe(false);
    first.release();
    (await second).release();
  });

  it("rechecks attestation after a queued turn reaches the runtime", async () => {
    const { factory } = createFactory();
    let valid = true;
    const manager = new WorktreeRuntimeManager({ factory,
      attestationVerifier: { verify: async () => valid } });
    const input = { agentKind: "codex" as const, worktreeId: "a", runId: "run",
      assignmentGenerationId: "assignment", catalogGenerationId: "catalog" };
    const created = await manager.acquireProviderSession({ ...input, operation: "create" });
    manager.registerSessionRoute({ ...input, externalSessionId: "session",
      runtimeGeneration: created.runtime.generation });
    created.release();
    const turn = { ...input, externalSessionId: "session", operation: "turn" as const };
    const first = await manager.acquireProviderSession(turn);
    const queued = manager.acquireProviderSession(turn);
    await new Promise<void>((resolve) => setImmediate(resolve));
    valid = false;
    first.release();
    await expect(queued).rejects.toThrow(/attestation/);
    await manager.shutdown();
  });

  it("rejects queued turns when their exact runtime exits", async () => {
    const { factory } = createFactory();
    const manager = new WorktreeRuntimeManager({ factory,
      attestationVerifier: { verify: async () => true } });
    const input = { agentKind: "codex" as const, worktreeId: "a", runId: "run",
      assignmentGenerationId: "assignment", catalogGenerationId: "catalog" };
    const created = await manager.acquireProviderSession({ ...input, operation: "create" });
    manager.registerSessionRoute({ ...input, externalSessionId: "session",
      runtimeGeneration: created.runtime.generation });
    created.release();
    const first = await manager.acquireProviderSession({ ...input, externalSessionId: "session", operation: "turn" });
    const queued = manager.acquireProviderSession({ ...input, externalSessionId: "session", operation: "turn" });
    const rejected = expect(queued).rejects.toThrow(/exited|invalidated/);
    await new Promise<void>((resolve) => setImmediate(resolve));
    manager.reportRuntimeExit("codex", "a", first.runtime.generation);
    first.release();
    await rejected;
    await manager.shutdown();
  });

  it("recovers quarantine with a greater generation while ordinary leases stay blocked", async () => {
    const { factory } = createFactory();
    const manager = new WorktreeRuntimeManager({ factory });
    const old = await manager.acquireRuntime("codex", "a");
    old.release();
    manager.quarantineRuntime("codex", "a", old.runtime.generation, "mismatch");
    await expect(manager.acquireRuntime("codex", "a")).rejects.toThrow(/quarantin/);
    const control = await manager.acquireControlRuntime("codex", "a", old.runtime.generation);
    control.release();
    const recovered = await manager.recoverRuntime("codex", "a", old.runtime.generation);
    expect(recovered.runtime.generation).not.toBe(old.runtime.generation);
    recovered.release();
    await manager.shutdown();
  });

  it("quarantines ordinary admission and restarts a crashed runtime at a greater generation", async () => {
    const { factory } = createFactory();
    const invalidated = vi.fn();
    const manager = new WorktreeRuntimeManager({
      factory,
      attestationVerifier: { verify: async () => true },
      onRuntimeInvalidated: invalidated,
    });
    const first = await manager.acquireRuntime("codex", "worktree-a");
    const firstGeneration = first.runtime.generation;
    first.release();

    manager.quarantineRuntime("codex", "worktree-a", firstGeneration, "route_conflict");
    await expect(manager.acquireProviderSession({
      agentKind: "codex",
      worktreeId: "worktree-a",
      runId: "run-a",
      operation: "create",
      assignmentGenerationId: "assignment-a",
      catalogGenerationId: "catalog-a",
    })).rejects.toThrow(/quarantined/i);
    (await manager.acquireAdmission("worktree-a", "control")).release();

    manager.reportRuntimeExit("codex", "worktree-a", firstGeneration);
    expect(invalidated).toHaveBeenCalledWith({
      agentKind: "codex",
      worktreeId: "worktree-a",
      runtimeGeneration: firstGeneration,
      reason: "process_exit",
    });
    const restarted = await manager.acquireRuntime("codex", "worktree-a");
    expect(restarted.runtime.generation).toMatch(/:codex:worktree-a:2$/);
    restarted.release();
  });

  it("waits for targeted shutdown before acquiring a replacement generation", async () => {
    const { factory, runtimes } = createFactory();
    let finishStop!: () => void;
    const manager = new WorktreeRuntimeManager({ factory, now: () => 100_000 });
    const first = await manager.acquireRuntime("codex", "same");
    first.release();
    vi.mocked(runtimes[0].stop).mockImplementation(() => new Promise((resolve) => { finishStop = resolve; }));
    // Capacity eviction starts shutdown immediately for an idle owner.
    const others = await Promise.all(["b", "c", "d"].map((id) => manager.acquireRuntime("codex", id)));
    const fifth = manager.acquireRuntime("codex", "e");
    await new Promise<void>((resolve) => setImmediate(resolve));
    let acquired = false;
    const replacement = manager.acquireRuntime("codex", "same").then((lease) => {
      acquired = true;
      return lease;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(acquired).toBe(false);
    finishStop();
    const fifthLease = await fifth;
    fifthLease.release();
    const replacementLease = await replacement;
    expect(replacementLease.runtime.generation).not.toBe(first.runtime.generation);
    replacementLease.release();
    others.forEach((lease) => lease.release());
    await manager.shutdown();
  });

  it("automatically stops an unleased runtime after sixty seconds", async () => {
    vi.useFakeTimers();
    try {
      const { factory, runtimes } = createFactory();
      const manager = new WorktreeRuntimeManager({ factory });
      (await manager.acquireRuntime("codex", "idle")).release();
      await vi.advanceTimersByTimeAsync(59_999);
      expect(runtimes[0].stop).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(runtimes[0].stop).toHaveBeenCalledWith(5_000);
      await manager.shutdown();
    } finally { vi.useRealTimers(); }
  });

  it("evicts only the eligible least-recently-used owner under memory pressure", async () => {
    const { factory, runtimes } = createFactory();
    let now = 0;
    const manager = new WorktreeRuntimeManager({ factory, now: () => now });
    (await manager.acquireRuntime("codex", "oldest")).release();
    now = 10;
    (await manager.acquireRuntime("opencode", "newer")).release();
    const writer = await manager.acquireAdmission("oldest", "exclusive");
    await manager.evictIdle({ memoryPressure: true });
    expect(runtimes[0].stop).not.toHaveBeenCalled();
    expect(runtimes[1].stop).toHaveBeenCalledWith(5_000);
    writer.release();
    await manager.shutdown();
  });

  it("evicts only runtimes idle for sixty seconds and shuts down only tracked owners", async () => {
    const { factory, runtimes } = createFactory();
    let now = 1_000;
    const manager = new WorktreeRuntimeManager({ factory, now: () => now });
    const idle = await manager.acquireRuntime("codex", "idle");
    idle.release();
    const leased = await manager.acquireRuntime("opencode", "leased");

    now += 59_999;
    expect(await manager.evictIdle()).toEqual([]);
    now += 1;
    expect(await manager.evictIdle()).toEqual([{
      agentKind: "codex",
      worktreeId: "idle",
      runtimeGeneration: idle.runtime.generation,
    }]);
    expect(runtimes.find((runtime) => runtime.worktreeId === "idle")?.stop).toHaveBeenCalledWith(5_000);
    expect(runtimes.find((runtime) => runtime.worktreeId === "leased")?.stop).not.toHaveBeenCalled();

    await manager.shutdown();
    expect(runtimes.find((runtime) => runtime.worktreeId === "leased")?.stop).toHaveBeenCalledWith(5_000);
    leased.release();
  });

  it("enforces the per-provider runtime capacity independently of total capacity", async () => {
    const { factory } = createFactory();
    const manager = new WorktreeRuntimeManager({
      factory,
      maximumRuntimes: 4,
      maximumRuntimesPerProvider: 2,
    });
    const first = await manager.acquireRuntime("codex", "a");
    const second = await manager.acquireRuntime("codex", "b");
    const openCode = await manager.acquireRuntime("opencode", "c");
    let thirdCodexAcquired = false;
    const thirdCodex = manager.acquireRuntime("codex", "d").then((lease) => {
      thirdCodexAcquired = true;
      return lease;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(thirdCodexAcquired).toBe(false);
    first.release();
    (await thirdCodex).release();
    second.release();
    openCode.release();
  });

  it("runs Worktree deletion only after owned shutdown and reopens after deletion failure", async () => {
    const { factory, runtimes } = createFactory();
    const manager = new WorktreeRuntimeManager({ factory });
    (await manager.acquireRuntime("codex", "delete")).release();
    await expect(manager.stopWorktree("delete", async () => {
      expect(runtimes[0].stop).toHaveBeenCalledWith(5_000);
      await expect(manager.acquireRuntime("codex", "delete")).rejects.toThrow(/remov/);
      throw new Error("Git refused dirty Worktree removal");
    })).rejects.toThrow(/Git refused/);
    (await manager.acquireRuntime("codex", "delete")).release();
    await manager.shutdown();
  });

  it("drains a Worktree before targeted deletion without stopping another Worktree", async () => {
    const { factory, runtimes } = createFactory();
    const manager = new WorktreeRuntimeManager({
      factory,
      attestationVerifier: { verify: async () => true },
    });
    const active = await manager.acquireProviderSession({
      agentKind: "codex",
      worktreeId: "remove-me",
      runId: "run-a",
      operation: "create",
      assignmentGenerationId: "assignment-a",
      catalogGenerationId: "catalog-a",
    });
    const other = await manager.acquireRuntime("codex", "keep-me");
    other.release();

    let removed = false;
    const removal = manager.stopWorktree("remove-me").then(() => {
      removed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(removed).toBe(false);
    active.release();
    await removal;

    expect(runtimes.find((runtime) => runtime.worktreeId === "remove-me")?.stop).toHaveBeenCalledWith(5_000);
    expect(runtimes.find((runtime) => runtime.worktreeId === "keep-me")?.stop).not.toHaveBeenCalled();
  });
});
