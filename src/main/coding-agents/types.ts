export type CodingAgentRunStatus =
  | "creating"
  | "idle"
  | "busy"
  | "waiting_permission"
  | "aborting"
  | "error"
  | "unavailable";

export type CodingAgentKind = "opencode" | "codex";

export interface CodingAgentModel {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  reasoningVariants: string[];
  isDefault: boolean;
}

export type CodingAgentToolCallStatus =
  | "pending"
  | "running"
  | "completed"
  | "error";

export interface CodingAgentToolCall {
  id: string;
  tool: string;
  status: CodingAgentToolCallStatus;
  title: string;
  detail: string;
}

export interface CodingAgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning: string;
  tools: CodingAgentToolCall[];
  createdAt: number;
  completedAt: number | null;
}

export interface CodingAgentDiff {
  file: string;
  before: string;
  after: string;
  additions: number;
  deletions: number;
}

export interface CodingAgentPermission {
  id: string;
  sessionId: string;
  title: string;
  type: string;
  metadata: Record<string, unknown>;
}

export interface CodingAgentEvent {
  directory: string;
  sessionId: string | null;
  type: string;
  properties: unknown;
}

export interface CodingAgentCapabilityConnection {
  serverName: string;
  url: string;
  authorizationHeader: string;
  profileId: string;
}

export interface CodingAgentSessionOptions {
  modelId: string;
  capabilities?: CodingAgentCapabilityConnection;
}

export interface CodingAgentSessionUsage {
  contextTokens: number;
  contextWindow: number;
  contextPercentage: number;
  totalCost?: number;
  providerId: string;
  modelId: string;
}

export interface CodingAgentAccountUsageWindow {
  durationMinutes: number | null;
  remainingPercentage: number;
  resetsAt: number | null;
}

export interface CodingAgentAccountUsage {
  providerId: string;
  availability: "available" | "unavailable";
  message?: string;
  planType?: string;
  windows: CodingAgentAccountUsageWindow[];
}

export interface CodingAgentAdapter {
  getStatus(): {
    running: boolean;
    version: string | null;
    error: string | null;
  };
  start(executablePath: string, cwd: string): Promise<string>;
  stop(): Promise<void>;
  listModels(directory: string): Promise<CodingAgentModel[]>;
  createSession(
    directory: string,
    title: string,
    options: CodingAgentSessionOptions,
  ): Promise<{ id: string }>;
  getSession(
    directory: string,
    sessionId: string,
    options?: { capabilities?: CodingAgentCapabilityConnection },
  ): Promise<{
    id: string;
    status?: "idle" | "busy" | "error";
  }>;
  listMessages(
    directory: string,
    sessionId: string,
  ): Promise<CodingAgentMessage[]>;
  getDiff(
    directory: string,
    sessionId: string,
    messageId?: string,
  ): Promise<CodingAgentDiff[]>;
  sendPrompt(
    directory: string,
    sessionId: string,
    input: {
      content: string;
      providerId: string;
      modelId: string;
      reasoningVariant?: string;
      capabilityProfileId?: string;
    },
  ): Promise<void>;
  compact(
    directory: string,
    sessionId: string,
    input: { providerId: string; modelId: string; capabilityProfileId?: string },
  ): Promise<void>;
  refreshCapabilities?(
    directory: string,
    sessionId: string,
    connection: CodingAgentCapabilityConnection,
    expectedToolNames: string[],
  ): Promise<void>;
  reconfigureCapabilities?(input: {
    connections: CodingAgentCapabilityConnection[];
    sessions: Array<{
      directory: string;
      sessionId: string;
      capabilityProfileId?: string;
      capabilities?: CodingAgentCapabilityConnection;
    }>;
    expectedToolNamesByProfile?: Record<string, string[]>;
    absentConnections?: CodingAgentCapabilityConnection[];
  }): Promise<void>;
  getUsage(
    directory: string,
    sessionId: string,
    input: { providerId: string; modelId: string },
  ): Promise<CodingAgentSessionUsage>;
  getAccountUsage(
    directory: string,
    sessionId: string,
    input: { providerId: string; modelId: string },
  ): Promise<CodingAgentAccountUsage>;
  abort(directory: string, sessionId: string): Promise<void>;
  respondPermission(
    directory: string,
    sessionId: string,
    permissionId: string,
    response: "once" | "always" | "reject",
  ): Promise<void>;
  subscribe(listener: (event: CodingAgentEvent) => void): () => void;
}
