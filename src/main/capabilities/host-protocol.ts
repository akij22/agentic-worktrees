import type { CapabilityErrorCode } from "@agentic-worktrees/capability-sdk";

export type MainToHostMessage =
  | { type: "host.initialize"; runId: string; token: string; activeCapabilityIds: string[]; settings: Record<string, Record<string, unknown>> }
  | { type: "host.capabilities.set"; requestId: string; capabilityIds: string[]; settings: Record<string, Record<string, unknown>> }
  | { type: "host.secret.result"; requestId: string; value?: string; errorCode?: "missing_secret" };

export type HostToMainMessage =
  | { type: "host.ready"; runId: string; port: number }
  | { type: "host.secret.request"; requestId: string; capabilityId: string; settingKey: string }
  | { type: "host.capabilities.applied"; requestId: string; toolNames: string[] }
  | { type: "host.error"; requestId?: string; code: CapabilityErrorCode; message: string };

export function isMainToHostMessage(value: unknown): value is MainToHostMessage {
  return Boolean(value && typeof value === "object" && "type" in value && typeof (value as { type: unknown }).type === "string");
}
export function isHostToMainMessage(value: unknown): value is HostToMainMessage {
  return Boolean(value && typeof value === "object" && "type" in value && typeof (value as { type: unknown }).type === "string");
}
