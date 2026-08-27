import type { CodingAgentKind, CodingAgentCapabilityConnection } from "../coding-agents/types";

export interface CodingAgentCapabilityActivator {
  prepareSession(runId: string, agentKind: CodingAgentKind): Promise<CodingAgentCapabilityConnection>;
  apply(runId: string, expectedToolNames: string[]): Promise<"refreshed" | "reloaded">;
  remove(runId: string): Promise<"refreshed" | "reloaded">;
  isAgentIdle(runId: string): Promise<boolean>;
}
