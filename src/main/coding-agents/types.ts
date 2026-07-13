export type CodingAgentRunStatus =
  | 'creating'
  | 'idle'
  | 'busy'
  | 'waiting_permission'
  | 'aborting'
  | 'error'
  | 'unavailable';

export interface CodingAgentModel {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  reasoningVariants: string[];
}

export interface CodingAgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning: string;
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
  type: string;
  properties: unknown;
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
  createSession(directory: string, title: string): Promise<{ id: string }>;
  getSession(directory: string, sessionId: string): Promise<{ id: string }>;
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
    },
  ): Promise<void>;
  abort(directory: string, sessionId: string): Promise<void>;
  respondPermission(
    directory: string,
    sessionId: string,
    permissionId: string,
    response: 'once' | 'always' | 'reject',
  ): Promise<void>;
  subscribe(listener: (event: CodingAgentEvent) => void): () => void;
}
