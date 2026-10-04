import { execFile as execFileCallback } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  CodexAppServerClient,
  type CodexIncomingMessage,
  type CodexRequestId,
} from "./codex-app-server-client";
import {
  readCodexAccountUsage,
  readCodexApprovalRequest,
  readCodexDiffs,
  readCodexMessages,
  readCodexMcpServerStatuses,
  readCodexModels,
  readCodexNotification,
  readCodexThread,
  readCodexThreadId,
  readCodexTurnId,
  type CodexApprovalRequest,
  type CodexNotification,
  type CodexThreadSnapshot,
} from "./codex-protocol";
import type {
  CodingAgentAccountUsage,
  CodingAgentAdapter,
  CodingAgentCapabilityConnection,
  CodingAgentDiff,
  CodingAgentEvent,
  CodingAgentMessage,
  CodingAgentModel,
  CodingAgentPermission,
  CodingAgentSessionUsage,
  CodingAgentSessionOptions,
  CodingAgentSkillCatalog,
  CodingAgentTurnInput,
} from "./types";

import {
  CODEX_RUNTIME_VERSION,
  CODEX_SKILL_ISOLATION,
  CodexRuntimeProjection,
  codexBodyDigest,
  type CodexWorktreeRuntimeOptions,
} from "./codex-worktree-runtime";
import { CodexResourceEvidence } from "./codex-resource-evidence";
const execFile = promisify(execFileCallback);

type CodexClient = Pick<
  CodexAppServerClient,
  "getStatus" | "request" | "respond" | "start" | "stop" | "subscribe"
>;

type ReadCodexVersion = (executablePath: string, env?: NodeJS.ProcessEnv) => Promise<string>;

interface PendingApproval {
  directory: string;
  request: CodexApprovalRequest;
}

const readVersionFromExecutable: ReadCodexVersion = async (executablePath, env) => {
  const { stdout } = await execFile(executablePath, ["--version"], {
    ...(env ? { env } : {}),
    timeout: 5_000,
    windowsHide: true,
  });
  const version = stdout.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/)?.[0];
  if (!version) {
    throw new Error("Codex returned an invalid version string.");
  }
  return version;
};

const approvalDecision = (
  response: "once" | "always" | "reject",
): "accept" | "acceptForSession" | "decline" => {
  if (response === "once") return "accept";
  if (response === "always") return "acceptForSession";
  return "decline";
};

const threadStatus = (
  thread: CodexThreadSnapshot,
): "idle" | "busy" | "error" => {
  if (thread.status.type === "active") return "busy";
  if (thread.status.type === "systemError") return "error";
  return "idle";
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const capabilityConfig = (
  connection: CodingAgentCapabilityConnection | undefined,
) =>
  connection
    ? {
        mcp_servers: {
          [connection.serverName]: {
            url: connection.url,
            http_headers: { Authorization: connection.authorizationHeader },
          },
        },
      }
    : undefined;

const hasExpectedCapabilityServer = (
  value: unknown,
  serverName: string,
  expected: readonly string[],
): boolean => {
  try {
    const server = readCodexMcpServerStatuses(value).find(
      (candidate) => candidate.name === serverName && candidate.healthy,
    );
    if (expected.length === 0) return !server;
    if (!server) return false;
    return (
      [...new Set(server.toolNames)].sort().join("\0") ===
      [...new Set(expected)].sort().join("\0")
    );
  } catch {
    return false;
  }
};

export class CodexAdapter implements CodingAgentAdapter {
  private version: string | null = null;
  private readonly projection?: CodexRuntimeProjection;
  private managedUnavailable = false;
  private readonly resourceEvidence?: CodexResourceEvidence;
  private readonly listeners = new Set<(event: CodingAgentEvent) => void>();
  private readonly threadSnapshots = new Map<string, CodexThreadSnapshot>();
  private readonly directoryByThread = new Map<string, string>();
  private readonly activeTurnByThread = new Map<string, string>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly usageByThread = new Map<
    string,
    Extract<CodexNotification, { type: "tokenUsage" }>["params"]["tokenUsage"]
  >();
  private readonly capabilityByThread = new Map<
    string,
    CodingAgentCapabilityConnection
  >();
  private executablePath: string | null = null;
  private startupDirectory: string | null = null;
  private unsubscribeOwnedHost?: () => void;
  private reconfiguringCapabilities = false;
  private skillCatalog: CodingAgentSkillCatalog | null = null;

  constructor(
    private readonly client: CodexClient = new CodexAppServerClient(),
    private readonly readVersion: ReadCodexVersion = readVersionFromExecutable,
    private readonly worktreeRuntime?: CodexWorktreeRuntimeOptions,
  ) {
    if (worktreeRuntime) {
      this.projection = new CodexRuntimeProjection(worktreeRuntime);
      this.resourceEvidence = new CodexResourceEvidence(this.projection);
    }
    this.client.subscribe((message) => this.handleIncomingMessage(message));
  }

  getStatus(): {
    running: boolean;
    version: string | null;
    error: string | null;
  } {
    const status = this.client.getStatus();
    return { ...status, version: this.version, error: this.managedUnavailable ? "Codex Worktree Runtime verification is unavailable." : status.error };
  }

  async start(executablePath: string, cwd: string): Promise<string> {
    if (this.client.getStatus().running && this.version) return this.version;
    const version = await this.readVersion(executablePath, this.projection?.environment());
    if (this.worktreeRuntime && version !== CODEX_RUNTIME_VERSION)
      throw new Error(
        "Codex provider version is not qualified for Worktree Resources.",
      );
    await this.projection?.prepare();
    this.projection?.assertDirectory(cwd);
    await this.client.start(
      executablePath,
      cwd,
      this.projection
        ? {
            env: this.projection.environment(),
            onUnexpectedExit: () => {
              this.managedUnavailable = true;
              this.unsubscribeOwnedHost?.(); this.unsubscribeOwnedHost = undefined;
              this.projection?.options.onUnavailable?.(
                this.projection.options.lineage,
              );
              this.projection?.options.evidence?.retireRuntime(
                this.projection.options.lineage,
              );
              this.emit({
                directory: cwd, sessionId: null,
                type: "server.exit",
                properties: { unexpected: true },
              });
            },
          }
        : undefined,
    );
    this.executablePath = executablePath;
    this.startupDirectory = cwd;
    this.version = version;
    if (this.projection) {
      await this.requestProvider("skills/extraRoots/set", {
        extraRoots: [this.projection.skillRoot],
      });
      await this.verifyManagedRuntime(cwd, true);
      this.unsubscribeOwnedHost =
        this.projection.options.subscribeHostObservations?.((input) => {
          try {
            this.resourceEvidence?.observeHost(input);
          } catch {
            this.managedUnavailable = true;
            this.projection?.options.onUnavailable?.(
              this.projection.options.lineage,
            );
          }
        });
    } else if (this.skillCatalog)
      await this.applySkillCatalog(this.skillCatalog);
    return version;
  }

  async stop(): Promise<void> {
    this.unsubscribeOwnedHost?.();
    this.unsubscribeOwnedHost = undefined;
    await this.client.stop();
    this.threadSnapshots.clear();
    this.directoryByThread.clear();
    this.activeTurnByThread.clear();
    this.pendingApprovals.clear();
    this.usageByThread.clear();
    this.capabilityByThread.clear();
  }

  async listModels(directory: string): Promise<CodingAgentModel[]> {
    void directory;
    const result = await this.requestProvider<unknown>("model/list", {});
    return readCodexModels(result);
  }

  async createSession(
    directory: string,
    title: string,
    options: CodingAgentSessionOptions,
  ): Promise<{ id: string; skillIsolation?: typeof CODEX_SKILL_ISOLATION }> {
    await this.verifyManagedRuntime(directory);
    if (this.projection?.options.evidence && !options.runId)
      throw new Error("Codex application session route is required.");
    const result = await this.requestProvider<unknown>("thread/start", {
      model: options.modelId,
      ...(this.projection?.options.modelProvider
        ? { modelProvider: this.projection.options.modelProvider.id }
        : {}),
      cwd: directory,
      sandbox: "workspace-write",
      approvalPolicy: "untrusted",
      ephemeral: false,
      ...(this.projection
        ? { config: this.projection.capabilityConfig() }
        : options.capabilities
          ? { config: capabilityConfig(options.capabilities) }
          : {}),
    });
    const threadId = readCodexThreadId(result);
    if (!threadId) throw new Error("Codex returned a thread without an ID.");

    await this.verifyManagedCapabilityCatalog(threadId);
    this.resourceEvidence?.registerSession(threadId, options.runId);
    this.directoryByThread.set(threadId, directory);
    await this.requestProvider<unknown>("thread/name/set", {
      threadId,
      name: title,
    });
    if (options.capabilities) {
      this.capabilityByThread.set(threadId, options.capabilities);
    }
    return {
      id: threadId,
      ...(this.projection ? { skillIsolation: CODEX_SKILL_ISOLATION } : {}),
    };
  }

  async getSession(
    directory: string,
    sessionId: string,
    options?: {
      capabilities?: CodingAgentCapabilityConnection;
      runId?: string;
    },
  ): Promise<{ id: string; status: "idle" | "busy" | "error"; skillIsolation?: typeof CODEX_SKILL_ISOLATION }> {
    await this.verifyManagedRuntime(directory);
    this.directoryByThread.set(sessionId, directory);
    const resumed = await this.requestProvider<unknown>("thread/resume", {
      threadId: sessionId,
      cwd: directory,
      ...(this.projection?.options.modelProvider
        ? { modelProvider: this.projection.options.modelProvider.id }
        : {}),
      ...(this.projection
        ? { config: this.projection.capabilityConfig() }
        : options?.capabilities
          ? { config: capabilityConfig(options.capabilities) }
          : {}),
    });
    const resumedThreadId = readCodexThreadId(resumed);
    if (resumedThreadId !== sessionId) {
      throw new Error("Codex resumed an unexpected thread.");
    }

    if (options?.capabilities) {
      this.capabilityByThread.set(sessionId, options.capabilities);
    }
    await this.verifyManagedCapabilityCatalog(sessionId);
    const newlyResumed =
      this.resourceEvidence && !this.resourceEvidence.hasSession(sessionId);
    this.resourceEvidence?.registerSession(sessionId, options?.runId);
    if (newlyResumed)
      this.resourceEvidence?.seedResumeHistory(
        readCodexThread(
          await this.requestProvider("thread/read", {
            threadId: sessionId,
            includeTurns: true,
          }),
        ),
      );
    const thread = await this.refreshThread(sessionId);
    return {
      id: thread.id,
      status: threadStatus(thread),
      ...(this.projection ? { skillIsolation: CODEX_SKILL_ISOLATION } : {}),
    };
  }

  async listMessages(
    directory: string,
    sessionId: string,
  ): Promise<CodingAgentMessage[]> {
    this.directoryByThread.set(sessionId, directory);
    await this.verifyManagedRuntime(directory);
    this.resourceEvidence?.assertSession(sessionId);
    const messages = readCodexMessages(await this.refreshThread(sessionId));
    return this.resourceEvidence
      ? (this.resourceEvidence.sanitize(messages) as CodingAgentMessage[])
      : messages;
  }

  async getDiff(
    directory: string,
    sessionId: string,
    messageId?: string,
  ): Promise<CodingAgentDiff[]> {
    await this.verifyManagedRuntime(directory);
    this.resourceEvidence?.assertSession(sessionId);
    this.directoryByThread.set(sessionId, directory);
    const projected = readCodexDiffs(await this.refreshThread(sessionId));
    const diff = messageId ? projected.turn : projected.session;
    return this.resourceEvidence ? this.resourceEvidence.sanitize(diff) as CodingAgentDiff[] : diff;
  }

  async configureSkills(
    catalog: CodingAgentSkillCatalog | null,
  ): Promise<void> {
    if (this.projection)
      throw new Error("Managed Codex Skills require an Assignment activation.");
    this.skillCatalog = catalog;
    if (!this.client.getStatus().running) return;
    if (catalog) await this.applySkillCatalog(catalog);
    else
      await this.requestProvider<unknown>("skills/extraRoots/set", {
        extraRoots: [],
      });
  }

  async verifySkills(
    directory: string,
    expectedIds: readonly string[],
  ): Promise<void> {
    const response = await this.requestProvider<unknown>("skills/list", {
      cwds: [directory],
      forceReload: true,
    });
    const data =
      response && typeof response === "object" && "data" in response
        ? (response as { data: unknown }).data
        : undefined;
    if (!Array.isArray(data))
      throw new Error("Codex returned an invalid skill catalog.");
    const groups = data.filter((group): group is Record<string, unknown> =>
      Boolean(group && typeof group === "object"),
    );
    if (
      groups.some(
        (group) => Array.isArray(group.errors) && group.errors.length > 0,
      )
    )
      throw new Error("Codex reported skill discovery errors.");
    const entries = groups.flatMap((group) =>
      Array.isArray(group.skills) ? group.skills : [],
    );
    const enabled = entries.filter((entry): entry is Record<string, unknown> =>
      Boolean(
        entry &&
        typeof entry === "object" &&
        (entry as { enabled?: unknown }).enabled === true,
      ),
    );
    const ids = enabled
      .map((entry) => entry.name)
      .filter((name): name is string => typeof name === "string");
    const root = this.skillCatalog?.activeRoot;
    const pathsValid =
      root !== undefined &&
      enabled.every((entry) => {
        const name = entry.name,
          path = entry.path;
        return (
          typeof name === "string" &&
          typeof path === "string" &&
          resolve(path) === resolve(join(root, name, "SKILL.md"))
        );
      });
    if (
      !pathsValid ||
      enabled.length !== ids.length ||
      new Set(ids).size !== ids.length ||
      [...ids].sort().join("\0") !== [...expectedIds].sort().join("\0")
    )
      throw new Error("Codex skill catalog verification failed.");
  }

  private async applySkillCatalog(
    catalog: CodingAgentSkillCatalog,
  ): Promise<void> {
    await this.requestProvider<unknown>("skills/extraRoots/set", {
      extraRoots: [catalog.activeRoot],
    });
    await this.verifySkills(
      this.startupDirectory ?? catalog.activeRoot,
      catalog.expectedIds,
    );
  }

  async sendPrompt(
    directory: string,
    sessionId: string,
    input: CodingAgentTurnInput,
  ): Promise<void> {
    if (this.reconfiguringCapabilities) {
      throw new Error("Codex capability reload is in progress.");
    }
    await this.verifyManagedRuntime(directory);
    this.resourceEvidence?.assertSession(sessionId);
    await this.verifyManagedCapabilityCatalog(sessionId);
    if (
      this.projection &&
      input.capabilityProfileId &&
      !this.projection.options.capabilities.some(
        (c) => c.profileId === input.capabilityProfileId,
      )
    )
      throw new Error(
        "Capability profile is not assigned to this Codex Worktree Runtime.",
      );
    if (this.projection && input.explicitSkill) {
      const requested = input.explicitSkill,
        runtime = this.projection.options;
      const assigned = runtime.skills.find(
        (s) =>
          s.name === requested.id &&
          s.name === requested.name &&
          resolve(requested.path) ===
            join(resolve(runtime.namespaceRoot), "skills", s.name, "SKILL.md"),
      );
      if (!assigned)
        throw new Error(
          "Skill is not assigned to this Codex Worktree Runtime.",
        );
    }
    if (input.providerId !== "openai") {
      throw new Error(`Codex does not support provider ${input.providerId}.`);
    }
    this.directoryByThread.set(sessionId, directory);
    const result = await this.requestProvider<unknown>("turn/start", {
      threadId: sessionId,
      input:
        input.explicitSkill !== undefined
          ? [
              {
                type: "skill",
                name: input.explicitSkill.name,
                path: input.explicitSkill.path,
              },
              ...(input.explicitSkill.arguments
                ? [
                    {
                      type: "text",
                      text: input.explicitSkill.arguments,
                      text_elements: [],
                    },
                  ]
                : []),
            ]
          : [{ type: "text", text: input.content, text_elements: [] }],
      cwd: directory,
      model: input.modelId,
      ...(input.reasoningVariant ? { effort: input.reasoningVariant } : {}),
      summary: "detailed",
    });
    const turnId = readCodexTurnId(result);
    if (!turnId) throw new Error("Codex returned a turn without an ID.");
    if (input.explicitSkill)
      this.resourceEvidence?.requestedSkill(
        sessionId,
        turnId,
        input.explicitSkill.id,
      );
    this.activeTurnByThread.set(sessionId, turnId);
  }

  async refreshCapabilities(
    directory: string,
    sessionId: string,
    connection: CodingAgentCapabilityConnection,
    expectedToolNames: string[],
  ): Promise<void> {
    if (this.projection)
      throw new Error(
        "Managed Codex Capabilities require an Assignment activation.",
      );
    this.directoryByThread.set(sessionId, directory);
    const sessions = [...this.directoryByThread].map(
      ([ownedSessionId, ownedDirectory]) => ({
        directory: ownedDirectory,
        sessionId: ownedSessionId,
        ...(ownedSessionId === sessionId && expectedToolNames.length > 0
          ? { capabilities: connection }
          : this.capabilityByThread.has(ownedSessionId)
            ? { capabilities: this.capabilityByThread.get(ownedSessionId) }
            : {}),
      }),
    );
    await this.reconfigureCapabilities({
      connections: expectedToolNames.length > 0 ? [connection] : [],
      sessions,
      expectedToolNamesByProfile: { [connection.profileId]: expectedToolNames },
      ...(expectedToolNames.length === 0 ? { absentConnections: [connection] } : {}),
    });
  }

  async reconfigureCapabilities(input: {
    connections: CodingAgentCapabilityConnection[];
    sessions: Array<{
      directory: string;
      sessionId: string;
      capabilityProfileId?: string;
      capabilities?: CodingAgentCapabilityConnection;
    }>;
    expectedToolNamesByProfile?: Record<string, string[]>;
    absentConnections?: CodingAgentCapabilityConnection[];
  }): Promise<void> {
    if (this.projection)
      throw new Error(
        "Managed Codex Capabilities require an Assignment activation.",
      );
    if (this.reconfiguringCapabilities)
      throw new Error("Codex capability reload is already in progress.");
    const executablePath = this.executablePath;
    const startupDirectory = this.startupDirectory;
    if (!executablePath || !startupDirectory) throw new Error("Codex is not configured for capability reload.");
    this.reconfiguringCapabilities = true;
    const previousCapabilities = new Map(this.capabilityByThread);
    try {
      const snapshots = await Promise.all(
        input.sessions.map((session) =>
          this.getSession(session.directory, session.sessionId),
        ),
      );
      if (
        !snapshots.every(
          (snapshot, index) => snapshot.id === input.sessions[index]?.sessionId,
        )
      ) {
        throw new Error(
          "Codex returned an unexpected session during capability reload.",
        );
      }
      if (!snapshots.every((snapshot) => snapshot.status === "idle")) {
        throw new Error(
          "Codex capabilities can only be reloaded when every owned session is idle.",
        );
      }
      try {
        await this.restartAndResume(
          executablePath,
          startupDirectory,
          input.sessions,
        );
        if (input.expectedToolNamesByProfile) {
          await this.verifyCapabilities(
            input.connections,
            input.sessions,
            input.expectedToolNamesByProfile,
            input.absentConnections ?? [],
          );
        }
      } catch (error) {
        const rollbackSessions = input.sessions.map((session) => ({
          directory: session.directory,
          sessionId: session.sessionId,
          ...(session.capabilityProfileId ? { capabilityProfileId: session.capabilityProfileId } : {}),
          ...(previousCapabilities.has(session.sessionId)
            ? { capabilities: previousCapabilities.get(session.sessionId) }
            : {}),
        }));
        try {
          await this.restartAndResume(
            executablePath,
            startupDirectory,
            rollbackSessions,
          );
        } catch (rollbackError) {
          throw new Error(
            `Codex capability reload failed: ${errorMessage(error)} Rollback failed: ${errorMessage(rollbackError)}`,
          );
        }
        throw new Error(
          `Codex capability reload failed and was rolled back: ${errorMessage(error)}`,
        );
      }
    } finally {
      this.reconfiguringCapabilities = false;
    }
  }

  async abort(directory: string, sessionId: string): Promise<void> {
    this.projection?.assertDirectory(directory);
    this.resourceEvidence?.assertSession(sessionId);
    this.directoryByThread.set(sessionId, directory);
    const turnId = this.activeTurnByThread.get(sessionId);
    if (!turnId) {
      await this.resourceEvidence?.cancelSession(sessionId);
      return;
    }
    try {
      await this.requestProvider<unknown>("turn/interrupt", {
        threadId: sessionId,
        turnId,
      });
    } finally {
      this.activeTurnByThread.delete(sessionId);
      await this.resourceEvidence?.cancelSession(sessionId);
    }
  }

  async cancelOwnedWork(): Promise<void> {
    const directory = this.startupDirectory; if (!directory) return;
    for (const sessionId of new Set([
      ...this.activeTurnByThread.keys(),
      ...(this.resourceEvidence?.dispatchSessions() ?? []),
    ]))
      await this.abort(directory, sessionId);
  }

  async compact(
    directory: string,
    sessionId: string,
    input: { providerId: string; modelId: string },
  ): Promise<void> {
    if (input.providerId !== "openai") {
      throw new Error(`Codex does not support provider ${input.providerId}.`);
    }
    this.directoryByThread.set(sessionId, directory);
    await this.requestProvider<unknown>("thread/compact/start", {
      threadId: sessionId,
    });
    // Compaction acknowledgements do not carry the turn ID required by interrupt.
    // Read owned history so Stop targets the provider's actual active turn.
    if (this.projection) await this.refreshThread(sessionId);
  }

  async getUsage(
    directory: string,
    sessionId: string,
    input: { providerId: string; modelId: string },
  ): Promise<CodingAgentSessionUsage> {
    if (input.providerId !== "openai") {
      throw new Error(`Codex does not support provider ${input.providerId}.`);
    }
    this.directoryByThread.set(sessionId, directory);
    const usage = this.usageByThread.get(sessionId);
    if (!usage) {
      throw new Error("Codex token usage is not available yet.");
    }
    if (usage.modelContextWindow === null) {
      throw new Error("Codex context window is not available yet.");
    }
    const contextTokens = usage.last.totalTokens;
    const contextWindow = usage.modelContextWindow;
    return {
      contextTokens,
      contextWindow,
      contextPercentage: Math.min(
        100,
        Math.max(0, (contextTokens / contextWindow) * 100),
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
    if (input.providerId !== "openai") {
      throw new Error(`Codex does not support provider ${input.providerId}.`);
    }
    const accountUsage = readCodexAccountUsage(
      await this.requestProvider("account/rateLimits/read", {}),
    );
    return {
      providerId: input.providerId,
      availability: "available",
      ...accountUsage,
    };
  }

  async respondPermission(
    directory: string,
    sessionId: string,
    permissionId: string,
    response: "once" | "always" | "reject",
  ): Promise<void> {
    const pending = this.pendingApprovals.get(permissionId);
    if (!pending) {
      throw new Error(`Unknown Codex permission request: ${permissionId}`);
    }
    if (pending.request.params.threadId !== sessionId) {
      throw new Error("Codex permission request belongs to another thread.");
    }
    if (pending.directory && pending.directory !== directory) {
      throw new Error("Codex permission request belongs to another directory.");
    }

    if (pending.request.type === "permissions") {
      const requested = pending.request.params.permissions;
      const permissions =
        response === "reject"
          ? {}
          : {
              ...(requested.network ? { network: requested.network } : {}),
              ...(requested.fileSystem
                ? { fileSystem: requested.fileSystem }
                : {}),
            };
      this.client.respond(pending.request.requestId, {
        permissions,
        scope: response === "always" ? "session" : "turn",
      });
    } else {
      this.client.respond(pending.request.requestId, {
        decision: approvalDecision(response),
      });
    }
    this.pendingApprovals.delete(permissionId);
  }

  subscribe(listener: (event: CodingAgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async restartAndResume(
    executablePath: string,
    startupDirectory: string,
    sessions: Array<{
      directory: string;
      sessionId: string;
      capabilityProfileId?: string;
      capabilities?: CodingAgentCapabilityConnection;
    }>,
  ): Promise<void> {
    await this.stop();
    await this.start(executablePath, startupDirectory);
    for (const session of sessions) {
      const resumed = await this.requestProvider<unknown>("thread/resume", {
        threadId: session.sessionId,
        cwd: session.directory,
        config: session.capabilities
          ? capabilityConfig(session.capabilities)
          : { mcp_servers: {} },
      });
      if (readCodexThreadId(resumed) !== session.sessionId) {
        throw new Error(
          "Codex resumed an unexpected session after capability reload.",
        );
      }
      this.directoryByThread.set(session.sessionId, session.directory);
      if (session.capabilities) this.capabilityByThread.set(session.sessionId, session.capabilities);
      else this.capabilityByThread.delete(session.sessionId);
    }
  }

  private async verifyCapabilities(
    connections: readonly CodingAgentCapabilityConnection[],
    sessions: ReadonlyArray<{
      sessionId: string;
      capabilityProfileId?: string;
      capabilities?: CodingAgentCapabilityConnection;
    }>,
    expectedToolNamesByProfile: Readonly<Record<string, readonly string[]>>,
    absentConnections: readonly CodingAgentCapabilityConnection[],
  ): Promise<void> {
    const deadline = Date.now() + 10_000;
    do {
      let verified = true;
      for (const session of sessions) {
        const status = await this.requestProvider<unknown>(
          "mcpServerStatus/list",
          {
            threadId: session.sessionId,
            detail: "toolsAndAuthOnly",
            limit: 100,
          },
        );
        const connection = session.capabilities;
        if (connection && connection.profileId in expectedToolNamesByProfile) {
          verified &&= hasExpectedCapabilityServer(
            status,
            connection.serverName,
            expectedToolNamesByProfile[connection.profileId] ?? [],
          );
        }
        for (const absent of absentConnections) {
          if (session.capabilityProfileId === absent.profileId) {
            verified &&= hasExpectedCapabilityServer(
              status,
              absent.serverName,
              [],
            );
          }
        }
      }
      if (
        verified &&
        connections.every((connection) =>
          [...this.capabilityByThread.values()].some(
            (candidate) => candidate.profileId === connection.profileId,
          ),
        )
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    throw new Error("Capability activation could not be verified in Codex.");
  }

  private async requestProvider<Result = unknown>(method: string, params: unknown): Promise<Result> {
    try { return await this.client.request<Result>(method, params); }
    catch (error) {
      if (!this.projection) throw error;
      throw new Error("Codex Worktree provider request failed.", { cause: { method } });
    }
  }

  private async verifyManagedCapabilityCatalog(
    sessionId: string,
  ): Promise<void> {
    const projection = this.projection;
    if (!projection || !projection.options.capabilities.length) return;
    try {
      const deadline = Date.now() + 10000;
      do {
        const raw = await this.requestProvider<unknown>("mcpServerStatus/list", {
          threadId: sessionId,
          detail: "toolsAndAuthOnly",
          limit: 100,
        });
        const data = raw as {
          nextCursor?: unknown;
          data?: Array<{ runtimeStatus?: string }>;
        };
        if (data.nextCursor !== null)
          throw new Error("Catalog pagination is unsupported.");
        if (
          data.data?.some(
            (s) =>
              s.runtimeStatus === "starting" ||
              s.runtimeStatus === "notStarted",
          ) &&
          Date.now() < deadline
        ) {
          await new Promise((r) => setTimeout(r, 50));
          continue;
        }
        const statuses = readCodexMcpServerStatuses(raw);
        for (const connection of projection.options.capabilities) {
          const matches = statuses.filter(
              (s) => s.name === connection.serverName,
            ),
            expected = projection.options.capabilityTools
              .filter((t) => t.serverName === connection.serverName)
              .map((t) => t.toolName)
              .sort();
          if (
            matches.length !== 1 ||
            !matches[0].healthy ||
            matches[0].toolNames.sort().join("\0") !== expected.join("\0")
          )
            throw new Error("Catalog mismatch.");
        }
        return;
      } while (Date.now() < deadline);
      throw new Error("Catalog unavailable.");
    } catch {
      this.managedUnavailable = true;
      projection.options.onUnavailable?.(projection.options.lineage);
      throw new Error("Codex managed MCP catalog verification failed.");
    }
  }
  private async verifyManagedRuntime(
    directory: string,
    activating = false,
  ): Promise<void> {
    const projection = this.projection;
    if (!projection) return;
    projection.assertDirectory(directory);
    if (this.managedUnavailable)
      throw new Error(
        "Codex Worktree Runtime is unavailable after verification failure.",
      );
    try {
      await projection.verifyFiles();
      projection.verifyCatalog(
        await this.requestProvider("skills/list", {
          cwds: [directory],
          forceReload: true,
        }),
      );
      await projection.verifyFiles();
      if (activating && projection.options.onVerified)
        await projection.verifyOwnedHostCatalog();
      if (activating)
        await projection.options.onVerified?.(
          codexBodyDigest(
            JSON.stringify({
              lineage: projection.options.lineage,
              skills: projection.options.skills.map((s) => s.identity),
              tools: projection.options.capabilityTools,
              skillIsolation: "not_enforced",
            }),
          ),
        );
      else if (
        projection.options.verifyAttestation &&
        !(await projection.options.verifyAttestation(
          projection.options.lineage,
        ))
      )
        throw new Error("Attestation unavailable.");
    } catch {
      this.managedUnavailable = true;
      projection.options.onUnavailable?.(projection.options.lineage);
      throw new Error("Codex Worktree Resource verification failed.");
    }
  }

  private async refreshThread(threadId: string): Promise<CodexThreadSnapshot> {
    const result = await this.requestProvider<unknown>("thread/read", {
      threadId,
      includeTurns: true,
    });
    const thread = readCodexThread(result);
    if (thread.id !== threadId) {
      throw new Error("Codex read returned an unexpected thread.");
    }
    if (this.projection && thread.cwd !== this.projection.options.directory)
      throw new Error("Codex history Worktree directory mismatch.");
    try {
      this.resourceEvidence?.observeThread(thread);
      await this.resourceEvidence?.observeSkillContext(thread);
    } catch {
      this.managedUnavailable = true;
      this.projection?.options.onUnavailable?.(this.projection.options.lineage);
      throw new Error("Codex Resource history evidence is unavailable.");
    }
    this.threadSnapshots.set(threadId, thread);
    const activeTurn = thread.turns.find(
      (turn) => turn.status === "inProgress",
    );
    if (activeTurn) {
      this.activeTurnByThread.set(threadId, activeTurn.id);
    } else {
      this.activeTurnByThread.delete(threadId);
    }
    return thread;
  }

  private emit(event: CodingAgentEvent): void {
    const safe = this.resourceEvidence
      ? {
          ...event,
          properties: this.resourceEvidence.sanitize(event.properties),
        }
      : event;
    for (const listener of this.listeners) listener(safe);
  }

  private handleIncomingMessage(message: CodexIncomingMessage): void {
    if (!("method" in message)) return;
    if (this.resourceEvidence) {
      try {
        this.resourceEvidence.observeEvent(message.method, message.params);
      } catch {
        this.managedUnavailable = true;
        this.projection?.options.onUnavailable?.(this.projection.options.lineage);
        this.emit({ directory: this.startupDirectory ?? "", sessionId: null, type: "provider.error", properties: { message: "Codex Resource evidence format is unavailable." } });
        return;
      }
    }

    if (message.id !== undefined) {
      this.handleServerRequest(message.method, message.id, message.params);
      return;
    }

    try {
      const notification = readCodexNotification(
        message.method,
        message.params,
      );
      if (!notification) return;

      if (notification.type === "tokenUsage") {
        this.usageByThread.set(
          notification.params.threadId,
          notification.params.tokenUsage,
        );
        return;
      }

      if (notification.type === "messageDelta") {
        const { threadId, turnId, itemId, delta } = notification.params;
        this.emit({
          directory: this.directoryByThread.get(threadId) ?? "",
          sessionId: threadId,
          type: "message.part.updated",
          properties: {
            part: {
              id: itemId,
              sessionID: threadId,
              messageID: turnId,
              type: notification.partType,
              text: delta,
            },
            delta,
          },
        });
        return;
      }

      const threadId = notification.params.threadId;
      const terminalTurnId =
        notification.type === "turnCompleted"
          ? notification.params.turn.id
          : notification.params.turnId;
      const activeTurnId = this.activeTurnByThread.get(threadId);
      if (activeTurnId && activeTurnId !== terminalTurnId) {
        return;
      }
      if (activeTurnId === terminalTurnId) {
        this.activeTurnByThread.delete(threadId);
      }
      if (notification.type === "turnCompleted") {
        if (notification.params.turn.status === "failed") {
          this.emit({
            directory: this.directoryByThread.get(threadId) ?? "",
            sessionId: threadId,
            type: "session.error",
            properties: {
              threadId,
              turnId: notification.params.turn.id,
              error:
                notification.params.turn.error?.message ?? "Codex turn failed.",
            },
          });
        } else {
          this.emit({
            directory: this.directoryByThread.get(threadId) ?? "",
            sessionId: threadId,
            type: "session.idle",
            properties: {
              threadId,
              turnId: notification.params.turn.id,
            },
          });
        }
      } else {
        this.emit({
          directory: this.directoryByThread.get(threadId) ?? "",
          sessionId: threadId,
          type: "session.error",
          properties: {
            threadId,
            turnId: notification.params.turnId,
            error: notification.params.error.message,
          },
        });
      }
    } catch (error) {
      this.emitProtocolError(message.method, error);
    }
  }

  private handleServerRequest(
    method: string,
    requestId: CodexRequestId,
    params: unknown,
  ): void {
    try {
      const request = readCodexApprovalRequest(method, requestId, params);
      if (!request) {
        if (method.endsWith("/requestApproval")) {
          this.client.respond(requestId, { decision: "decline" });
          this.emitProtocolError(
            method,
            new Error("Unsupported approval request"),
          );
        }
        return;
      }

      const permissionId = String(requestId);
      const directory =
        this.directoryByThread.get(request.params.threadId) ?? "";
      this.pendingApprovals.set(permissionId, { directory, request });
      this.emit({
        directory,
        sessionId: request.params.threadId,
        type: "permission.updated",
        properties: this.toPermission(permissionId, request),
      });
    } catch (error) {
      this.client.respond(requestId, { decision: "decline" });
      this.emitProtocolError(method, error);
    }
  }

  private toPermission(
    permissionId: string,
    request: CodexApprovalRequest,
  ): CodingAgentPermission {
    const common = {
      id: permissionId,
      sessionId: request.params.threadId,
    };
    if (request.type === "command") {
      return {
        ...common,
        title: request.params.reason ?? "Codex wants to run a command",
        type: "command",
        metadata: {
          command: request.params.command ?? null,
          cwd: request.params.cwd ?? null,
          turnId: request.params.turnId,
          itemId: request.params.itemId,
        },
      };
    }
    if (request.type === "file") {
      return {
        ...common,
        title: request.params.reason ?? "Codex wants to change files",
        type: "file_change",
        metadata: {
          turnId: request.params.turnId,
          itemId: request.params.itemId,
        },
      };
    }
    return {
      ...common,
      title: request.params.reason ?? "Codex requests additional permissions",
      type: "permissions",
      metadata: {
        cwd: request.params.cwd,
        permissions: request.params.permissions,
        turnId: request.params.turnId,
        itemId: request.params.itemId,
      },
    };
  }

  private emitProtocolError(method: string, error: unknown): void {
    this.emit({
      directory: "",
      sessionId: null,
      type: "server.event_error",
      properties: { method, error: errorMessage(error) },
    });
  }
}
