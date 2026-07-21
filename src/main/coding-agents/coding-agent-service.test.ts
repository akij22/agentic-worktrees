import BetterSqlite3 from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../shared/db/schema';
import {
  codingAgentInstallations,
  codingAgentSessions,
  repositories,
  runOutputEvents,
  runs,
  worktrees,
} from '../../shared/db/schema';
import { bootstrapSchemaSql } from '../database/bootstrap';
import type {
  CodingAgentAdapter,
  CodingAgentDiff,
  CodingAgentEvent,
  CodingAgentModel,
} from './types';

type AppDatabase = BetterSQLite3Database<typeof schema>;
type EventListener = (event: CodingAgentEvent) => void;

const mocks = vi.hoisted(() => {
  const createAdapter = (externalSessionId: string) => {
    const listeners = new Set<EventListener>();
    const status = {
      running: true,
      version: '1.0.0' as string | null,
      error: null as string | null,
    };
    const adapter = {
      getStatus: vi.fn(() => ({ ...status })),
      start: vi.fn(async () => {
        status.running = true;
        status.version = '1.0.0';
        status.error = null;
        return '1.0.0';
      }),
      stop: vi.fn(async () => {
        status.running = false;
      }),
      listModels: vi.fn<() => Promise<CodingAgentModel[]>>(async () => []),
      createSession: vi.fn(async () => ({ id: externalSessionId })),
      getSession: vi.fn(async (_directory: string, sessionId: string) => ({
        id: sessionId,
        status: 'idle' as const,
      })),
      listMessages: vi.fn(async () => []),
      getDiff: vi.fn<
        (...args: Parameters<CodingAgentAdapter['getDiff']>) => Promise<CodingAgentDiff[]>
      >(async () => []),
      sendPrompt: vi.fn(async () => undefined),
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
    findCodexInSystem: vi.fn<() => Promise<string | null>>(),
    openCode: createAdapter('opencode-session'),
    codex: createAdapter('codex-thread'),
  };
});

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/agentic-worktrees-test') },
}));

vi.mock('../database/client', () => ({
  getDatabase: () => {
    if (!mocks.database) throw new Error('Test database is not initialized.');
    return mocks.database;
  },
}));

vi.mock('./opencode-adapter', () => ({
  OpenCodeAdapter: class {
    constructor() {
      return mocks.openCode.adapter;
    }
  },
}));

vi.mock('./codex-adapter', () => ({
  CodexAdapter: class {
    constructor() {
      return mocks.codex.adapter;
    }
  },
}));

vi.mock('./codex-utils', () => ({
  findCodexInSystem: mocks.findCodexInSystem,
  parseCodexVersion: (output: string) =>
    output.match(/^codex-cli\s+(\d+\.\d+\.\d+)\s*$/m)?.[1] ?? null,
}));

import {
  type AgentUiEvent,
  autoDiscoverAgent,
  createAgentSession,
  getAgentInstallationStatus,
  getAgentSessionSnapshot,
  listAgentModels,
  listAgentSessions,
  reconcileAgentSession,
  sendAgentMessage,
  stopCodingAgents,
  subscribeToAgentEvents,
} from './coding-agent-service';

let sqlite: BetterSqlite3.Database;

const resetAdapter = (
  harness: typeof mocks.openCode,
  models: CodingAgentModel[],
): void => {
  harness.status.running = true;
  harness.status.version = '1.0.0';
  harness.status.error = null;
  Object.values(harness.adapter).forEach((value) => {
    if (typeof value === 'function' && 'mockClear' in value) value.mockClear();
  });
  harness.adapter.listModels.mockResolvedValue(models);
};

const seedContext = (): void => {
  if (!mocks.database) throw new Error('Test database is not initialized.');
  const now = new Date('2026-07-21T12:00:00.000Z');
  mocks.database.insert(repositories).values({
    id: 'repository-1',
    githubRepoId: 1,
    ownerLogin: 'owner',
    name: 'repo',
    fullName: 'owner/repo',
    defaultBranch: 'main',
    isPrivate: false,
    isArchived: false,
    cloneUrl: 'https://example.com/owner/repo.git',
    sshUrl: null,
    htmlUrl: 'https://example.com/owner/repo',
    localRootPath: process.cwd(),
    localCloneStatus: 'ready',
    lastLocalScanAt: null,
    createdAt: now,
    updatedAt: now,
    lastSyncedAt: null,
  }).run();
  mocks.database.insert(worktrees).values({
    id: 'worktree-1',
    repositoryId: 'repository-1',
    name: 'worktree',
    path: process.cwd(),
    branchName: 'feature',
    baseBranchName: 'main',
    headCommitSha: null,
    status: 'ready',
    activeRunId: null,
    createdAt: now,
    updatedAt: now,
    lastSyncedAt: null,
  }).run();
  mocks.database.insert(codingAgentInstallations).values([
    {
      id: 'opencode',
      kind: 'opencode',
      name: 'OpenCode',
      executablePath: '/usr/local/bin/opencode',
      version: '1.0.0',
      enabled: true,
      lastVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'codex',
      kind: 'codex',
      name: 'Codex',
      executablePath: '/usr/local/bin/codex',
      version: '1.0.0',
      enabled: true,
      lastVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  ]).run();
};

const seedSession = (
  runId: string,
  installationId: 'opencode' | 'codex',
  externalSessionId: string,
  status = 'idle',
): void => {
  if (!mocks.database) throw new Error('Test database is not initialized.');
  const now = new Date('2026-07-21T12:00:00.000Z');
  mocks.database.insert(runs).values({
    id: runId,
    repositoryId: 'repository-1',
    worktreeId: 'worktree-1',
    title: `${installationId} session`,
    prompt: '',
    status,
    command: null,
    outputStatus: 'idle',
    createdAt: now,
    updatedAt: now,
  }).run();
  mocks.database.insert(codingAgentSessions).values({
    runId,
    installationId,
    externalSessionId,
    providerId: installationId === 'codex' ? 'openai' : 'anthropic',
    modelId: installationId === 'codex' ? 'gpt-5.4' : 'claude-sonnet',
    createdAt: now,
    updatedAt: now,
  }).run();
};

beforeEach(() => {
  vi.useFakeTimers();
  sqlite = new BetterSqlite3(':memory:');
  sqlite.exec(bootstrapSchemaSql);
  mocks.database = drizzle(sqlite, { schema });
  resetAdapter(mocks.openCode, [{
    providerId: 'anthropic',
    providerName: 'Anthropic',
    modelId: 'claude-sonnet',
    modelName: 'Claude Sonnet',
    reasoningVariants: [],
    isDefault: true,
  }]);
  resetAdapter(mocks.codex, [
    {
      providerId: 'openai',
      providerName: 'OpenAI',
      modelId: 'gpt-5.3',
      modelName: 'GPT-5.3',
      reasoningVariants: ['high'],
      isDefault: false,
    },
    {
      providerId: 'openai',
      providerName: 'OpenAI',
      modelId: 'gpt-5.4',
      modelName: 'GPT-5.4',
      reasoningVariants: ['high'],
      isDefault: true,
    },
  ]);
  mocks.findCodexInSystem.mockResolvedValue(null);
  seedContext();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  mocks.database = null;
  sqlite.close();
});

describe('coding-agent service routing', () => {
  it('ignores an invalid automatically discovered Codex executable', async () => {
    mocks.findCodexInSystem.mockResolvedValue(process.execPath);

    await expect(autoDiscoverAgent('codex')).resolves.toBeNull();
  });

  it('creates a Codex session against the Codex installation and its default model', async () => {
    const session = await createAgentSession({
      agentKind: 'codex',
      worktreeId: 'worktree-1',
      title: 'Codex chat',
    });

    expect(session).toMatchObject({
      agentKind: 'codex',
      agentName: 'Codex',
      modelId: 'gpt-5.4',
    });
    expect(mocks.codex.adapter.createSession).toHaveBeenCalledWith(
      process.cwd(),
      'Codex chat',
      { modelId: 'gpt-5.4' },
    );
    expect(mocks.openCode.adapter.createSession).not.toHaveBeenCalled();
    expect(
      mocks.database?.select().from(codingAgentSessions).get()?.installationId,
    ).toBe('codex');
  });

  it('rejects creation when the selected harness is not configured', async () => {
    mocks.database?.delete(codingAgentInstallations)
      .where(eq(codingAgentInstallations.id, 'codex'))
      .run();

    await expect(createAgentSession({
      agentKind: 'codex',
      worktreeId: 'worktree-1',
      title: 'Codex chat',
    })).rejects.toThrow('Codex is not configured');
    expect(mocks.codex.adapter.createSession).not.toHaveBeenCalled();
    expect(mocks.openCode.adapter.createSession).not.toHaveBeenCalled();
  });

  it('routes resumed operations using the persisted installation', async () => {
    seedSession('codex-run', 'codex', 'codex-thread');

    await sendAgentMessage('codex-run', 'Continue', 'high');

    expect(mocks.codex.adapter.sendPrompt).toHaveBeenCalledWith(
      process.cwd(),
      'codex-thread',
      expect.objectContaining({ reasoningVariant: 'high' }),
    );
    expect(mocks.openCode.adapter.sendPrompt).not.toHaveBeenCalled();
  });

  it('looks up models by run ID through the persisted installation', async () => {
    seedSession('codex-run', 'codex', 'codex-thread');

    const models = await listAgentModels('codex-run');

    expect(models.at(-1)?.modelId).toBe('gpt-5.4');
    expect(mocks.codex.adapter.listModels).toHaveBeenCalledWith(process.cwd());
    expect(mocks.openCode.adapter.listModels).not.toHaveBeenCalled();
  });

  it('calculates missing line statistics when Codex returns file content only', async () => {
    seedSession('codex-run', 'codex', 'codex-thread');
    mocks.codex.adapter.getDiff.mockResolvedValueOnce([
      {
        file: 'README.md',
        before: '',
        after: '# Scratch Clone\n\nNew content\n',
        additions: 0,
        deletions: 0,
      },
    ] satisfies CodingAgentDiff[]);

    const snapshot = await getAgentSessionSnapshot('codex-run');

    expect(snapshot.diff).toEqual([
      expect.objectContaining({
        file: 'README.md',
        additions: 3,
        deletions: 0,
      }),
    ]);
  });

  it('keeps the persisted harness identity in session summaries', () => {
    seedSession('codex-run', 'codex', 'codex-thread');

    expect(listAgentSessions()).toEqual([
      expect.objectContaining({
        id: 'codex-run',
        agentKind: 'codex',
        agentName: 'Codex',
      }),
    ]);
  });

  it('reconciles a persisted run status after restarting its harness', async () => {
    seedSession('codex-run', 'codex', 'codex-thread', 'busy');
    mocks.codex.status.running = false;
    mocks.codex.status.version = null;

    await reconcileAgentSession('codex-run');

    expect(mocks.codex.adapter.start).toHaveBeenCalledOnce();
    expect(mocks.codex.adapter.getSession).toHaveBeenCalledWith(
      process.cwd(),
      'codex-thread',
    );
    expect(mocks.database?.select().from(runs).get()?.status).toBe('idle');
  });

  it('keeps OpenCode available when Codex exits', () => {
    const events: AgentUiEvent[] = [];
    const unsubscribe = subscribeToAgentEvents((event) => events.push(event));
    mocks.codex.status.running = false;
    mocks.codex.status.error = 'failed';
    mocks.codex.emit({
      directory: '',
      sessionId: null,
      type: 'server.exit',
      properties: { error: 'failed' },
    });
    unsubscribe();

    expect(getAgentInstallationStatus().installations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'codex', running: false }),
        expect.objectContaining({
          kind: 'opencode',
          configured: true,
          running: true,
        }),
      ]),
    );
    expect(events).toContainEqual({
      runId: null,
      type: 'server.exit',
      payload: { agentKind: 'codex', error: 'failed' },
    });
  });

  it('routes adapter events by event.sessionId and installation kind', () => {
    seedSession('codex-run', 'codex', 'codex-thread');
    seedSession('opencode-run', 'opencode', 'opencode-thread');
    const events: Array<{ runId: string | null; type: string }> = [];
    const unsubscribe = subscribeToAgentEvents((event) => events.push(event));

    mocks.codex.emit({
      directory: process.cwd(),
      sessionId: 'codex-thread',
      type: 'message.updated',
      properties: { sessionID: 'opencode-thread' },
    });
    mocks.codex.emit({
      directory: process.cwd(),
      sessionId: 'opencode-thread',
      type: 'message.updated',
      properties: null,
    });
    unsubscribe();

    expect(events).toEqual([
      { runId: 'codex-run', type: 'message.updated', payload: { sessionID: 'opencode-thread' } },
      { runId: null, type: 'message.updated', payload: null },
    ]);
    expect(mocks.database?.select().from(runOutputEvents).all()).toEqual([
      expect.objectContaining({ runId: 'codex-run', stream: 'codex' }),
    ]);
  });

  it('stops both harness adapters', async () => {
    await stopCodingAgents();

    expect(mocks.openCode.adapter.stop).toHaveBeenCalledOnce();
    expect(mocks.codex.adapter.stop).toHaveBeenCalledOnce();
  });
});
