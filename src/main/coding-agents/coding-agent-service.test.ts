import BetterSqlite3 from "better-sqlite3";
import { eq } from "drizzle-orm";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../shared/db/schema";
import {
  codingAgentInstallations,
  codingAgentSessionDiffs,
  codingAgentSessions,
  repositories,
  runOutputEvents,
  runs,
  worktrees,
} from "../../shared/db/schema";
import { bootstrapSchemaSql } from "../database/bootstrap";
import type {
  CodingAgentAccountUsage,
  CodingAgentAdapter,
  CodingAgentDiff,
  CodingAgentEvent,
  CodingAgentModel,
  CodingAgentSessionUsage,
} from "./types";

type AppDatabase = BetterSQLite3Database<typeof schema>;
type EventListener = (event: CodingAgentEvent) => void;

const mocks = vi.hoisted(() => {
  const createAdapter = (externalSessionId: string) => {
    const listeners = new Set<EventListener>();
    const status = {
      running: true,
      version: "1.0.0" as string | null,
      error: null as string | null,
    };
    const adapter = {
      getStatus: vi.fn(() => ({ ...status })),
      start: vi.fn(async () => {
        status.running = true;
        status.version = "1.0.0";
        status.error = null;
        return "1.0.0";
      }),
      stop: vi.fn(async () => {
        status.running = false;
      }),
      listModels: vi.fn<() => Promise<CodingAgentModel[]>>(async () => []),
      createSession: vi.fn(async () => ({ id: externalSessionId })),
      getSession: vi.fn(async (_directory: string, sessionId: string) => ({
        id: sessionId,
        status: "idle" as const,
      })),
      listMessages: vi.fn(async () => []),
      getDiff: vi.fn<
        (
          ...args: Parameters<CodingAgentAdapter["getDiff"]>
        ) => Promise<CodingAgentDiff[]>
      >(async () => []),
      sendPrompt: vi.fn(async () => undefined),
      compact: vi.fn(async () => undefined),
      getUsage: vi.fn<() => Promise<CodingAgentSessionUsage>>(async () => ({
        contextTokens: 50_000,
        contextWindow: 200_000,
        contextPercentage: 25,
        totalCost: 1.25,
        providerId: "anthropic",
        modelId: "claude-sonnet",
      })),
      getAccountUsage: vi.fn<() => Promise<CodingAgentAccountUsage>>(
        async () => ({
          providerId: "anthropic",
          availability: "unavailable" as const,
          message: "Account quota unavailable.",
          windows: [],
        }),
      ),
      abort: vi.fn(async () => undefined),
      respondPermission: vi.fn(async () => undefined),
      subscribe: vi.fn((listener: EventListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
    } satisfies CodingAgentAdapter;

    return {
      adapter,
      status,
      emit(event: CodingAgentEvent) {
        for (const listener of listeners) listener(event);
      },
    };
  };

  return {
    database: null as AppDatabase | null,
    primaryContexts: [] as Array<{
      worktree: typeof worktrees.$inferSelect;
      repository: typeof repositories.$inferSelect;
    }>,
    findCodexInSystem: vi.fn<() => Promise<string | null>>(),
    openCode: createAdapter("opencode-session"),
    codex: createAdapter("codex-thread"),
  };
});

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/agentic-worktrees-test") },
}));

vi.mock("../database/client", () => ({
  getDatabase: () => {
    if (!mocks.database) throw new Error("Test database is not initialized.");
    return mocks.database;
  },
}));

vi.mock("./opencode-adapter", () => ({
  OpenCodeAdapter: class {
    constructor() {
      return mocks.openCode.adapter;
    }
  },
}));

vi.mock("./codex-adapter", () => ({
  CodexAdapter: class {
    constructor() {
      return mocks.codex.adapter;
    }
  },
}));

vi.mock("./codex-utils", () => ({
  findCodexInSystem: mocks.findCodexInSystem,
  parseCodexVersion: (output: string) =>
    output.match(/^codex-cli\s+(\d+\.\d+\.\d+)\s*$/m)?.[1] ?? null,
}));

vi.mock("./primary-workspace-service", () => ({
  synchronizePrimaryWorkspaces: vi.fn(async () => mocks.primaryContexts),
  revalidatePrimaryWorkspace: vi.fn(async (worktreeId: string) => {
    const context = mocks.primaryContexts.find(
      ({ worktree }) => worktree.id === worktreeId,
    );
    if (!context) throw new Error(`Primary checkout not found: ${worktreeId}`);
    return context;
  }),
}));

import {
  type AgentUiEvent,
  autoDiscoverAgent,
  compactAgentSession,
  createAgentSession,
  getAgentInstallationStatus,
  getAgentSessionSnapshot,
  getAgentSessionUsage,
  getAgentAccountUsage,
  listAgentModels,
  listAgentSessions,
  listAgentWorktrees,
  markAgentSessionViewed,
  reconcileAgentSession,
  sendAgentMessage,
  stopCodingAgents,
  subscribeToAgentEvents,
} from "./coding-agent-service";

let sqlite: BetterSqlite3.Database;

const resetAdapter = (
  harness: typeof mocks.openCode,
  models: CodingAgentModel[],
): void => {
  harness.status.running = true;
  harness.status.version = "1.0.0";
  harness.status.error = null;
  Object.values(harness.adapter).forEach((value) => {
    if (typeof value === "function" && "mockClear" in value) value.mockClear();
  });
  harness.adapter.listModels.mockResolvedValue(models);
};

const seedContext = (): void => {
  if (!mocks.database) throw new Error("Test database is not initialized.");
  const now = new Date("2026-07-21T12:00:00.000Z");
  mocks.database
    .insert(repositories)
    .values({
      id: "repository-1",
      githubRepoId: 1,
      ownerLogin: "owner",
      name: "repo",
      fullName: "owner/repo",
      defaultBranch: "main",
      isPrivate: false,
      isArchived: false,
      cloneUrl: "https://example.com/owner/repo.git",
      sshUrl: null,
      htmlUrl: "https://example.com/owner/repo",
      localRootPath: process.cwd(),
      localCloneStatus: "ready",
      lastLocalScanAt: null,
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: null,
    })
    .run();
  mocks.database
    .insert(worktrees)
    .values({
      id: "worktree-1",
      repositoryId: "repository-1",
      name: "worktree",
      path: process.cwd(),
      branchName: "feature",
      baseBranchName: "main",
      headCommitSha: null,
      status: "ready",
      activeRunId: null,
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: null,
    })
    .run();
  mocks.database
    .insert(codingAgentInstallations)
    .values([
      {
        id: "opencode",
        kind: "opencode",
        name: "OpenCode",
        executablePath: "/usr/local/bin/opencode",
        version: "1.0.0",
        enabled: true,
        lastVerifiedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "codex",
        kind: "codex",
        name: "Codex",
        executablePath: "/usr/local/bin/codex",
        version: "1.0.0",
        enabled: true,
        lastVerifiedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run();
};

const seedSession = (
  runId: string,
  installationId: "opencode" | "codex",
  externalSessionId: string,
  status = "idle",
): void => {
  if (!mocks.database) throw new Error("Test database is not initialized.");
  const now = new Date("2026-07-21T12:00:00.000Z");
  mocks.database
    .insert(runs)
    .values({
      id: runId,
      repositoryId: "repository-1",
      worktreeId: "worktree-1",
      title: `${installationId} session`,
      prompt: "",
      status,
      command: null,
      outputStatus: "idle",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  mocks.database
    .insert(codingAgentSessions)
    .values({
      runId,
      installationId,
      externalSessionId,
      providerId: installationId === "codex" ? "openai" : "anthropic",
      modelId: installationId === "codex" ? "gpt-5.4" : "claude-sonnet",
      createdAt: now,
      updatedAt: now,
    })
    .run();
};

const seedSessionDiff = (runId: string): void => {
  if (!mocks.database) throw new Error("Test database is not initialized.");
  mocks.database
    .insert(codingAgentSessionDiffs)
    .values({
      id: `${runId}:src/example.ts`,
      runId,
      file: "src/example.ts",
      before: "const value = 1;",
      after: "const value = 2;",
      additions: 1,
      deletions: 1,
      updatedAt: new Date("2026-07-21T12:01:00.000Z"),
    })
    .run();
};

beforeEach(() => {
  vi.useFakeTimers();
  sqlite = new BetterSqlite3(":memory:");
  sqlite.exec(bootstrapSchemaSql);
  mocks.database = drizzle(sqlite, { schema });
  resetAdapter(mocks.openCode, [
    {
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "claude-sonnet",
      modelName: "Claude Sonnet",
      reasoningVariants: [],
      isDefault: true,
    },
  ]);
  resetAdapter(mocks.codex, [
    {
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5.3",
      modelName: "GPT-5.3",
      reasoningVariants: ["high"],
      isDefault: false,
    },
    {
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5.4",
      modelName: "GPT-5.4",
      reasoningVariants: ["high"],
      isDefault: true,
    },
  ]);
  mocks.findCodexInSystem.mockResolvedValue(null);
  mocks.primaryContexts = [];
  seedContext();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  mocks.database = null;
  sqlite.close();
});

describe("coding-agent service routing", () => {
  it("lists primary checkouts before linked worktrees", async () => {
    const database = mocks.database;
    if (!database) throw new Error("Test database is not initialized.");
    const repository = database.select().from(repositories).get();
    if (!repository) throw new Error("Repository fixture is unavailable.");
    mocks.primaryContexts = [
      {
        repository,
        worktree: {
          id: "primary:repository-1",
          repositoryId: repository.id,
          name: "Main checkout",
          path: "/tmp/primary-repository-1",
          branchName: "main",
          kind: "primary",
          baseBranchName: "main",
          headCommitSha: null,
          status: "ready",
          activeRunId: null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
          lastSyncedAt: new Date(0),
        },
      },
    ];

    const contexts = await listAgentWorktrees();

    expect(contexts.map(({ worktree }) => worktree.kind)).toEqual([
      "primary",
      "linked",
    ]);
  });

  it("creates a session in a revalidated primary checkout", async () => {
    const database = mocks.database;
    if (!database) throw new Error("Test database is not initialized.");
    const now = new Date(0);
    const repository = database
      .insert(repositories)
      .values({
        id: "repository-primary",
        githubRepoId: 2,
        ownerLogin: "owner",
        name: "primary-repository",
        fullName: "owner/primary-repository",
        defaultBranch: "main",
        isPrivate: false,
        isArchived: false,
        cloneUrl: "file:///tmp/primary-repository",
        sshUrl: null,
        htmlUrl: "",
        localRootPath: "/tmp/primary-repository",
        localCloneStatus: "cloned",
        lastLocalScanAt: now,
        createdAt: now,
        updatedAt: now,
        lastSyncedAt: now,
      })
      .returning()
      .get();
    const primary = database
      .insert(worktrees)
      .values({
        id: "primary:repository-primary",
        repositoryId: repository.id,
        name: "Main checkout",
        path: "/tmp/primary-repository",
        branchName: "main",
        kind: "primary",
        baseBranchName: "main",
        headCommitSha: null,
        status: "ready",
        activeRunId: null,
        createdAt: now,
        updatedAt: now,
        lastSyncedAt: now,
      })
      .returning()
      .get();
    mocks.primaryContexts = [{ repository, worktree: primary }];

    await createAgentSession({
      agentKind: "codex",
      worktreeId: primary.id,
      title: "Direct chat",
    });

    expect(mocks.codex.adapter.createSession).toHaveBeenCalledWith(
      primary.path,
      "Direct chat",
      { modelId: "gpt-5.4" },
    );
  });

  it("ignores an invalid automatically discovered Codex executable", async () => {
    mocks.findCodexInSystem.mockResolvedValue(process.execPath);

    await expect(autoDiscoverAgent("codex")).resolves.toBeNull();
  });

  it("creates a Codex session against the Codex installation and its default model", async () => {
    const session = await createAgentSession({
      agentKind: "codex",
      worktreeId: "worktree-1",
      title: "Codex chat",
    });

    expect(session).toMatchObject({
      agentKind: "codex",
      agentName: "Codex",
      modelId: "gpt-5.4",
    });
    expect(mocks.codex.adapter.createSession).toHaveBeenCalledWith(
      process.cwd(),
      "Codex chat",
      { modelId: "gpt-5.4" },
    );
    expect(mocks.openCode.adapter.createSession).not.toHaveBeenCalled();
    expect(
      mocks.database?.select().from(codingAgentSessions).get()?.installationId,
    ).toBe("codex");
  });

  it("rejects creation when the selected harness is not configured", async () => {
    mocks.database
      ?.delete(codingAgentInstallations)
      .where(eq(codingAgentInstallations.id, "codex"))
      .run();

    await expect(
      createAgentSession({
        agentKind: "codex",
        worktreeId: "worktree-1",
        title: "Codex chat",
      }),
    ).rejects.toThrow("Codex is not configured");
    expect(mocks.codex.adapter.createSession).not.toHaveBeenCalled();
    expect(mocks.openCode.adapter.createSession).not.toHaveBeenCalled();
  });

  it("routes resumed operations using the persisted installation", async () => {
    seedSession("codex-run", "codex", "codex-thread");

    await sendAgentMessage("codex-run", "Continue", "high");

    expect(mocks.codex.adapter.sendPrompt).toHaveBeenCalledWith(
      process.cwd(),
      "codex-thread",
      expect.objectContaining({ reasoningVariant: "high" }),
    );
    expect(mocks.openCode.adapter.sendPrompt).not.toHaveBeenCalled();
  });

  it("does not clear a newly submitted OpenCode turn before it becomes active", async () => {
    seedSession("opencode-run", "opencode", "opencode-session");

    await sendAgentMessage("opencode-run", "Start a long task");
    const snapshot = await getAgentSessionSnapshot("opencode-run");

    expect(snapshot.session.status).toBe("busy");
  });

  it("looks up models by run ID through the persisted installation", async () => {
    seedSession("codex-run", "codex", "codex-thread");

    const models = await listAgentModels("codex-run");

    expect(models.at(-1)?.modelId).toBe("gpt-5.4");
    expect(mocks.codex.adapter.listModels).toHaveBeenCalledWith(process.cwd());
    expect(mocks.openCode.adapter.listModels).not.toHaveBeenCalled();
  });

  it("compacts an OpenCode session with its persisted model", async () => {
    seedSession("opencode-run", "opencode", "opencode-session");

    await compactAgentSession("opencode-run");

    expect(mocks.openCode.adapter.compact).toHaveBeenCalledWith(
      process.cwd(),
      "opencode-session",
      { providerId: "anthropic", modelId: "claude-sonnet" },
    );
    expect(mocks.database?.select().from(runs).get()?.status).toBe("idle");
  });

  it("reads OpenCode usage with the persisted model", async () => {
    seedSession("opencode-run", "opencode", "opencode-session");

    await expect(getAgentSessionUsage("opencode-run")).resolves.toMatchObject({
      contextPercentage: 25,
      totalCost: 1.25,
      modelId: "claude-sonnet",
    });
    expect(mocks.openCode.adapter.getUsage).toHaveBeenCalledWith(
      process.cwd(),
      "opencode-session",
      { providerId: "anthropic", modelId: "claude-sonnet" },
    );
  });

  it("reads account quota with the persisted Codex provider and model", async () => {
    seedSession("codex-run", "codex", "codex-thread");
    mocks.codex.adapter.getAccountUsage.mockResolvedValueOnce({
      providerId: "openai",
      availability: "available",
      planType: "plus",
      windows: [
        {
          durationMinutes: 300,
          remainingPercentage: 77,
          resetsAt: 1_800_000_000_000,
        },
      ],
    });

    await expect(getAgentAccountUsage("codex-run")).resolves.toMatchObject({
      providerId: "openai",
      availability: "available",
      planType: "plus",
    });
    expect(mocks.codex.adapter.getAccountUsage).toHaveBeenCalledWith(
      process.cwd(),
      "codex-thread",
      { providerId: "openai", modelId: "gpt-5.4" },
    );
    expect(mocks.openCode.adapter.getAccountUsage).not.toHaveBeenCalled();
  });

  it("keeps a Codex session busy until compaction emits a terminal event", async () => {
    seedSession("codex-run", "codex", "codex-thread");

    await compactAgentSession("codex-run");

    expect(mocks.codex.adapter.compact).toHaveBeenCalledWith(
      process.cwd(),
      "codex-thread",
      { providerId: "openai", modelId: "gpt-5.4" },
    );
    expect(mocks.database?.select().from(runs).get()?.status).toBe("busy");

    mocks.codex.emit({
      directory: process.cwd(),
      sessionId: "codex-thread",
      type: "session.idle",
      properties: null,
    });

    expect(mocks.database?.select().from(runs).get()?.status).toBe("idle");
  });

  it("reads Codex usage without adding cost data", async () => {
    seedSession("codex-run", "codex", "codex-thread");
    mocks.codex.adapter.getUsage.mockResolvedValueOnce({
      contextTokens: 40_000,
      contextWindow: 200_000,
      contextPercentage: 20,
      providerId: "openai",
      modelId: "gpt-5.4",
    });

    await expect(getAgentSessionUsage("codex-run")).resolves.toEqual({
      contextTokens: 40_000,
      contextWindow: 200_000,
      contextPercentage: 20,
      providerId: "openai",
      modelId: "gpt-5.4",
    });
    expect(mocks.codex.adapter.getUsage).toHaveBeenCalledWith(
      process.cwd(),
      "codex-thread",
      { providerId: "openai", modelId: "gpt-5.4" },
    );
  });

  it("calculates missing line statistics when Codex returns file content only", async () => {
    seedSession("codex-run", "codex", "codex-thread");
    mocks.codex.adapter.getDiff.mockResolvedValueOnce([
      {
        file: "README.md",
        before: "",
        after: "# Scratch Clone\n\nNew content\n",
        additions: 0,
        deletions: 0,
      },
    ] satisfies CodingAgentDiff[]);

    const snapshot = await getAgentSessionSnapshot("codex-run");

    expect(snapshot.diff).toEqual([
      expect.objectContaining({
        file: "README.md",
        additions: 3,
        deletions: 0,
      }),
    ]);
  });

  it("keeps the persisted harness identity in session summaries", () => {
    seedSession("codex-run", "codex", "codex-thread");

    expect(listAgentSessions()).toEqual([
      expect.objectContaining({
        id: "codex-run",
        agentKind: "codex",
        agentName: "Codex",
      }),
    ]);
  });

  it("reports completed changes until the session is viewed", () => {
    seedSession("opencode-run", "opencode", "opencode-session", "busy");
    seedSessionDiff("opencode-run");

    mocks.openCode.emit({
      directory: process.cwd(),
      sessionId: "opencode-session",
      type: "session.idle",
      properties: null,
    });

    expect(listAgentSessions()[0]?.hasUnviewedChanges).toBe(true);

    markAgentSessionViewed("opencode-run");

    expect(listAgentSessions()[0]?.hasUnviewedChanges).toBe(false);
  });

  it("persists completed changes during idle reconciliation", async () => {
    seedSession("opencode-run", "opencode", "opencode-session", "busy");
    mocks.openCode.adapter.getDiff.mockResolvedValueOnce([
      {
        file: "src/completed.ts",
        before: "",
        after: "export const completed = true;",
        additions: 1,
        deletions: 0,
      },
    ]);

    mocks.openCode.emit({
      directory: process.cwd(),
      sessionId: "opencode-session",
      type: "session.idle",
      properties: null,
    });
    await reconcileAgentSession("opencode-run");

    expect(listAgentSessions()[0]?.hasUnviewedChanges).toBe(true);
    expect(
      mocks.database
        ?.select()
        .from(codingAgentSessionDiffs)
        .where(eq(codingAgentSessionDiffs.runId, "opencode-run"))
        .all(),
    ).toEqual([expect.objectContaining({ file: "src/completed.ts" })]);
  });

  it("does not report an idle session without changes as completed", () => {
    seedSession("opencode-run", "opencode", "opencode-session");

    expect(listAgentSessions()[0]?.hasUnviewedChanges).toBe(false);
  });

  it("reconciles a persisted run status after restarting its harness", async () => {
    seedSession("codex-run", "codex", "codex-thread", "busy");
    mocks.codex.status.running = false;
    mocks.codex.status.version = null;

    await reconcileAgentSession("codex-run");

    expect(mocks.codex.adapter.start).toHaveBeenCalledOnce();
    expect(mocks.codex.adapter.getSession).toHaveBeenCalledWith(
      process.cwd(),
      "codex-thread",
    );
    expect(mocks.database?.select().from(runs).get()?.status).toBe("idle");
  });

  it("keeps OpenCode available when Codex exits", () => {
    const events: AgentUiEvent[] = [];
    const unsubscribe = subscribeToAgentEvents((event) => events.push(event));
    mocks.codex.status.running = false;
    mocks.codex.status.error = "failed";
    mocks.codex.emit({
      directory: "",
      sessionId: null,
      type: "server.exit",
      properties: { error: "failed" },
    });
    unsubscribe();

    expect(getAgentInstallationStatus().installations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "codex", running: false }),
        expect.objectContaining({
          kind: "opencode",
          configured: true,
          running: true,
        }),
      ]),
    );
    expect(events).toContainEqual({
      runId: null,
      type: "server.exit",
      payload: { agentKind: "codex", error: "failed" },
    });
  });

  it("routes adapter events by event.sessionId and installation kind", () => {
    seedSession("codex-run", "codex", "codex-thread");
    seedSession("opencode-run", "opencode", "opencode-thread");
    const events: Array<{ runId: string | null; type: string }> = [];
    const unsubscribe = subscribeToAgentEvents((event) => events.push(event));

    mocks.codex.emit({
      directory: process.cwd(),
      sessionId: "codex-thread",
      type: "message.updated",
      properties: { sessionID: "opencode-thread" },
    });
    mocks.codex.emit({
      directory: process.cwd(),
      sessionId: "opencode-thread",
      type: "message.updated",
      properties: null,
    });
    unsubscribe();

    expect(events).toEqual([
      {
        runId: "codex-run",
        type: "message.updated",
        payload: { sessionID: "opencode-thread" },
      },
      { runId: null, type: "message.updated", payload: null },
    ]);
    expect(mocks.database?.select().from(runOutputEvents).all()).toEqual([
      expect.objectContaining({ runId: "codex-run", stream: "codex" }),
    ]);
  });

  it("keeps a run busy when a provider streams message activity without a status event", () => {
    seedSession("opencode-run", "opencode", "opencode-thread");

    mocks.openCode.emit({
      directory: process.cwd(),
      sessionId: "opencode-thread",
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          sessionID: "opencode-thread",
          messageID: "message-1",
          type: "text",
          text: "Progress",
        },
        delta: "Progress",
      },
    });

    expect(
      mocks.database
        ?.select({ status: runs.status })
        .from(runs)
        .where(eq(runs.id, "opencode-run"))
        .get()?.status,
    ).toBe("busy");
  });

  it("stops both harness adapters", async () => {
    await stopCodingAgents();

    expect(mocks.openCode.adapter.stop).toHaveBeenCalledOnce();
    expect(mocks.codex.adapter.stop).toHaveBeenCalledOnce();
  });
});
