import type { OwnedWorktreeRuntime } from "./worktree-runtime-manager";

/** A process handle captured by the provider launcher, never supplied by IPC.
 * Ownership verification must check the original process identity, including
 * descendants; a PID or a matching executable name alone is insufficient.
 */
export interface OwnedRuntimeProcess {
  requestStop(): Promise<void>;
  waitForExit(timeoutMs: number): Promise<boolean>;
  verifyOwnership(): Promise<boolean>;
  forceStop(): Promise<void>;
}

export function createOwnedWorktreeRuntime(
  identity: Omit<OwnedWorktreeRuntime, "stop">,
  processes: readonly OwnedRuntimeProcess[],
): OwnedWorktreeRuntime {
  const owners = [...processes];
  let stopping: Promise<void> | undefined;
  let stopped = false;
  return {
    ...identity,
    stop(gracePeriodMs) {
      if (stopped) return Promise.resolve();
      if (stopping) return stopping;
      stopping = (async () => {
        const results = await Promise.allSettled(owners.map(async (owner) => {
          await owner.requestStop();
          if (await owner.waitForExit(gracePeriodMs)) return;
          if (!await owner.verifyOwnership()) {
            throw new Error("Runtime process ownership could not be verified.");
          }
          await owner.forceStop();
          if (!await owner.waitForExit(1_000)) {
            throw new Error("Owned runtime process did not exit after targeted shutdown.");
          }
        }));
        const failures = results.filter((result) => result.status === "rejected");
        if (failures.length) throw new AggregateError(
          failures.map((result) => result.reason), "Runtime process shutdown failed: ownership or exit unverified.",
        );
        stopped = true;
      })().finally(() => { stopping = undefined; });
      return stopping;
    },
  };
}
