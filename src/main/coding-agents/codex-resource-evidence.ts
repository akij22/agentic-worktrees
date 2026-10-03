import { lstat, readFile, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  readCapabilityReceipt,
  stripCapabilityReceiptText,
} from "../capabilities/capability-receipt";
import {
  CODEX_ACTIVITY_CONTRACT,
  codexBodyDigest,
  type CodexOwnedHostObservation,
  type CodexRuntimeProjection,
} from "./codex-worktree-runtime";
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
/** Raw provider identities and receipts remain transient; the evidence service is the sole durable writer. */
export class CodexResourceEvidence {
  private readonly sessions = new Map<string, string>();
  private readonly historicalTurns = new Set<string>();
  private readonly explicit = new Map<string, string>();
  private readonly receiptIds = new Set<string>();
  constructor(private readonly projection: CodexRuntimeProjection) {}
  registerSession(sessionId: string, runId?: string): void {
    const service = this.projection.options.evidence;
    if (!service) return;
    const owner = runId ?? this.sessions.get(sessionId);
    if (!owner) throw new Error("Codex application session route is required.");
    if (this.sessions.has(sessionId) && this.sessions.get(sessionId) !== owner)
      throw new Error("Codex session ownership conflict.");
    service.registerSessionRoute(
      this.projection.options.lineage,
      sessionId,
      owner,
    );
    this.sessions.set(sessionId, owner);
  }
  assertSession(sessionId: string): void {
    if (this.projection.options.evidence && !this.sessions.has(sessionId))
      throw new Error("Codex application session route is unavailable.");
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
  seedResumeHistory(thread: unknown): void {
    const data = record(thread);
    if (
      !data ||
      typeof data.id !== "string" ||
      !Array.isArray(data.turns) ||
      data.turns.length > 10000
    )
      throw new Error("Codex resume history schema is unavailable.");
    for (const raw of data.turns) {
      const turn = record(raw);
      if (typeof turn?.id !== "string")
        throw new Error("Codex resume turn is unavailable.");
      this.historicalTurns.add(`${data.id}\0${turn.id}`);
    }
  }
  requestedSkill(sessionId: string, turnId: string, name: string): void {
    this.assertSession(sessionId);
    if (this.explicit.size >= 1000)
      throw new Error("Codex Skill evidence capacity exceeded.");
    this.explicit.set(`${sessionId}\0${turnId}`, name);
    this.projection.options.evidence?.ingestSkill({
      lineage: this.projection.options.lineage,
      providerContract: CODEX_ACTIVITY_CONTRACT,
      rawSessionId: sessionId,
      requestIdentity: turnId,
      sourceIdentity: `${turnId}:skill:request`,
      skillRoute: name,
      mode: "explicit",
      type: "request",
    });
  }
  async observeSkillContext(thread: unknown): Promise<void> {
    const data = record(thread),
      service = this.projection.options.evidence;
    if (
      !service ||
      typeof data?.id !== "string" ||
      ![...this.explicit.keys()].some((k) => k.startsWith(`${data.id}\0`))
    )
      return;
    if (typeof data.path !== "string") return;
    const root = join(this.projection.dataRoot, "sessions"),
      path = resolve(data.path);
    if (!path.startsWith(root + sep) || !path.endsWith(".jsonl"))
      throw new Error("Codex Skill context ownership mismatch.");
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.size > 16 * 1024 * 1024 ||
      (await realpath(path)) !== path
    )
      throw new Error("Codex Skill context file is unavailable.");
    const lines = (await readFile(path, "utf8")).split("\n");
    let turnId: string | undefined,
      owned = false;
    for (const line of lines.slice(0, -1)) {
      if (!line) continue;
      const event = record(JSON.parse(line)),
        payload = record(event?.payload);
      if (event?.type === "session_meta") {
        owned =
          payload?.id === data.id &&
          payload.cli_version === "0.154.0" &&
          payload.cwd === this.projection.options.directory;
        if (!owned) throw new Error("Codex Skill context session mismatch.");
      }
      if (!owned) continue;
      if (event?.type === "turn_context")
        turnId =
          typeof payload?.turn_id === "string" ? payload.turn_id : undefined;
      const name = turnId && this.explicit.get(`${data.id}\0${turnId}`);
      if (
        !turnId ||
        !name ||
        event?.type !== "response_item" ||
        payload?.type !== "message" ||
        payload.role !== "user" ||
        !Array.isArray(payload.content)
      )
        continue;
      const skill = this.projection.options.skills.find((s) => s.name === name),
        body = skill?.files.find((f) => f.relativePath === "SKILL.md")?.content;
      if (!skill || !body) continue;
      const expected = `<skill>\n<name>${name}</name>\n<path>${join(this.projection.skillRoot, name, "SKILL.md")}</path>\n${body}\n</skill>`;
      if (
        !payload.content.some(
          (c) =>
            record(c)?.type === "input_text" && record(c)?.text === expected,
        )
      )
        continue;
      service.ingestSkill({
        lineage: this.projection.options.lineage,
        providerContract: CODEX_ACTIVITY_CONTRACT,
        rawSessionId: data.id,
        requestIdentity: turnId,
        sourceIdentity: `${turnId}:skill:context`,
        receiptIdentity: `${turnId}:skill:context`,
        skillRoute: name,
        mode: "explicit",
        type: "context",
        bodyDigest: codexBodyDigest(body),
        completeBody: true,
      });
    }
  }
  observeThread(thread: unknown): void {
    const data = record(thread);
    if (!data || typeof data.id !== "string" || !Array.isArray(data.turns))
      throw new Error("Codex history evidence schema is unavailable.");
    this.assertSession(data.id);
    for (const raw of data.turns) {
      const turn = record(raw);
      if (!turn || typeof turn.id !== "string" || !Array.isArray(turn.items))
        throw new Error("Codex turn evidence schema is unavailable.");
      for (const item of turn.items) this.observeItem(data.id, turn.id, item);
    }
  }
  observeEvent(method: string, value: unknown): void {
    if (!["item/started", "item/completed"].includes(method)) return;
    const params = record(value);
    if (
      !params ||
      typeof params.threadId !== "string" ||
      typeof params.turnId !== "string"
    )
      throw new Error("Codex item evidence route is unavailable.");
    this.assertSession(params.threadId);
    this.observeItem(
      params.threadId,
      params.turnId,
      params.item,
      method === "item/completed",
    );
  }
  private observeItem(
    sessionId: string,
    turnId: string,
    value: unknown,
    completed?: boolean,
  ): void {
    const item = record(value),
      service = this.projection.options.evidence;
    if (!service || item?.type !== "mcpToolCall") return;
    const retained = this.historicalTurns.has(`${sessionId}\0${turnId}`);
    const retainedReceipt = readCapabilityReceipt(item.result);
    if (retainedReceipt)
      this.receiptIds.add(retainedReceipt.invocationId.toLowerCase());
    if (retained) return;
    if (
      typeof item.id !== "string" ||
      typeof item.server !== "string" ||
      typeof item.tool !== "string" ||
      !["inProgress", "completed", "failed"].includes(String(item.status))
    )
      throw new Error("Codex MCP item schema is unavailable.");
    const mapping = this.projection.options.capabilityTools.find(
      (t) => t.serverName === item.server && t.toolName === item.tool,
    );
    if (!mapping) return;
    const requestIdentity = `${turnId}:${item.id}`;
    const route = {
      lineage: this.projection.options.lineage,
      providerContract: CODEX_ACTIVITY_CONTRACT,
      rawSessionId: sessionId,
      requestIdentity,
      serverName: mapping.serverName,
      toolName: mapping.toolName,
    };
    service.ingestProvider({
      ...route,
      type: "request",
      sourceIdentity: `${requestIdentity}:request`,
    });
    if (item.status === "inProgress" || completed === false) return;
    const receipt = readCapabilityReceipt(item.result);
    if (!receipt) return;
    if (
      this.receiptIds.size >= 10000 &&
      !this.receiptIds.has(receipt.invocationId)
    )
      throw new Error("Codex receipt redaction capacity exceeded.");
    this.receiptIds.add(receipt.invocationId.toLowerCase());
    service.ingestProvider({
      ...route,
      type: "terminal",
      sourceIdentity: `${requestIdentity}:terminal`,
      receipt,
    });
  }

  private readonly invocationSessions = new Map<string, string>();
  observeHost(input: CodexOwnedHostObservation): void {
    if (
      input.runtimeGeneration !==
      this.projection.options.lineage.runtimeGenerationId
    )
      throw new Error("Stale owned Codex Host generation.");
    const tool = this.projection.options.capabilityTools.find(
      (t) =>
        t.serverName === input.serverName &&
        t.hostToolName === input.observation.toolName &&
        t.identity.resourceId === input.observation.capabilityId &&
        t.identity.resourceVersion === input.observation.capabilityVersion,
    );
    if (!tool) throw new Error("Owned Codex Host identity mismatch.");
    this.receiptIds.add(input.observation.invocationId.toLowerCase());
    this.projection.options.evidence?.ingestHost({
      lineage: this.projection.options.lineage,
      identity: tool.identity,
      observation: input.observation,
    });
    if (input.observation.type === "entered" && input.dispatchSessionId) {
      this.assertSession(input.dispatchSessionId);
      this.projection.options.evidence?.registerInvocationDispatch(
        this.projection.options.lineage,
        input.dispatchSessionId,
        input.observation.invocationId,
        CODEX_ACTIVITY_CONTRACT,
      );
      this.invocationSessions.set(
        input.observation.invocationId,
        input.dispatchSessionId,
      );
    }
    if (input.observation.type === "outcome")
      this.invocationSessions.delete(input.observation.invocationId);
  }
  async cancelSession(sessionId: string): Promise<void> {
    this.assertSession(sessionId);
    for (const [id, owner] of this.invocationSessions)
      if (owner === sessionId)
        await this.projection.options.evidence?.cancelInvocation(
          this.projection.options.lineage,
          sessionId,
          id,
        );
  }
  dispatchSessions(): string[] {
    return [...new Set(this.invocationSessions.values())];
  }
  sanitize(value: unknown): unknown {
    if (typeof value === "string") {
      if (value.includes("<skill>")) return "[Private Skill context omitted]";
      let clean = stripCapabilityReceiptText(value);
      if (/awCapabilityReceipt|aw\.capabilityReceipt/.test(clean))
        return "[Internal Resource evidence omitted]";
      for (const secret of [
        ...this.projection.options.capabilities.flatMap((c) => [
          c.authorizationHeader,
          c.authorizationHeader.replace(/^Bearer /, ""),
        ]),
        this.projection.options.environment.OPENAI_API_KEY,
      ])
        if (secret) clean = clean.replaceAll(secret, "[Credential omitted]");
      for (const path of [this.projection.root, this.projection.dataRoot])
        clean = clean.replaceAll(path, "[Private Resource path omitted]");
      return clean.replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        (id) =>
          this.receiptIds.has(id.toLowerCase())
            ? "[Internal Resource identifier omitted]"
            : id,
      );
    }
    if (Array.isArray(value)) return value.map((v) => this.sanitize(v));
    const data = record(value);
    if (!data) return value;
    return Object.fromEntries(
      Object.entries(data)
        .filter(
          ([key]) =>
            !["awCapabilityReceipt", "aw.capabilityReceipt"].includes(key),
        )
        .map(([key, child]) => [key, this.sanitize(child)]),
    );
  }
}
