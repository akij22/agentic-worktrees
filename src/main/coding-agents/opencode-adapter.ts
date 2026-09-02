import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { CapabilityError } from "@agentic-worktrees/capability-sdk";
import {
  createOpencodeClient,
  type GlobalEvent,
  type Message,
  type Part,
  type SessionStatus,
} from "@opencode-ai/sdk";
import { createOpencodeClient as createOpencodeClientV2 } from "@opencode-ai/sdk/v2";
import type {
  CodingAgentAccountUsage,
  CodingAgentAdapter,
  CodingAgentCapabilityConnection,
  CodingAgentSessionOptions,
  CodingAgentDiff,
  CodingAgentEvent,
  CodingAgentMessage,
  CodingAgentModel,
  CodingAgentSessionUsage,
  CodingAgentToolCall,
  CodingAgentSkillCatalog,
  CodingAgentTurnInput,
} from "./types";
import { readOpenCodeSessionId, reserveLocalPort } from "./opencode-utils";
import { buildOpenCodeRuntimeConfig, normalizeOpenCodeIdentifier } from "./opencode-capability-config";

const START_TIMEOUT_MS = 10_000;
const HEALTH_RETRY_MS = 150;
const EVENT_RECONNECT_MS = 250;
const INTERNAL_DONE_MESSAGE = "*Done. I'll confirm to the user.*";
const REASONING_VARIANT_IDS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

type OpenCodePermissionReplyProtocol =
  | "deprecated-respond"
  | "request-reply"
  | "session-v2-reply";

type NormalizedOpenCodePayload = {
  type: string;
  properties: unknown;
  permission?: {
    id: string;
    protocol: OpenCodePermissionReplyProtocol;
  };
};

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const normalizePermissionRequest = (
  properties: unknown,
  input: {
    permissionKey: "permission" | "action";
    resourcesKey: "patterns" | "resources";
    protocol: OpenCodePermissionReplyProtocol;
  },
): NormalizedOpenCodePayload | null => {
  const request = readRecord(properties);
  if (!request) return null;
  const id = typeof request.id === "string" ? request.id : null;
  const sessionID =
    typeof request.sessionID === "string" ? request.sessionID : null;
  if (!id || !sessionID) return null;

  const metadata = { ...(readRecord(request.metadata) ?? {}) };
  const resources = readStringArray(request[input.resourcesKey]);
  if (
    (typeof metadata.command !== "string" || !metadata.command.trim()) &&
    resources[0]
  ) {
    metadata.command = resources[0];
  }
  const type =
    typeof request[input.permissionKey] === "string"
      ? request[input.permissionKey]
      : "operation";
  const title =
    typeof metadata.title === "string" && metadata.title.trim()
      ? metadata.title
      : "OpenCode requests permission";

  return {
    type: "permission.updated",
    properties: {
      id,
      sessionID,
      title,
      type,
      metadata,
    },
    permission: { id, protocol: input.protocol },
  };
};

const normalizeOpenCodePayload = (
  type: string,
  properties: unknown,
): NormalizedOpenCodePayload => {
  if (type === "message.part.delta") {
    return { type: "message.part.updated", properties };
  }
  if (type === "permission.asked") {
    return (
      normalizePermissionRequest(properties, {
        permissionKey: "permission",
        resourcesKey: "patterns",
        protocol: "request-reply",
      }) ?? { type, properties }
    );
  }
  if (type === "permission.v2.asked") {
    return (
      normalizePermissionRequest(properties, {
        permissionKey: "action",
        resourcesKey: "resources",
        protocol: "session-v2-reply",
      }) ?? { type, properties }
    );
  }
  if (type === "permission.updated") {
    const permission = readRecord(properties);
    const id = typeof permission?.id === "string" ? permission.id : null;
    return {
      type,
      properties,
      ...(id
        ? {
            permission: {
              id,
              protocol: "deprecated-respond" as const,
            },
          }
        : {}),
    };
  }
  return { type, properties };
};

const readReasoningVariants = (model: unknown): string[] => {
  if (!model || typeof model !== "object" || !("variants" in model)) return [];
  const variants = model.variants;
  if (!variants || typeof variants !== "object") return [];
  return Object.entries(variants)
    .filter(
      ([id, configuration]) =>
        REASONING_VARIANT_IDS.has(id) &&
        (!configuration ||
          typeof configuration !== "object" ||
          !("disabled" in configuration) ||
          configuration.disabled !== true),
    )
    .map(([id]) => id);
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const removeInternalDoneMessage = (content: string): string =>
  content.replaceAll(INTERNAL_DONE_MESSAGE, "").trim();

export const toOpenCodeRunStatus = (
  status: SessionStatus | undefined,
): "idle" | "busy" => {
  // OpenCode's status endpoint lists active sessions only. An omitted session
  // has completed and must clear any busy state previously persisted by us.
  if (!status) return "idle";
  return status.type === "idle" ? "idle" : "busy";
};

type OpenCodeDiffPayload = {
  file?: unknown;
  path?: unknown;
  before?: unknown;
  after?: unknown;
  patch?: unknown;
  additions?: unknown;
  deletions?: unknown;
};

const readPatchContent = (patch: string): { before: string; after: string } => {
  const before: string[] = [];
  const after: string[] = [];

  for (const line of patch.replaceAll("\r\n", "\n").split("\n")) {
    if (
      line.startsWith("+++") ||
      line.startsWith("---") ||
      line.startsWith("@@") ||
      line.startsWith("\\ No newline at end of file")
    ) {
      continue;
    }
    if (line.startsWith("+")) {
      after.push(line.slice(1));
    } else if (line.startsWith("-")) {
      before.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      const content = line.slice(1);
      before.push(content);
      after.push(content);
    }
  }

  return { before: before.join("\n"), after: after.join("\n") };
};

const normalizeDiff = (value: unknown): CodingAgentDiff => {
  if (!value || typeof value !== "object") {
    throw new Error("OpenCode returned an invalid session diff.");
  }
  const diff = value as OpenCodeDiffPayload;
  const file =
    typeof diff.file === "string"
      ? diff.file
      : typeof diff.path === "string"
        ? diff.path
        : null;
  if (!file)
    throw new Error("OpenCode returned a session diff without a file path.");

  const patchContent =
    typeof diff.patch === "string"
      ? readPatchContent(diff.patch)
      : { before: "", after: "" };
  return {
    file,
    before: typeof diff.before === "string" ? diff.before : patchContent.before,
    after: typeof diff.after === "string" ? diff.after : patchContent.after,
    additions: typeof diff.additions === "number" ? diff.additions : 0,
    deletions: typeof diff.deletions === "number" ? diff.deletions : 0,
  };
};

const readToolTitle = (
  input: Record<string, unknown>,
  fallbackTitle: string | undefined,
): string => {
  if (fallbackTitle && fallbackTitle.trim()) return fallbackTitle;
  const candidate = Object.values(input).find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
  if (candidate) return candidate;
  const keys = Object.keys(input);
  return keys.length > 0 ? keys.join(", ") : "Running";
};

const toToolCalls = (parts: Part[]): CodingAgentToolCall[] =>
  parts.flatMap((part): CodingAgentToolCall[] => {
    if (part.type !== "tool") return [];
    const { state } = part;
    const input = "input" in state && state.input ? state.input : {};
    const base = {
      id: part.callID || part.id,
      tool: part.tool,
      title: readToolTitle(input, "title" in state ? state.title : undefined),
    };
    if (state.status === "completed") {
      return [
        {
          ...base,
          status: "completed" as const,
          detail: state.output ?? "",
        },
      ];
    }
    if (state.status === "error") {
      return [{ ...base, status: "error" as const, detail: state.error }];
    }
    return [
      {
        ...base,
        status:
          state.status === "pending"
            ? ("pending" as const)
            : ("running" as const),
        detail: "",
      },
    ];
  });

const toMessage = (info: Message, parts: Part[]): CodingAgentMessage => ({
  id: info.id,
  role: info.role,
  content: removeInternalDoneMessage(
    parts
      .filter(
        (part): part is Extract<Part, { type: "text" }> => part.type === "text",
      )
      .map((part) => part.text)
      .join(""),
  ),
  reasoning: removeInternalDoneMessage(
    parts
      .filter(
        (part): part is Extract<Part, { type: "reasoning" }> =>
          part.type === "reasoning",
      )
      .at(-1)?.text ?? "",
  ),
  tools: toToolCalls(parts),
  createdAt: info.time.created,
  completedAt:
    info.role === "assistant"
      ? (info.time.completed ?? (info.finish ? info.time.created : null))
      : null,
});

export class OpenCodeAdapter implements CodingAgentAdapter {
  private process: ChildProcess | null = null;
  private client: ReturnType<typeof createOpencodeClient> | null = null;
  private v2Client: ReturnType<typeof createOpencodeClientV2> | null = null;
  private version: string | null = null;
  private error: string | null = null;
  private eventAbortController: AbortController | null = null;
  private readonly permissionReplyProtocols = new Map<
    string,
    OpenCodePermissionReplyProtocol
  >();
  private readonly listeners = new Set<(event: CodingAgentEvent) => void>();
  private readonly capabilityConnections = new Map<string, CodingAgentCapabilityConnection>();
  private executablePath: string | null = null;
  private startupDirectory: string | null = null;
  private reconfiguringCapabilities = false;
  private skillCatalog: CodingAgentSkillCatalog | null = null;

  constructor(
    private readonly capabilityReloadTimeoutMs = 10_000,
    private readonly capabilityVerificationTimeoutMs = 10_000,
  ) {}

  getStatus() {
    return {
      running: this.process !== null && this.process.exitCode === null,
      version: this.version,
      error: this.error,
    };
  }

  async start(executablePath: string, cwd: string): Promise<string> {
    this.executablePath = executablePath;
    this.startupDirectory = cwd;
    if (this.process && this.process.exitCode === null && this.version) {
      return this.version;
    }

    const port = await reserveLocalPort();
    const password = randomBytes(32).toString("base64url");
    const baseUrl = `http://127.0.0.1:${port}`;
    const child = spawn(
      executablePath,
      ["serve", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd,
        env: {
          ...process.env,
          OPENCODE_SERVER_PASSWORD: password,
          // This is loaded by OpenCode as its highest-priority runtime config.
          // The build agent is the one selected in sendPrompt(), so its shell
          // commands must wait for the renderer's explicit decision.
          OPENCODE_CONFIG_CONTENT: JSON.stringify(buildOpenCodeRuntimeConfig([...this.capabilityConnections.values()], this.skillCatalog)),
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );

    this.process = child;
    this.error = null;

    let diagnosticOutputReported = false;
    child.stderr?.on("data", (chunk: Buffer) => {
      if (chunk.length > 0 && !diagnosticOutputReported) {
        diagnosticOutputReported = true;
        console.info("[opencode] Diagnostic output received and redacted.");
      }
    });
    // Drain stdout without copying provider prompts, tool inputs, or results into app logs.
    child.stdout?.on("data", () => undefined);
    child.once("error", (error) => {
      this.error = error.message;
    });
    child.once("exit", (code, signal) => {
      if (this.process === child) {
        this.process = null;
        this.client = null;
        this.v2Client = null;
        this.permissionReplyProtocols.clear();
        this.eventAbortController?.abort();
        this.error =
          code === 0 ? null : `OpenCode exited (${signal ?? `code ${code}`}).`;
        this.emit({
          directory: "",
          sessionId: null,
          type: "server.exit",
          properties: { code, signal, error: this.error },
        });
      }
    });

    const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
    const authFetch: typeof fetch = (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const headers = new Headers(request.headers);
      headers.set("Authorization", authorization);
      return fetch(new Request(request, { headers }));
    };

    this.client = createOpencodeClient({
      baseUrl,
      fetch: authFetch,
      // The SDK's generated SSE transport calls global fetch directly instead
      // of the custom fetch above, so stream authentication must also live in
      // the static client headers.
      headers: { Authorization: authorization },
      throwOnError: true,
    });
    this.v2Client = createOpencodeClientV2({
      baseUrl,
      fetch: authFetch,
      headers: { Authorization: authorization },
      throwOnError: true,
    });

    const startedAt = Date.now();
    let detectedVersion: string | null = null;
    while (Date.now() - startedAt < START_TIMEOUT_MS) {
      if (child.exitCode !== null) break;
      try {
        const response = await authFetch(
          new Request(`${baseUrl}/global/health`),
        );
        if (response.ok) {
          const health = (await response.json()) as {
            healthy?: boolean;
            version?: string;
          };
          if (health.healthy && health.version) {
            detectedVersion = health.version;
            break;
          }
        }
      } catch {
        // The process may still be starting; retry until the bounded timeout.
      }
      await delay(HEALTH_RETRY_MS);
    }

    if (!detectedVersion) {
      await this.stop();
      throw new Error(
        "OpenCode did not become healthy before the startup timeout.",
      );
    }

    this.version = detectedVersion;
    this.startEventStream();
    return detectedVersion;
  }

  async stop(): Promise<void> {
    this.eventAbortController?.abort();
    this.eventAbortController = null;
    const child = this.process;
    this.process = null;
    this.client = null;
    this.v2Client = null;
    this.permissionReplyProtocols.clear();
    if (!child || child.exitCode !== null) return;

    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      delay(2_000).then(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }),
    ]);
  }

  private requireClient(): ReturnType<typeof createOpencodeClient> {
    if (!this.client) throw new Error("OpenCode server is not running.");
    return this.client;
  }

  async listModels(directory: string): Promise<CodingAgentModel[]> {
    const result = await this.requireClient().provider.list({
      query: { directory },
      throwOnError: true,
    });
    const connected = new Set(result.data.connected);
    return result.data.all
      .filter((provider) => connected.has(provider.id))
      .flatMap((provider) =>
        Object.values(provider.models).map((model) => ({
          providerId: provider.id,
          providerName: provider.name,
          modelId: model.id,
          modelName: model.name,
          reasoningVariants: readReasoningVariants(model),
          isDefault: false,
        })),
      )
      .sort((a, b) =>
        `${a.providerName}/${a.modelName}`.localeCompare(
          `${b.providerName}/${b.modelName}`,
        ),
      );
  }

  async createSession(directory: string, title: string, options?: CodingAgentSessionOptions) {
    if (options?.capabilities) this.capabilityConnections.set(options.capabilities.profileId, options.capabilities);
    const result = await this.requireClient().session.create({
      body: { title },
      query: { directory },
      throwOnError: true,
    });
    return { id: result.data.id };
  }

  async getSession(directory: string, sessionId: string, options?: { capabilities?: CodingAgentCapabilityConnection }) {
    if (options?.capabilities) this.capabilityConnections.set(options.capabilities.profileId, options.capabilities);
    const client = this.requireClient();
    const [sessionResult, statusesResult] = await Promise.all([
      client.session.get({
        path: { id: sessionId },
        query: { directory },
        throwOnError: true,
      }),
      client.session.status({
        query: { directory },
        throwOnError: true,
      }),
    ]);
    return {
      id: sessionResult.data.id,
      status: toOpenCodeRunStatus(statusesResult.data[sessionId]),
    };
  }

  async listMessages(
    directory: string,
    sessionId: string,
  ): Promise<CodingAgentMessage[]> {
    const result = await this.requireClient().session.messages({
      path: { id: sessionId },
      query: { directory },
      throwOnError: true,
    });
    return result.data.map(({ info, parts }) => toMessage(info, parts));
  }

  async getDiff(
    directory: string,
    sessionId: string,
    messageId?: string,
  ): Promise<CodingAgentDiff[]> {
    const result = await this.requireClient().session.diff({
      path: { id: sessionId },
      query: { directory, ...(messageId ? { messageID: messageId } : {}) },
      throwOnError: true,
    });
    return (result.data as unknown[]).map(normalizeDiff);
  }

  async configureSkills(catalog: CodingAgentSkillCatalog | null): Promise<void> {
    const changed=JSON.stringify(this.skillCatalog)!==JSON.stringify(catalog);
    this.skillCatalog = catalog;
    if (!changed || !this.getStatus().running) return;
    const executablePath=this.executablePath,directory=this.startupDirectory;
    if(!executablePath||!directory)throw new Error("OpenCode is not configured for skill synchronization.");
    await this.stop();
    await this.start(executablePath,directory);
    if(catalog)await this.verifySkills(directory,catalog.expectedIds);
  }

  async verifySkills(directory: string, expectedIds: readonly string[]): Promise<void> {
    if (!this.v2Client) throw new Error("OpenCode skill discovery is unavailable.");
    const result = await this.v2Client.v2.skill.list({ location: { directory } });
    if (!result.data) throw new Error("OpenCode returned an invalid skill catalog.");
    const skills = result.data.data;
    const ids = skills.map((skill) => skill.name);
    const root = this.skillCatalog?.activeRoot;
    const pathsValid = root !== undefined && skills.every((skill) => resolve(skill.location) === resolve(join(root, skill.name, "SKILL.md")));
    if (!pathsValid || new Set(ids).size !== ids.length || [...ids].sort().join("\0") !== [...expectedIds].sort().join("\0")) throw new Error("OpenCode skill catalog verification failed.");
  }

  async sendPrompt(
    directory: string,
    sessionId: string,
    input: CodingAgentTurnInput,
  ): Promise<void> {
    if (this.reconfiguringCapabilities) throw new CapabilityError("agent_reload_failed", "Capabilities are being applied. Try again when reload completes.");
    if (input.explicitSkill !== undefined) {
      await this.requireClient().session.command({
        path: { id: sessionId }, query: { directory },
        body: { command: input.explicitSkill.id, arguments: input.explicitSkill.arguments ?? "", agent: input.capabilityProfileId || "build", model: `${input.providerId}/${input.modelId}` },
        throwOnError: true,
      });
      return;
    }
    await this.requireClient().session.promptAsync({
      path: { id: sessionId },
      query: { directory },
      body: {
        agent: input.capabilityProfileId || "build",
        model: {
          providerID: input.providerId,
          modelID: input.modelId,
          ...(input.reasoningVariant
            ? { variant: input.reasoningVariant }
            : {}),
        } as { providerID: string; modelID: string },
        parts: [{ type: "text", text: input.content }],
      },
      throwOnError: true,
    });
  }

  async reconfigureCapabilities(input: {
    connections: CodingAgentCapabilityConnection[];
    sessions: Array<{ directory: string; sessionId: string }>;
    expectedToolNamesByProfile?: Record<string, string[]>;
    absentConnections?: CodingAgentCapabilityConnection[];
  }): Promise<void> {
    if (this.reconfiguringCapabilities) throw new CapabilityError("agent_reload_failed", "OpenCode capability reload is already in progress.");
    this.reconfiguringCapabilities = true;
    try {
      const idleDeadline = Date.now() + this.capabilityReloadTimeoutMs;
      let sessionsIdle = false;
      while (!sessionsIdle) {
        const snapshots = await Promise.all(input.sessions.map((session) => this.getSession(session.directory, session.sessionId)));
        const valid = snapshots.every((snapshot, index) => snapshot.id === input.sessions[index]?.sessionId);
        if (!valid) throw new CapabilityError("agent_reload_failed", "OpenCode returned an unexpected session during capability reload.");
        sessionsIdle = snapshots.every((snapshot) => snapshot.status === "idle");
        if (!sessionsIdle && Date.now() >= idleDeadline) throw new CapabilityError("agent_reload_failed", "OpenCode capability reload timed out waiting for idle sessions.");
        if (!sessionsIdle) await delay(Math.min(100, this.capabilityReloadTimeoutMs));
      }
      const previous = [...this.capabilityConnections.values()];
      const executablePath = this.executablePath;
      const directory = this.startupDirectory;
      if (!executablePath || !directory) throw new CapabilityError("agent_reload_failed", "OpenCode is not configured for capability reload.");
      try {
        this.capabilityConnections.clear();
        for (const connection of input.connections) this.capabilityConnections.set(connection.profileId, connection);
        await this.stop();
        await this.start(executablePath, directory);
        const resumed = await Promise.all(input.sessions.map((session) => this.getSession(session.directory, session.sessionId)));
        if (!resumed.every((snapshot, index) => snapshot.id === input.sessions[index]?.sessionId)) {
          throw new CapabilityError("agent_reload_failed", "OpenCode resumed an unexpected session.");
        }
        if (input.expectedToolNamesByProfile) {
          await this.verifyCapabilities(input.connections, input.expectedToolNamesByProfile, input.sessions[0]?.directory ?? directory, input.absentConnections);
        }
      } catch {
        this.capabilityConnections.clear();
        for (const connection of previous) this.capabilityConnections.set(connection.profileId, connection);
        await this.stop();
        try {
          await this.start(executablePath, directory);
          const restored = await Promise.all(input.sessions.map((session) => this.getSession(session.directory, session.sessionId)));
          if (!restored.every((snapshot, index) => snapshot.id === input.sessions[index]?.sessionId)) throw new Error("Unexpected rollback session.");
        } catch {
          throw new CapabilityError("agent_reload_failed", "OpenCode capability reload failed and its previous sessions could not be restored.");
        }
        throw new CapabilityError("agent_reload_failed", "OpenCode capability reload failed and was rolled back.");
      }
    } finally {
      this.reconfiguringCapabilities = false;
    }
  }

  async verifyCapabilities(
    connections: readonly CodingAgentCapabilityConnection[],
    expectedToolNamesByProfile: Readonly<Record<string, readonly string[]>>,
    directory: string,
    absentConnections: readonly CodingAgentCapabilityConnection[] = [],
  ): Promise<void> {
    const deadline = Date.now() + this.capabilityVerificationTimeoutMs;
    let verified = false;
    while (!verified) {
      const client = this.requireClient();
      try {
        const [mcp, tools, config] = await Promise.all([
          client.mcp.status({ query: { directory }, throwOnError: true }),
          client.tool.ids({ query: { directory }, throwOnError: true }),
          client.config.get({ query: { directory }, throwOnError: true }),
        ]);
        const presentConnectionsVerified = connections.every((connection) => {
          const serverName = normalizeOpenCodeIdentifier(connection.serverName);
          const profileId = normalizeOpenCodeIdentifier(connection.profileId);
          const status = mcp.data[serverName];
          if (status?.status !== "connected" || !config.data.agent?.[profileId]) return false;
          const expected = (expectedToolNamesByProfile[connection.profileId] ?? []).map((tool) => `${serverName}_${tool}`).sort();
          if (!(connection.profileId in expectedToolNamesByProfile)) return true;
          const actual = tools.data.filter((tool) => tool.startsWith(`${serverName}_`)).sort();
          return actual.join("\0") === expected.join("\0");
        });
        const absentConnectionsVerified = absentConnections.every((connection) => {
          const serverName = normalizeOpenCodeIdentifier(connection.serverName);
          const profileId = normalizeOpenCodeIdentifier(connection.profileId);
          return !mcp.data[serverName] && !config.data.agent?.[profileId] && !tools.data.some((tool) => tool.startsWith(`${serverName}_`));
        });
        verified = presentConnectionsVerified && absentConnectionsVerified;
        if (verified) return;
      } catch {
        // OpenCode may still be loading MCP tools after its health endpoint is ready.
      }
      if (Date.now() >= deadline) throw new CapabilityError("agent_reload_failed", "OpenCode capability tools could not be verified.");
      await delay(Math.min(100, this.capabilityVerificationTimeoutMs));
    }
  }

  async compact(
    directory: string,
    sessionId: string,
    input: { providerId: string; modelId: string; capabilityProfileId?: string },
  ): Promise<void> {
    await this.requireClient().session.summarize({
      path: { id: sessionId },
      query: { directory },
      body: {
        providerID: input.providerId,
        modelID: input.modelId,
      },
      throwOnError: true,
    });
  }

  async getUsage(
    directory: string,
    sessionId: string,
    input: { providerId: string; modelId: string },
  ): Promise<CodingAgentSessionUsage> {
    const client = this.requireClient();
    const [messagesResult, providersResult] = await Promise.all([
      client.session.messages({
        path: { id: sessionId },
        query: { directory },
        throwOnError: true,
      }),
      client.provider.list({ query: { directory }, throwOnError: true }),
    ]);
    const assistantMessages = messagesResult.data
      .map(({ info }) => info)
      .filter((message) => message.role === "assistant");
    const latest = assistantMessages.at(-1);
    const contextTokens = latest
      ? latest.tokens.input +
        latest.tokens.output +
        latest.tokens.reasoning +
        latest.tokens.cache.read +
        latest.tokens.cache.write
      : 0;
    const provider = providersResult.data.all.find(
      (candidate) => candidate.id === input.providerId,
    );
    const contextWindow = provider?.models[input.modelId]?.limit.context ?? 0;
    if (contextWindow <= 0) {
      throw new Error(
        "OpenCode did not report the selected model context window.",
      );
    }
    return {
      contextTokens,
      contextWindow,
      contextPercentage: Math.min(100, (contextTokens / contextWindow) * 100),
      totalCost: assistantMessages.reduce(
        (total, message) => total + message.cost,
        0,
      ),
      providerId: input.providerId,
      modelId: input.modelId,
    };
  }

  async getAccountUsage(
    _directory: string,
    _sessionId: string,
    input: { providerId: string; modelId: string },
  ): Promise<CodingAgentAccountUsage> {
    return {
      providerId: input.providerId,
      availability: "unavailable",
      message:
        "OpenCode does not expose a provider-independent account usage API.",
      windows: [],
    };
  }

  async abort(directory: string, sessionId: string): Promise<void> {
    await this.requireClient().session.abort({
      path: { id: sessionId },
      query: { directory },
      throwOnError: true,
    });
  }

  async respondPermission(
    directory: string,
    sessionId: string,
    permissionId: string,
    response: "once" | "always" | "reject",
  ): Promise<void> {
    const protocol =
      this.permissionReplyProtocols.get(permissionId) ?? "deprecated-respond";
    if (protocol === "request-reply") {
      if (!this.v2Client) throw new Error("OpenCode server is not running.");
      await this.v2Client.permission.reply(
        {
          requestID: permissionId,
          directory,
          reply: response,
        },
        { throwOnError: true },
      );
    } else if (protocol === "session-v2-reply") {
      if (!this.v2Client) throw new Error("OpenCode server is not running.");
      await this.v2Client.v2.session.permission.reply(
        {
          sessionID: sessionId,
          requestID: permissionId,
          reply: response,
        },
        { throwOnError: true },
      );
    } else {
      await this.requireClient().postSessionIdPermissionsPermissionId({
        path: { id: sessionId, permissionID: permissionId },
        query: { directory },
        body: { response },
        throwOnError: true,
      });
    }
    this.permissionReplyProtocols.delete(permissionId);
  }

  subscribe(listener: (event: CodingAgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: CodingAgentEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private startEventStream(): void {
    const client = this.requireClient();
    const controller = new AbortController();
    this.eventAbortController = controller;
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          const events = await client.global.event({
            signal: controller.signal,
          });
          for await (const event of events.stream) {
            if (controller.signal.aborted) break;
            this.error = null;
            this.forwardGlobalEvent(event);
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            this.error = error instanceof Error ? error.message : String(error);
            this.emit({
              directory: "",
              sessionId: null,
              type: "server.event_error",
              properties: { error: this.error },
            });
          }
        }
        if (!controller.signal.aborted) await delay(EVENT_RECONNECT_MS);
      }
    })();
  }

  private forwardGlobalEvent(event: GlobalEvent): void {
    const normalized = normalizeOpenCodePayload(
      event.payload.type,
      event.payload.properties,
    );
    if (normalized.permission) {
      this.permissionReplyProtocols.set(
        normalized.permission.id,
        normalized.permission.protocol,
      );
    }
    this.emit({
      directory: event.directory,
      sessionId: readOpenCodeSessionId(normalized.properties),
      type: normalized.type,
      properties: normalized.properties,
    });
  }
}
