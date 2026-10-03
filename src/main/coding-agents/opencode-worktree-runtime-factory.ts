import { WorktreeRuntimeStartupError } from "./worktree-runtime-manager";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { OpenCodeAdapter } from "./opencode-adapter";
import {
  OPENCODE_RUNTIME_VERSION,
  type OpenCodeWorktreeRuntimeOptions,
} from "./opencode-worktree-runtime";
import type {
  OwnedWorktreeRuntime,
  WorktreeRuntimeFactory,
} from "./worktree-runtime-manager";

interface OpenCodeRuntimePlan {
  executablePath: string;
  options: OpenCodeWorktreeRuntimeOptions;
  /** Captured main-process Host Manager ownership; never a process-name search. */
  stopOwnedHosts?(): Promise<void>;
}
interface OpenCodeRuntimeFactoryDependencies {
  storageRoot: string;
  loadPlan(
    input: Parameters<WorktreeRuntimeFactory["create"]>[0],
  ): Promise<OpenCodeRuntimePlan>;
  onExit?(worktreeId: string, generation: string): void;
}
interface OwnedOpenCodeRuntime extends OwnedWorktreeRuntime {
  adapter: OpenCodeAdapter;
}
/** Provider-specific factory; the Assignment coordinator supplies only a frozen, verified activation plan. */
export class OpenCodeWorktreeRuntimeFactory implements WorktreeRuntimeFactory {
  private readonly runtimes = new Map<string, OwnedOpenCodeRuntime>();
  constructor(
    private readonly dependencies: OpenCodeRuntimeFactoryDependencies,
  ) {}
  async create(
    input: Parameters<WorktreeRuntimeFactory["create"]>[0],
  ): Promise<OwnedOpenCodeRuntime> {
    if (
      input.agentKind !== "opencode" ||
      !/^[a-f0-9-]{36}$/.test(input.namespaceId)
    )
      throw new Error("OpenCode runtime ownership is invalid.");
    const plan = await this.dependencies.loadPlan(input),
      options = {
        ...plan.options,
        lineage: structuredClone(plan.options.lineage),
      };
    const stopOwnedHosts = plan.stopOwnedHosts?.bind(plan);
    if (
      options.lineage.worktreeId !== input.worktreeId ||
      options.lineage.runtimeGenerationId !== input.generation ||
      !options.evidence ||
      !options.onVerified ||
      !options.verifyAttestation ||
      !options.onUnavailable ||
      (options.capabilities.length > 0 &&
        (!options.subscribeHostObservations || !plan.stopOwnedHosts))
    )
      throw new Error("OpenCode owned activation plan is incomplete.");
    await mkdir(this.dependencies.storageRoot, {
      recursive: true,
      mode: 0o700,
    });
    const storageRoot = await realpath(this.dependencies.storageRoot);
    const worktreeKey = createHash("sha256")
      .update(input.worktreeId)
      .digest("hex");
    const adapter = new OpenCodeAdapter(10_000, 10_000, {
      ...options,
      namespaceRoot: join(storageRoot, input.namespaceId),
      sessionDataRoot: join(storageRoot, "worktree-data", worktreeKey),
    });
    let stopping = false;
    const unsubscribe = adapter.subscribe((event) => {
      if (event.type === "server.exit" && !stopping)
        this.dependencies.onExit?.(input.worktreeId, input.generation);
    });
    try {
      await adapter.start(plan.executablePath, options.directory);
    } catch (error) {
      unsubscribe();
      const cleanup = await Promise.allSettled([
        adapter.stop(),
        Promise.resolve().then(() => stopOwnedHosts?.()),
        Promise.resolve().then(() => {
          options.onUnavailable?.(options.lineage);
          options.evidence?.retireRuntime(options.lineage);
        }),
      ]);
      if (cleanup.some((result) => result.status === "rejected"))
        throw new Error(
          "Owned OpenCode activation cleanup could not be verified.",
        );
      throw new WorktreeRuntimeStartupError(error, true);
    }
    const key = `${input.worktreeId}\0${input.generation}`;
    const runtime: OwnedOpenCodeRuntime = {
      agentKind: "opencode",
      worktreeId: input.worktreeId,
      generation: input.generation,
      providerVersion: OPENCODE_RUNTIME_VERSION,
      adapter,
      cancelOwnedWork: () => adapter.cancelOwnedWork(),
      stop: async () => {
        stopping = true;
        const failures: unknown[] = [];
        try {
          await adapter.cancelOwnedWork();
        } catch (error) {
          failures.push(error);
        }
        try {
          await stopOwnedHosts?.();
        } catch (error) {
          failures.push(error);
        }
        try {
          await adapter.stop();
        } catch (error) {
          failures.push(error);
        }
        try {
          options.onUnavailable?.(options.lineage);
          options.evidence?.retireRuntime(options.lineage);
        } catch (error) {
          failures.push(error);
        }
        unsubscribe();
        this.runtimes.delete(key);
        if (failures.length)
          throw new Error(
            "Owned OpenCode runtime shutdown could not be verified.",
          );
      },
    };
    this.runtimes.set(key, runtime);
    return runtime;
  }
  getAdapter(worktreeId: string, generation: string): OpenCodeAdapter {
    const runtime = this.runtimes.get(`${worktreeId}\0${generation}`);
    if (!runtime)
      throw new Error("Owned OpenCode runtime generation is unavailable.");
    return runtime.adapter;
  }
}
