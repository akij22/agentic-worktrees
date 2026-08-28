export type CapabilityAgentKind = "codex" | "opencode";
export type CapabilityCompatibility = "supported" | "unsupported";

export type CapabilitySetting =
  | { type: "string"; enum?: readonly string[]; default?: string; required?: boolean }
  | { type: "integer"; default?: number; min?: number; max?: number; required?: boolean }
  | { type: "boolean"; default?: boolean; required?: boolean }
  | { type: "secret"; required: boolean };

export interface CapabilityManifest {
  id: string;
  name: string;
  version: string;
  sdkVersion: string;
  description: string;
  category: string;
  author: { name: string; url?: string };
  license: string;
  compatibility: Record<CapabilityAgentKind, CapabilityCompatibility>;
  provenance?: {
    kind: string;
    source: string;
    package: string;
    sourceVersion: string;
    repository: string;
  };
  permissions: { network: string[]; secrets: string[] };
  settings: Record<string, CapabilitySetting>;
}

export interface CapabilityTextContent {
  type: "text";
  text: string;
}

export interface CapabilityToolResult {
  content: CapabilityTextContent[];
  details?: unknown;
  isError?: boolean;
}

export interface CapabilityExecutionContext {
  signal: AbortSignal;
  settings: Readonly<Record<string, unknown>>;
  secrets: {
    get(name: string): Promise<string>;
    getOptional(name: string): Promise<string | undefined>;
  };
  logger: {
    info(event: string, fields?: Readonly<Record<string, string | number | boolean>>): void;
    error(event: string, fields?: Readonly<Record<string, string | number | boolean>>): void;
  };
}

export interface CapabilityTool<Input = unknown> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Input, context: CapabilityExecutionContext): Promise<CapabilityToolResult>;
}

export interface CapabilityDefinition {
  manifest: CapabilityManifest;
  tools: readonly CapabilityTool<unknown>[];
}
