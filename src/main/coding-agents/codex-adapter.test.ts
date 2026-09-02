import { describe, expect, it } from "vitest";
import { CodexAdapter } from "./codex-adapter";
import type { CodexIncomingMessage } from "./codex-app-server-client";
import type { CodingAgentEvent } from "./types";

interface RecordedRequest {
  method: string;
  params: unknown;
}

interface RecordedResponse {
  id: string | number;
  result: unknown;
}

class FakeCodexClient {
  private readonly replies = new Map<string, unknown | ((params: unknown) => unknown)>();
  private readonly requests: RecordedRequest[] = [];
  private readonly responses: RecordedResponse[] = [];
  private readonly listeners = new Set<
    (message: CodexIncomingMessage) => void
  >();
  running = false;
  startCount = 0;
  stopCount = 0;

  reply(method: string, result: unknown | ((params: unknown) => unknown)): void {
    this.replies.set(method, result);
  }

  async start(): Promise<void> {
    this.startCount += 1;
    this.running = true;
  }

  async stop(): Promise<void> {
    this.stopCount += 1;
    this.running = false;
  }

  getStatus(): { running: boolean; error: string | null } {
    return { running: this.running, error: null };
  }

  async request<Result>(method: string, params: unknown): Promise<Result> {
    this.requests.push({ method, params });
    if (!this.replies.has(method)) {
      throw new Error(`Missing fake reply for ${method}`);
    }
    const reply = this.replies.get(method);
    return (typeof reply === "function" ? reply(params) : reply) as Result;
  }

  respond(id: string | number, result: unknown): void {
    this.responses.push({ id, result });
  }

  subscribe(listener: (message: CodexIncomingMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(message: CodexIncomingMessage): void {
    for (const listener of this.listeners) listener(message);
  }

  methods(): string[] {
    return this.requests.map(({ method }) => method);
  }

  requestFor(method: string): RecordedRequest {
    const request = this.requests.find(
      (candidate) => candidate.method === method,
    );
    if (!request) throw new Error(`Request not found: ${method}`);
    return request;
  }

  requestsFor(method: string): RecordedRequest[] {
    return this.requests.filter((request) => request.method === method);
  }

  responsesFor(id: string | number): RecordedResponse[] {
    return this.responses.filter((response) => response.id === id);
  }
}

const threadResponse = (
  status: "idle" | "active" | "systemError" = "idle",
) => ({
  thread: {
    id: "thread-1",
    status: { type: status },
    turns: [],
  },
});

const createAdapter = () => {
  const client = new FakeCodexClient();
  client.reply("thread/resume", { thread: { id: "thread-1" } });
  client.reply("thread/read", threadResponse());
  client.reply("thread/name/set", {});
  const adapter = new CodexAdapter(client, async () => "0.144.3");
  return { adapter, client };
};

const emitTokenUsage = (
  client: FakeCodexClient,
  threadId: string,
  modelContextWindow: number | null = 200_000,
) =>
  client.emit({
    method: "thread/tokenUsage/updated",
    params: {
      threadId,
      turnId: "turn-1",
      tokenUsage: {
        total: {
          totalTokens: 60_000,
          inputTokens: 50_000,
          cachedInputTokens: 10_000,
          cacheWriteInputTokens: 0,
          outputTokens: 10_000,
          reasoningOutputTokens: 2_000,
        },
        last: {
          totalTokens: 40_000,
          inputTokens: 35_000,
          cachedInputTokens: 8_000,
          cacheWriteInputTokens: 0,
          outputTokens: 5_000,
          reasoningOutputTokens: 1_000,
        },
        modelContextWindow,
      },
    },
  });

describe("Codex adapter", () => {
  it("starts manual thread compaction", async () => {
    const { adapter, client } = createAdapter();
    client.reply("thread/compact/start", {});

    await adapter.compact("/repo", "thread-1", {
      providerId: "openai",
      modelId: "gpt-5.4",
    });

    expect(client.requestFor("thread/compact/start").params).toEqual({
      threadId: "thread-1",
    });
  });

  it("returns the latest context usage for a Codex thread", async () => {
    const { adapter, client } = createAdapter();
    emitTokenUsage(client, "thread-1");

    await expect(
      adapter.getUsage("/repo", "thread-1", {
        providerId: "openai",
        modelId: "gpt-5.4",
      }),
    ).resolves.toEqual({
      contextTokens: 40_000,
      contextWindow: 200_000,
      contextPercentage: 20,
      providerId: "openai",
      modelId: "gpt-5.4",
    });
  });

  it("returns remaining account quota from Codex rate-limit windows", async () => {
    const { adapter, client } = createAdapter();
    client.reply("account/rateLimits/read", {
      rateLimits: {
        planType: "plus",
        primary: {
          usedPercent: 23,
          windowDurationMins: 300,
          resetsAt: 1_800_000_000,
        },
        secondary: {
          usedPercent: 67,
          windowDurationMins: 10_080,
          resetsAt: 1_800_604_800,
        },
      },
    });

    await expect(
      adapter.getAccountUsage("/repo", "thread-1", {
        providerId: "openai",
        modelId: "gpt-5.4",
      }),
    ).resolves.toEqual({
      providerId: "openai",
      availability: "available",
      planType: "plus",
      windows: [
        {
          durationMinutes: 300,
          remainingPercentage: 77,
          resetsAt: 1_800_000_000_000,
        },
        {
          durationMinutes: 10_080,
          remainingPercentage: 33,
          resetsAt: 1_800_604_800_000,
        },
      ],
    });
  });

  it("reports when Codex usage details are not available yet", async () => {
    const { adapter, client } = createAdapter();

    await expect(
      adapter.getUsage("/repo", "thread-1", {
        providerId: "openai",
        modelId: "gpt-5.4",
      }),
    ).rejects.toThrow("Codex token usage is not available yet.");

    emitTokenUsage(client, "thread-1", null);
    await expect(
      adapter.getUsage("/repo", "thread-1", {
        providerId: "openai",
        modelId: "gpt-5.4",
      }),
    ).rejects.toThrow("Codex context window is not available yet.");
  });

  it("scopes usage by thread and clears it when stopped", async () => {
    const { adapter, client } = createAdapter();
    emitTokenUsage(client, "thread-1");

    await expect(
      adapter.getUsage("/repo", "thread-2", {
        providerId: "openai",
        modelId: "gpt-5.4",
      }),
    ).rejects.toThrow("Codex token usage is not available yet.");

    await adapter.stop();
    await expect(
      adapter.getUsage("/repo", "thread-1", {
        providerId: "openai",
        modelId: "gpt-5.4",
      }),
    ).rejects.toThrow("Codex token usage is not available yet.");
  });

  it("starts a persistent thread with untrusted command approvals and gives it a name", async () => {
    const { adapter, client } = createAdapter();
    client.reply("thread/start", { thread: { id: "thread-1" } });

    await expect(
      adapter.createSession("/repo", "Chat", { modelId: "gpt-5.4" }),
    ).resolves.toEqual({ id: "thread-1" });

    expect(client.requestFor("thread/start")).toEqual({
      method: "thread/start",
      params: {
        model: "gpt-5.4",
        cwd: "/repo",
        sandbox: "workspace-write",
        approvalPolicy: "untrusted",
        ephemeral: false,
      },
    });
    expect(client.requestFor("thread/name/set").params).toEqual({
      threadId: "thread-1",
      name: "Chat",
    });
  });

  it("resumes and reads the persisted thread", async () => {
    const { adapter, client } = createAdapter();

    await expect(adapter.getSession("/repo", "thread-1")).resolves.toEqual({
      id: "thread-1",
      status: "idle",
    });

    expect(client.methods()).toEqual(["thread/resume", "thread/read"]);
    expect(client.requestFor("thread/read").params).toEqual({
      threadId: "thread-1",
      includeTurns: true,
    });
  });

  it("starts and interrupts a turn with the selected model and effort", async () => {
    const { adapter, client } = createAdapter();
    client.reply("turn/start", { turn: { id: "turn-1" } });
    client.reply("turn/interrupt", {});

    await adapter.sendPrompt("/repo", "thread-1", {
      content: "Fix it",
      providerId: "openai",
      modelId: "gpt-5.4",
      reasoningVariant: "high",
    });
    await adapter.abort("/repo", "thread-1");

    expect(client.requestFor("turn/start").params).toEqual({
      threadId: "thread-1",
      input: [{ type: "text", text: "Fix it", text_elements: [] }],
      cwd: "/repo",
      model: "gpt-5.4",
      effort: "high",
      summary: "detailed",
    });
    expect(client.requestFor("turn/interrupt").params).toEqual({
      threadId: "thread-1",
      turnId: "turn-1",
    });
  });

  it("emits normalized message and reasoning delta events with a session ID", () => {
    const { adapter, client } = createAdapter();
    const events: CodingAgentEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    client.emit({
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "message-1",
        delta: "Fixed",
      },
    });
    client.emit({
      method: "item/reasoning/summaryTextDelta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "reasoning-1",
        delta: "Inspecting",
        summaryIndex: 0,
      },
    });

    expect(events).toEqual([
      {
        directory: "",
        sessionId: "thread-1",
        type: "message.part.updated",
        properties: {
          part: {
            id: "message-1",
            sessionID: "thread-1",
            messageID: "turn-1",
            type: "text",
            text: "Fixed",
          },
          delta: "Fixed",
        },
      },
      {
        directory: "",
        sessionId: "thread-1",
        type: "message.part.updated",
        properties: {
          part: {
            id: "reasoning-1",
            sessionID: "thread-1",
            messageID: "turn-1",
            type: "reasoning",
            text: "Inspecting",
          },
          delta: "Inspecting",
        },
      },
    ]);
  });

  it("emits idle for a completed turn and clears the matching active turn", async () => {
    const { adapter, client } = createAdapter();
    const events: CodingAgentEvent[] = [];
    adapter.subscribe((event) => events.push(event));
    client.reply("turn/start", { turn: { id: "turn-1" } });
    await adapter.sendPrompt("/repo", "thread-1", {
      content: "Fix it",
      providerId: "openai",
      modelId: "gpt-5.4",
    });

    client.emit({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed", error: null },
      },
    });
    await adapter.abort("/repo", "thread-1");
    expect(events.map(({ type }) => type)).toEqual(["session.idle"]);
    expect(client.methods()).not.toContain("turn/interrupt");
  });

  it("emits an error from a failed turn/completed notification", async () => {
    const { adapter, client } = createAdapter();
    const events: CodingAgentEvent[] = [];
    adapter.subscribe((event) => events.push(event));
    client.reply("turn/start", { turn: { id: "turn-1" } });
    await adapter.sendPrompt("/repo", "thread-1", {
      content: "Fix it",
      providerId: "openai",
      modelId: "gpt-5.4",
    });

    client.emit({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: {
          id: "turn-1",
          status: "failed",
          error: { message: "Model failed" },
        },
      },
    });
    await adapter.abort("/repo", "thread-1");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sessionId: "thread-1",
      type: "session.error",
      properties: { error: "Model failed" },
    });
    expect(client.methods()).not.toContain("turn/interrupt");
  });

  it("does not clear the active turn for a mismatched terminal notification", async () => {
    const { adapter, client } = createAdapter();
    const events: CodingAgentEvent[] = [];
    adapter.subscribe((event) => events.push(event));
    client.reply("turn/start", { turn: { id: "turn-current" } });
    client.reply("turn/interrupt", {});
    await adapter.sendPrompt("/repo", "thread-1", {
      content: "Fix it",
      providerId: "openai",
      modelId: "gpt-5.4",
    });

    client.emit({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-old", status: "completed", error: null },
      },
    });
    await adapter.abort("/repo", "thread-1");

    expect(client.requestFor("turn/interrupt").params).toEqual({
      threadId: "thread-1",
      turnId: "turn-current",
    });
    expect(events).toEqual([]);
  });

  it.each([
    ["once", "accept"],
    ["always", "acceptForSession"],
    ["reject", "decline"],
  ] as const)(
    "maps command approval response %s to %s",
    async (response, decision) => {
      const { adapter, client } = createAdapter();
      const events: CodingAgentEvent[] = [];
      adapter.subscribe((event) => events.push(event));
      client.emit({
        id: 7,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "command-1",
          startedAtMs: 100,
          command: "npm test",
          cwd: "/repo",
        },
      });

      expect(events[0]).toMatchObject({
        sessionId: "thread-1",
        type: "permission.updated",
        properties: {
          id: "7",
          sessionId: "thread-1",
          type: "command",
        },
      });
      await adapter.respondPermission("/repo", "thread-1", "7", response);
      expect(client.responsesFor(7)).toEqual([{ id: 7, result: { decision } }]);
    },
  );

  it("maps file approvals to the same decision vocabulary", async () => {
    const { adapter, client } = createAdapter();
    const events: CodingAgentEvent[] = [];
    adapter.subscribe((event) => events.push(event));
    client.emit({
      id: 8,
      method: "item/fileChange/requestApproval",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "file-1",
        startedAtMs: 100,
        reason: "Write outside the current root",
        grantRoot: "/tmp/output",
      },
    });

    await adapter.respondPermission("/repo", "thread-1", "8", "always");
    expect(client.responsesFor(8)).toEqual([
      { id: 8, result: { decision: "acceptForSession" } },
    ]);
    expect(events[0].properties).not.toHaveProperty("metadata.grantRoot");
  });

  it("preserves string request IDs through approval responses", async () => {
    const { adapter, client } = createAdapter();
    client.emit({
      id: "approval-command-1",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "command-1",
        startedAtMs: 100,
        command: "npm test",
      },
    });

    await adapter.respondPermission(
      "/repo",
      "thread-1",
      "approval-command-1",
      "once",
    );
    expect(client.responsesFor("approval-command-1")).toEqual([
      {
        id: "approval-command-1",
        result: { decision: "accept" },
      },
    ]);
  });

  it.each([
    ["once", "turn", false],
    ["always", "session", false],
    ["reject", "turn", true],
  ] as const)(
    "maps permission-profile response %s with %s scope",
    async (response, scope, emptyPermissions) => {
      const { adapter, client } = createAdapter();
      const requestedPermissions = {
        network: { enabled: true },
        fileSystem: { read: ["/repo"], write: ["/tmp"] },
      };
      client.emit({
        id: 9,
        method: "item/permissions/requestApproval",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "permissions-1",
          environmentId: null,
          startedAtMs: 100,
          cwd: "/repo",
          reason: "Need additional access",
          permissions: requestedPermissions,
        },
      });

      await adapter.respondPermission("/repo", "thread-1", "9", response);
      expect(client.responsesFor(9)).toEqual([
        {
          id: 9,
          result: {
            permissions: emptyPermissions ? {} : requestedPermissions,
            scope,
          },
        },
      ]);
    },
  );

  it("rejects unknown permission IDs and safely declines unknown approval requests", async () => {
    const { adapter, client } = createAdapter();
    client.emit({
      id: 11,
      method: "item/unknown/requestApproval",
      params: { threadId: "thread-1" },
    });

    expect(client.responsesFor(11)).toEqual([
      { id: 11, result: { decision: "decline" } },
    ]);
    await expect(
      adapter.respondPermission("/repo", "thread-1", "missing", "once"),
    ).rejects.toThrow("Unknown Codex permission request");
  });
});


describe("Codex capability MCP integration", () => {
  const connection = { serverName: "agentic_worktrees", url: "http://127.0.0.1:43123/mcp", authorizationHeader: "Bearer run-token", profileId: "aw_run_1" };
  it("passes chat-scoped MCP config at thread start", async () => {
    const { adapter, client } = createAdapter();
    client.reply("thread/start", { thread: { id: "thread-1" } });
    await adapter.createSession("/repo", "Run", { modelId: "gpt-5.4", capabilities: connection });
    expect(client.requestFor("thread/start").params).toMatchObject({ config: { mcp_servers: { agentic_worktrees: { url: connection.url, http_headers: { Authorization: "Bearer run-token" } } } } });
  });

  it("restarts the owned app-server and resumes every session with isolated MCP config", async () => {
    const { adapter, client } = createAdapter();
    Object.assign(adapter as unknown as Record<string, unknown>, {
      executablePath: "/bin/codex",
      startupDirectory: "/data",
    });
    client.reply("thread/resume", (params: unknown) => ({
      thread: { id: (params as { threadId: string }).threadId },
    }));
    client.reply("thread/read", (params: unknown) => ({
      thread: {
        id: (params as { threadId: string }).threadId,
        status: { type: "idle" },
        turns: [],
      },
    }));
    client.reply("mcpServerStatus/list", (params: unknown) =>
      (params as { threadId: string }).threadId === "thread-1"
        ? { data: [{ name: "agentic_worktrees", runtimeStatus: "connected", tools: { web_search: {} } }], nextCursor: null }
        : { data: [], nextCursor: null });

    await adapter.reconfigureCapabilities({
      connections: [connection],
      sessions: [
        { directory: "/one", sessionId: "thread-1", capabilities: connection },
        { directory: "/two", sessionId: "thread-2" },
      ],
      expectedToolNamesByProfile: { [connection.profileId]: ["web_search"] },
    });

    expect(client.stopCount).toBe(1);
    expect(client.startCount).toBe(1);
    expect(client.methods()).not.toContain("thread/unsubscribe");
    expect(client.requestsFor("thread/resume").slice(-2).map(({ params }) => params)).toEqual([
      expect.objectContaining({ threadId: "thread-1", config: { mcp_servers: { agentic_worktrees: expect.any(Object) } } }),
      expect.objectContaining({ threadId: "thread-2", config: { mcp_servers: {} } }),
    ]);
  });

  it("restarts and resumes a deactivated session with an explicitly empty MCP config", async () => {
    const { adapter, client } = createAdapter();
    Object.assign(adapter as unknown as Record<string, unknown>, {
      executablePath: "/bin/codex",
      startupDirectory: "/data",
    });
    client.reply("mcpServerStatus/list", { data: [], nextCursor: null });

    await adapter.reconfigureCapabilities({
      connections: [],
      sessions: [{
        directory: "/one",
        sessionId: "thread-1",
        capabilityProfileId: connection.profileId,
      }],
      expectedToolNamesByProfile: { [connection.profileId]: [] },
      absentConnections: [connection],
    });

    expect(client.requestsFor("thread/resume").at(-1)?.params).toEqual(
      expect.objectContaining({ config: { mcp_servers: {} } }),
    );
    expect(client.methods()).not.toContain("thread/unsubscribe");
  });

  it("restarts again and restores every previous session config when rehydration fails", async () => {
    const { adapter, client } = createAdapter();
    Object.assign(adapter as unknown as Record<string, unknown>, {
      executablePath: "/bin/codex",
      startupDirectory: "/data",
    });
    let failDesiredResume = true;
    client.reply("thread/read", (params: unknown) => ({
      thread: { id: (params as { threadId: string }).threadId, status: { type: "idle" }, turns: [] },
    }));
    client.reply("thread/resume", (params: unknown) => {
      const request = params as { threadId: string; config?: { mcp_servers?: Record<string, unknown> } };
      if (failDesiredResume && request.config?.mcp_servers?.agentic_worktrees) {
        failDesiredResume = false;
        throw new Error("rehydration failed");
      }
      return { thread: { id: request.threadId } };
    });

    await expect(adapter.reconfigureCapabilities({
      connections: [connection],
      sessions: [
        { directory: "/one", sessionId: "thread-1", capabilities: connection },
        { directory: "/two", sessionId: "thread-2" },
      ],
    })).rejects.toThrow("Codex capability reload failed and was rolled back: rehydration failed");

    expect(client.stopCount).toBe(2);
    expect(client.startCount).toBe(2);
    expect(client.requestsFor("thread/resume").slice(-2).map(({ params }) => params)).toEqual([
      expect.objectContaining({ threadId: "thread-1", config: { mcp_servers: {} } }),
      expect.objectContaining({ threadId: "thread-2", config: { mcp_servers: {} } }),
    ]);
  });

  it("does not restart while any owned Codex session is busy", async () => {
    const { adapter, client } = createAdapter();
    Object.assign(adapter as unknown as Record<string, unknown>, {
      executablePath: "/bin/codex",
      startupDirectory: "/data",
    });
    client.reply("thread/resume", (params: unknown) => ({ thread: { id: (params as { threadId: string }).threadId } }));
    client.reply("thread/read", { thread: { id: "busy", status: { type: "active" }, turns: [] } });

    await expect(adapter.reconfigureCapabilities({
      connections: [connection],
      sessions: [{ directory: "/one", sessionId: "busy", capabilities: connection }],
    })).rejects.toThrow("every owned session is idle");
    expect(client.stopCount).toBe(0);
  });
});

describe("Codex native skills",()=>{
  it("registers and verifies the managed root",async()=>{const {adapter,client}=createAdapter();client.running=true;client.reply("skills/extraRoots/set",{});client.reply("skills/list",{data:[{skills:[{name:"security-review",enabled:true,path:"/managed/active/security-review/SKILL.md"}]}]});await adapter.configureSkills({activeRoot:"/managed/active",expectedIds:["security-review"]});expect(client.requestFor("skills/extraRoots/set").params).toEqual({extraRoots:["/managed/active"]});});
  it("rejects duplicate or missing discovered skills",async()=>{const {adapter,client}=createAdapter();client.reply("skills/list",{data:[{skills:[{name:"review",enabled:true,path:"/managed/active/review/SKILL.md"},{name:"review",enabled:true,path:"/managed/active/review/SKILL.md"}]}]});await expect(adapter.verifySkills("/repo",["review"])).rejects.toThrow(/verification/);});
  it("sends a native skill input with arguments",async()=>{const {adapter,client}=createAdapter();client.reply("turn/start",{turn:{id:"turn-1"}});await adapter.sendPrompt("/repo","thread-1",{providerId:"openai",modelId:"gpt",explicitSkill:{id:"review",name:"review",path:"/managed/review/SKILL.md",arguments:"Review auth"}});expect(client.requestFor("turn/start").params).toMatchObject({input:[{type:"skill",name:"review",path:"/managed/review/SKILL.md"},{type:"text",text:"Review auth",text_elements:[]}]});});
  it("omits empty argument text",async()=>{const {adapter,client}=createAdapter();client.reply("turn/start",{turn:{id:"turn-1"}});await adapter.sendPrompt("/repo","thread-1",{providerId:"openai",modelId:"gpt",explicitSkill:{id:"review",name:"review",path:"/managed/review/SKILL.md"}});expect((client.requestFor("turn/start").params as {input:unknown[]}).input).toHaveLength(1);});
  it("clears extra roots when skills are disabled",async()=>{const {adapter,client}=createAdapter();client.running=true;client.reply("skills/extraRoots/set",{});await adapter.configureSkills(null);expect(client.requestFor("skills/extraRoots/set").params).toEqual({extraRoots:[]});});
  it("rejects a matching ID from an unmanaged path",async()=>{const {adapter,client}=createAdapter();client.running=true;client.reply("skills/extraRoots/set",{});client.reply("skills/list",{data:[{skills:[{name:"review",enabled:true,path:"/other/review/SKILL.md"}]}]});await expect(adapter.configureSkills({activeRoot:"/managed/active",expectedIds:["review"]})).rejects.toThrow(/verification/);});

});
