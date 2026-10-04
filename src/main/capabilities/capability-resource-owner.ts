import type { InspectedCapabilityPackage } from "./package-inspector";
import type { CapabilityUpdateConfiguration } from "./capability-update-configuration";

/** Main-owned package effects, serialized with all affected Worktree Assignments. */
export interface CapabilityResourceTransaction {
  stage(): Promise<void>;
  commit(): void;
  rollback(): Promise<void>;
  finalize(): Promise<void>;
}
export interface CapabilityResourceOwner {
  activeRuns(capabilityId: string): readonly string[];
  publish(
    inspected: InspectedCapabilityPackage,
    configuration: CapabilityUpdateConfiguration | undefined,
    transaction: CapabilityResourceTransaction,
  ): Promise<void>;
  remove(
    capabilityId: string,
    operationId: string,
    transaction: CapabilityResourceTransaction,
  ): Promise<void>;
}
