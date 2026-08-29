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
  private readonly replies = new Map<string, unknown>();
  private readonly requests: RecordedRequest[] = [];
  private readonly responses: RecordedResponse[] = [];
  private readonly listeners = new Set<
    (message: CodexIncomingMessage) => void
  >();
  running = false;

  reply(method: string, result: unknown): void {
    this.replies.set(method, result);
  }

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
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
    return this.replies.get(method) as Result;
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
  it("reloads and verifies late capability tools", async () => {
    const { adapter, client } = createAdapter();
    client.reply("config/mcpServer/reload", {});
    client.reply("mcpServerStatus/list", { data: [{ name: "agentic_worktrees", runtimeStatus: "connected", tools: { web_search: {} } }], nextCursor: null });
    await adapter.refreshCapabilities("/repo", "thread-1", connection, ["web_search"]);
    expect(client.requestFor("thread/resume").params).toMatchObject({ threadId: "thread-1", config: { mcp_servers: { agentic_worktrees: { url: connection.url } } } });
    expect(client.requestFor("config/mcpServer/reload").params).toBeUndefined();
  });

  it("detaches the chat-scoped server and verifies it is absent", async () => {
    const { adapter, client } = createAdapter();
    client.reply("config/mcpServer/reload", {});
    client.reply("mcpServerStatus/list", { data: [], nextCursor: null });
    await adapter.refreshCapabilities("/repo", "thread-1", connection, []);
    expect(client.requestFor("thread/resume").params).toMatchObject({ config: { mcp_servers: {} } });
  });
});
