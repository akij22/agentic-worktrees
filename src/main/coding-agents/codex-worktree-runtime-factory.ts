import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { CodexAdapter } from "./codex-adapter";
import {
  CODEX_RUNTIME_VERSION,
  CODEX_SKILL_ISOLATION,
  type CodexWorktreeRuntimeOptions,
} from "./codex-worktree-runtime";
import type {
  OwnedWorktreeRuntime,
  WorktreeRuntimeFactory,
} from "./worktree-runtime-manager";

interface CodexRuntimePlan {
  executablePath: string;
  options: CodexWorktreeRuntimeOptions;
  /** Captured main-process Host Manager ownership; never a process-name search. */
  stopOwnedHosts?(): Promise<void>;
}
interface CodexRuntimeFactoryDependencies {
  storageRoot: string;
  loadPlan(
    input: Parameters<WorktreeRuntimeFactory["create"]>[0],
  ): Promise<CodexRuntimePlan>;
  onExit?(worktreeId: string, generation: string, cleanupFailed: boolean): void;
}
interface OwnedCodexRuntime extends OwnedWorktreeRuntime {
  readonly skillIsolation: typeof CODEX_SKILL_ISOLATION;
  adapter: CodexAdapter;
}
/** Provider-specific factory; the Assignment coordinator supplies only a frozen, verified activation plan. */
export class CodexWorktreeRuntimeFactory implements WorktreeRuntimeFactory {
  private readonly runtimes = new Map<string, OwnedCodexRuntime>();
  constructor(private readonly dependencies: CodexRuntimeFactoryDependencies) {}
  async create(
    input: Parameters<WorktreeRuntimeFactory["create"]>[0],
  ): Promise<OwnedCodexRuntime> {
    if (
      input.agentKind !== "codex" ||
      !/^[a-f0-9-]{36}$/.test(input.namespaceId)
    )
      throw new Error("Codex runtime ownership is invalid.");
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
      throw new Error("Codex owned activation plan is incomplete.");
    await mkdir(this.dependencies.storageRoot, {
      recursive: true,
      mode: 0o700,
    });
    const storageRoot = await realpath(this.dependencies.storageRoot);
    const worktreeKey = createHash("sha256")
      .update(input.worktreeId)
      .digest("hex");
    const adapter = new CodexAdapter(undefined, undefined, {
      ...options,
      namespaceRoot: join(storageRoot, input.namespaceId),
      sessionDataRoot: join(storageRoot, "worktree-data", worktreeKey),
    });
    let stopping = false;
    let exitCleanup: Promise<void> | undefined;
    let exitCleanupFailure: unknown;
    const unsubscribe = adapter.subscribe((event) => {
      if (event.type === "server.exit" && !stopping) {
        exitCleanup = Promise.resolve()
          .then(() => stopOwnedHosts?.())
          .then(
            () => {
              this.runtimes.delete(`${input.worktreeId}\0${input.generation}`);
              this.dependencies.onExit?.(
                input.worktreeId,
                input.generation,
                false,
              );
            },
            (error) => {
              exitCleanupFailure = error;
              this.runtimes.delete(`${input.worktreeId}\0${input.generation}`);
              this.dependencies.onExit?.(
                input.worktreeId,
                input.generation,
                true,
              );
            },
          );
      }
    });
    try {
      await adapter.start(plan.executablePath, options.directory);
      if (!adapter.getStatus().running || adapter.getStatus().error)
        throw new Error("Codex owned provider exited during activation.");
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
          "Owned Codex activation cleanup could not be verified.",
        );
      throw error;
    }
    const key = `${input.worktreeId}\0${input.generation}`;
    const runtime: OwnedCodexRuntime = {
      agentKind: "codex",
      worktreeId: input.worktreeId,
      generation: input.generation,
      providerVersion: CODEX_RUNTIME_VERSION,
      skillIsolation: CODEX_SKILL_ISOLATION,
      adapter,
      cancelOwnedWork: () => adapter.cancelOwnedWork(),
      stop: async () => {
        stopping = true;
        await exitCleanup;
        const failures: unknown[] = exitCleanupFailure
          ? [exitCleanupFailure]
          : [];
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
            "Owned Codex runtime shutdown could not be verified.",
          );
      },
    };
    this.runtimes.set(key, runtime);
    return runtime;
  }
  getAdapter(worktreeId: string, generation: string): CodexAdapter {
    const runtime = this.runtimes.get(`${worktreeId}\0${generation}`);
    if (!runtime)
      throw new Error("Owned Codex runtime generation is unavailable.");
    return runtime.adapter;
  }
}
