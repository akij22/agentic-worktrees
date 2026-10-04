import { dirname, join } from "node:path";
import {
  readCapabilityReceipt,
  stripCapabilityReceiptText,
} from "../capabilities/capability-receipt";
import {
  OPENCODE_ACTIVITY_CONTRACT,
  OPENCODE_BUILTIN_TOOLS,
  openCodeToolName,
  type OpenCodeRuntimeProjection,
  type ProjectedOpenCodeSkill,
  type OpenCodeOwnedHostObservation,
} from "./opencode-worktree-runtime";
import { normalizeOpenCodeIdentifier } from "./opencode-capability-config";

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
/** Provider bodies stay in memory. This boundary emits only typed evidence to its sole writer. */
export class OpenCodeResourceEvidence {
  private readonly sessionRuns = new Map<string, string>();
  private readonly explicitRequests = new Map<
    string,
    { skill: ProjectedOpenCodeSkill; messageId: string; sessionId: string; expectedContext: string }
  >();
  private readonly assistantMessages = new Set<string>();
  private readonly invocationSessions = new Map<string, string>();
  private readonly pendingParts = new Map<string, unknown>();
  private readonly historicalMessages = new Set<string>();
  private readonly receiptIdentifiers = new Set<string>();
  private rememberMessage(target: Set<string>, key: string): void {
    if (
      !target.has(key) &&
      this.assistantMessages.size + this.historicalMessages.size >= 10000
    )
      throw new Error("OpenCode message evidence capacity exceeded.");
    target.add(key);
  }
  private rememberIdentifier(id: string): void {
    const key = id.toLowerCase();
    if (
      this.receiptIdentifiers.size >= 10000 &&
      !this.receiptIdentifiers.has(key)
    )
      throw new Error("OpenCode receipt redaction capacity exceeded.");
    this.receiptIdentifiers.add(key);
  }
  private rememberReceipts(value: unknown): void {
    if (typeof value === "string") {
      const text = value.trim().split("\n").at(-1) ?? "";
      const receipt = readCapabilityReceipt({
        content: [{ type: "text", text }],
      });
      if (receipt) this.rememberIdentifier(receipt.invocationId);
    } else if (Array.isArray(value)) {
      for (const child of value) this.rememberReceipts(child);
    } else if (value && typeof value === "object") {
      for (const child of Object.values(value)) this.rememberReceipts(child);
    }
  }
  redactText(text: string): string {
    const sanitized = sanitizeOpenCodeResourceTransport(text);
    if (typeof sanitized !== "string") return "";
    return sanitized.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      (id) =>
        this.receiptIdentifiers.has(id.toLowerCase())
          ? "[Internal Resource identifier omitted]"
          : id,
    );
  }
  constructor(private readonly projection: OpenCodeRuntimeProjection) {}
  registerSession(sessionId: string, runId?: string): void {
    const evidence = this.projection.options.evidence;
    if (!evidence) return;
    const previous = this.sessionRuns.get(sessionId);
    if (!runId && !previous)
      throw new Error("OpenCode application session route is required.");
    if (previous && runId && previous !== runId)
      throw new Error("OpenCode session route ownership conflict.");
    const owner = runId ?? previous;
    if (!owner) throw new Error("OpenCode application route is unavailable.");
    evidence.registerSessionRoute(
      this.projection.options.lineage,
      sessionId,
      owner,
    );
    this.sessionRuns.set(sessionId, owner);
  }
  assertSession(sessionId: string): void {
    if (this.projection.options.evidence && !this.sessionRuns.has(sessionId))
      throw new Error("OpenCode session route is unavailable.");
  }
  hasSession(sessionId: string): boolean {
    return this.sessionRuns.has(sessionId);
  }
  seedResumeHistory(value: unknown, sessionId: string): void {
    if (!Array.isArray(value) || value.length > 10000)
      throw new Error("OpenCode resume history schema is unavailable.");
    for (const raw of value) {
      this.rememberReceipts(raw);
      const info = record(record(raw)?.info);
      if (!info || typeof info.id !== "string" || info.sessionID !== sessionId)
        throw new Error("OpenCode resume history route is unavailable.");
      this.rememberMessage(this.historicalMessages, `${sessionId}\0${info.id}`);
    }
  }
  displayCommand(
    sessionId: string,
    messageId: string,
    text?: string,
  ): string | null {
    const request = this.explicitRequests.get(`${sessionId}\0${messageId}`);
    if (request) return `/skill:${request.skill.name}`;
    // Presentation redaction is not evidence and cannot promote retained history to Used.
    if (
      text?.includes("Base directory for this skill:") &&
      text.includes("Relative paths in this skill")
    )
      return "[Private Skill context omitted]";
    return null;
  }
  sanitizePayload(value: unknown): unknown {
    this.rememberReceipts(value);
    if (typeof value === "string") return this.redactText(value);
    if (Array.isArray(value))
      return value.map((item) => this.sanitizePayload(item));
    const item = record(value);
    if (!item) return sanitizeOpenCodeResourceTransport(value);
    if (
      item.type === "text" &&
      typeof item.sessionID === "string" &&
      typeof item.messageID === "string"
    ) {
      const command = this.displayCommand(
        item.sessionID,
        item.messageID,
        typeof item.text === "string" ? item.text : undefined,
      );
      if (command) return { ...item, text: command };
    }
    if (item.type === "tool" && item.tool === "skill") {
      const state = record(item.state);
      if (state)
        return {
          ...item,
          state: {
            ...state,
            ...(state.status === "completed"
              ? { output: "Assigned Skill loaded." }
              : {}),
            ...(state.status === "error"
              ? { error: "Assigned Skill loading failed." }
              : {}),
            metadata: {},
          },
        };
    }
    return Object.fromEntries(
      Object.entries(item)
        .filter(
          ([key]) =>
            key !== "aw.capabilityReceipt" && key !== "awCapabilityReceipt",
        )
        .map(([key, child]) => [key, this.sanitizePayload(child)]),
    );
  }
  requestedSkill(
    sessionId: string,
    messageId: string,
    skill: ProjectedOpenCodeSkill,
    argumentsText = "",
  ): void {
    this.assertSession(sessionId);
    if (this.explicitRequests.size >= 1000)
      throw new Error("OpenCode pending Skill evidence capacity exceeded.");
    this.explicitRequests.set(`${sessionId}\0${messageId}`, {
      skill,
      messageId,
      sessionId,
      // Pinned command expansion preserves the complete body when no placeholders exist.
      // Substituted or shell-expanded bodies cannot prove the original body digest.
      expectedContext: (!/\$\d+|\$ARGUMENTS/.test(skill.commandTemplate) && argumentsText.trim()
        ? `${skill.commandTemplate}\n\n${argumentsText}`
        : skill.commandTemplate).trim(),
    });
    this.projection.options.evidence?.ingestSkill({
      lineage: this.projection.options.lineage,
      providerContract: OPENCODE_ACTIVITY_CONTRACT,
      rawSessionId: sessionId,
      requestIdentity: messageId,
      sourceIdentity: `command:${messageId}:request`,
      skillRoute: skill.name,
      mode: "explicit",
      type: "request",
    });
  }
  skillFailed(sessionId: string, messageId: string): void {
    const request = this.explicitRequests.get(`${sessionId}\0${messageId}`);
    if (!request) return;
    this.projection.options.evidence?.ingestSkill({
      lineage: this.projection.options.lineage,
      providerContract: OPENCODE_ACTIVITY_CONTRACT,
      rawSessionId: sessionId,
      requestIdentity: messageId,
      sourceIdentity: `command:${messageId}:failed`,
      skillRoute: request.skill.name,
      mode: "explicit",
      type: "failed",
    });
  }
  observeHistory(value: unknown, expectedSessionId: string): void {
    if (!Array.isArray(value))
      throw new Error("OpenCode history schema is unavailable.");
    for (const raw of value) {
      this.rememberReceipts(raw);
      const message = record(raw),
        info = record(message?.info);
      if (
        !info ||
        typeof info.id !== "string" ||
        info.sessionID !== expectedSessionId ||
        !Array.isArray(message?.parts) ||
        !["user", "assistant"].includes(String(info.role))
      )
        throw new Error("OpenCode history schema is unavailable.");
      if (
        message.parts.some((p) => {
          const part = record(p);
          return (
            !part ||
            part.sessionID !== info.sessionID ||
            part.messageID !== info.id ||
            (part.type === "tool" && info.role !== "assistant")
          );
        })
      )
        throw new Error("OpenCode history evidence schema is unavailable.");
      this.assertSession(info.sessionID);
      if (this.historicalMessages.has(`${info.sessionID}\0${info.id}`))
        continue;
      if (info.role === "assistant")
        this.rememberMessage(
          this.assistantMessages,
          `${info.sessionID}\0${info.id}`,
        );
      if (info.role === "user") {
        const request = this.explicitRequests.get(
          `${info.sessionID}\0${info.id}`,
        );
        if (request) {
          const text = message.parts
            .map(record)
            .filter((p) => p?.type === "text" && typeof p.text === "string")
            .map((p) => p?.text)
            .join("\n");
          if (text === request.expectedContext)
            this.projection.options.evidence?.ingestSkill({
              lineage: this.projection.options.lineage,
              providerContract: OPENCODE_ACTIVITY_CONTRACT,
              rawSessionId: info.sessionID,
              requestIdentity: request.messageId,
              sourceIdentity: `command:${request.messageId}:context`,
              skillRoute: request.skill.name,
              mode: "explicit",
              type: "context",
              receiptIdentity: `command:${request.messageId}:context`,
              bodyDigest: request.skill.bodyDigest,
              completeBody: true,
            });
        }
      }
      for (const part of message.parts) this.observePart(part);
    }
  }
  observeEvent(type: string, properties: unknown): void {
    const data = record(properties);
    if (type === "message.updated") {
      const info = record(data?.info);
      if (
        info?.role === "assistant" &&
        typeof info.id === "string" &&
        typeof info.sessionID === "string"
      ) {
        this.assertSession(info.sessionID);
        this.rememberMessage(
          this.assistantMessages,
          `${info.sessionID}\0${info.id}`,
        );
        for (const [key, value] of [...this.pendingParts]) {
          const part = record(value);
          if (
            part?.sessionID === info.sessionID &&
            part.messageID === info.id
          ) {
            this.pendingParts.delete(key);
            this.observePart(value);
          }
        }
      }
    }
    if (type === "message.part.updated") this.observePart(data?.part);
  }
  private observePart(value: unknown): void {
    const part = record(value);
    if (part?.type !== "tool") return;
    const state = record(part.state),
      evidence = this.projection.options.evidence;
    if (!evidence) return;
    if (
      typeof part.id !== "string" ||
      typeof part.messageID !== "string" ||
      typeof part.sessionID !== "string" ||
      typeof part.tool !== "string" ||
      !state
    )
      throw new Error("OpenCode tool evidence schema is unavailable.");
    this.assertSession(part.sessionID);
    if (this.historicalMessages.has(`${part.sessionID}\0${part.messageID}`))
      return;
    const requestIdentity = `${part.messageID}:${part.id}`;
    if (!this.assistantMessages.has(`${part.sessionID}\0${part.messageID}`)) {
      if (
        this.pendingParts.size >= 1000 &&
        !this.pendingParts.has(requestIdentity)
      )
        throw new Error("OpenCode evidence buffer capacity exceeded.");
      this.pendingParts.set(requestIdentity, structuredClone(part));
      return;
    }
    const base = {
      lineage: this.projection.options.lineage,
      providerContract: OPENCODE_ACTIVITY_CONTRACT,
      rawSessionId: part.sessionID,
      requestIdentity,
    };
    const mapped = this.projection.options.capabilityTools?.find(
      (t) => openCodeToolName(t.serverName, t.toolName) === part.tool,
    );
    if (mapped) {
      const route = {
        ...base,
        serverName: normalizeOpenCodeIdentifier(mapped.serverName),
        toolName: mapped.toolName,
      };
      if (
        !["pending", "running", "completed", "error"].includes(
          String(state.status),
        )
      )
        throw new Error("OpenCode terminal evidence schema is unavailable.");
      evidence.ingestProvider({
        ...route,
        type: "request",
        sourceIdentity: `${requestIdentity}:request`,
      });
      if (state.status === "completed" || state.status === "error") {
        const output =
          state.status === "completed" ? state.output : state.error;
        if (typeof output !== "string")
          throw new Error("OpenCode terminal evidence schema is unavailable.");
        const last = output.trim().split("\n").at(-1);
        const receipt = readCapabilityReceipt({
          content: [{ type: "text", text: last }],
        });
        if (receipt)
          evidence.ingestProvider({
            ...route,
            type: "terminal",
            sourceIdentity: `${requestIdentity}:terminal`,
            receipt,
          });
        // Absence of a host receipt proves neither host execution nor host cancellation.
      }
      return;
    }
    if (!OPENCODE_BUILTIN_TOOLS.includes(part.tool))
      throw new Error("OpenCode unassigned tool channel was observed.");
    if (part.tool !== "skill") return;
    const input = record(state.input);
    const name = input?.name;
    if (state.status === "pending" && typeof name !== "string") return;
    if (typeof name !== "string")
      throw new Error("OpenCode Skill evidence schema is unavailable.");
    const skill = this.projection.skills.find((s) => s.name === name);
    if (!skill) {
      if (state.status === "completed")
        throw new Error("OpenCode unassigned Skill context was observed.");
      return;
    }
    const mode = "automatic" as const;
    const route = { ...base, skillRoute: skill.name, mode };
    evidence.ingestSkill({
      ...route,
      type: "request",
      sourceIdentity: `${requestIdentity}:request`,
    });
    if (state.status === "error") {
      evidence.ingestSkill({
        ...route,
        type: "failed",
        sourceIdentity: `${requestIdentity}:failed`,
      });
      return;
    }
    if (state.status !== "completed") return;
    const metadata = record(state.metadata);
    if (
      metadata?.name !== skill.name ||
      metadata.dir !== dirname(skill.path) ||
      typeof state.output !== "string"
    )
      return;
    const prefix =
      [
        `<skill_content name="${skill.name}">`,
        `# Skill: ${skill.name}`,
        "",
        skill.body,
        "",
        `Base directory for this skill: ${dirname(skill.path)}`,
        "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
        "Note: file list is sampled.",
        "",
        "<skill_files>",
      ].join("\n") + "\n";
    const suffix = "\n</skill_files>\n</skill_content>";
    if (!state.output.startsWith(prefix) || !state.output.endsWith(suffix))
      return;
    const files = state.output.slice(prefix.length, -suffix.length);
    const allowed = new Set(
      skill.files
        .filter((f) => f.relativePath !== "SKILL.md")
        .map(
          (f) => `<file>${join(dirname(skill.path), f.relativePath)}</file>`,
        ),
    );
    if (files && files.split("\n").some((line) => !allowed.has(line))) return;
    if (mode === "automatic" && !skill.automaticInvocation)
      throw new Error("Unassigned automatic Skill channel was observed.");
    evidence.ingestSkill({
      ...route,
      type: "context",
      sourceIdentity: `${requestIdentity}:context`,
      receiptIdentity: `${requestIdentity}:context`,
      bodyDigest: skill.bodyDigest,
      completeBody: true,
    });
  }
  /** Only main-process host dispatch ownership may populate this registry. It is not session-use evidence. */
  registerDispatch(sessionId: string, invocationId: string): void {
    this.assertSession(sessionId);
    this.projection.options.evidence?.registerInvocationDispatch(
      this.projection.options.lineage,
      sessionId,
      invocationId,
      OPENCODE_ACTIVITY_CONTRACT,
    );
    this.invocationSessions.set(invocationId, sessionId);
  }
  observeHost(input: OpenCodeOwnedHostObservation): void {
    if (
      input.runtimeGeneration !==
      this.projection.options.lineage.runtimeGenerationId
    )
      throw new Error("Stale owned host generation.");
    const tool = this.projection.options.capabilityTools?.find(
      (t) =>
        t.serverName === input.serverName &&
        t.hostToolName === input.observation.toolName &&
        t.identity.resourceId === input.observation.capabilityId &&
        t.identity.resourceVersion === input.observation.capabilityVersion,
    );
    if (!tool) throw new Error("Owned host tool identity mismatch.");
    this.rememberIdentifier(input.observation.invocationId);
    this.projection.options.evidence?.ingestHost({
      lineage: this.projection.options.lineage,
      identity: tool.identity,
      observation: input.observation,
    });
    if (input.observation.type === "entered" && input.dispatchSessionId)
      this.registerDispatch(
        input.dispatchSessionId,
        input.observation.invocationId,
      );
    if (input.observation.type === "outcome")
      this.invocationSessions.delete(input.observation.invocationId);
  }
  async cancelSession(sessionId: string): Promise<void> {
    this.assertSession(sessionId);
    for (const [invocationId, owner] of [...this.invocationSessions])
      if (owner === sessionId)
        await this.projection.options.evidence?.cancelInvocation(
          this.projection.options.lineage,
          sessionId,
          invocationId,
        );
  }
  dispatchSessions(): string[] {
    return [...new Set(this.invocationSessions.values())];
  }
}

/** Remove reserved transport recursively before adapter events reach UI/session consumers. */
export function sanitizeOpenCodeResourceTransport(value: unknown): unknown {
  if (typeof value === "string") {
    const clean = stripCapabilityReceiptText(value);
    return /awCapabilityReceipt|aw\.capabilityReceipt/.test(clean)
      ? "[Internal Resource evidence omitted]"
      : clean;
  }
  if (Array.isArray(value)) return value.map(sanitizeOpenCodeResourceTransport);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            key !== "aw.capabilityReceipt" && key !== "awCapabilityReceipt",
        )
        .map(([key, item]) => [key, sanitizeOpenCodeResourceTransport(item)]),
    );
  return value;
}
