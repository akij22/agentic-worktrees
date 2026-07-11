import { execFile } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import { desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDatabase } from '../database/client';
import {
  codingAgentInstallations,
  codingAgentSessions,
  repositories,
  runMessages,
  runOutputEvents,
  runs,
  worktrees,
} from '../../shared/db/schema';
import { OpenCodeAdapter } from './opencode-adapter';
import {
  parseOpenCodeVersion,
  readOpenCodeSessionId,
} from './opencode-utils';
import type {
  CodingAgentDiff,
  CodingAgentEvent,
  CodingAgentMessage,
  CodingAgentModel,
  CodingAgentPermission,
  CodingAgentRunStatus,
} from './types';

const execFileAsync = promisify(execFile);
const INSTALLATION_ID = 'opencode';

export interface AgentInstallationStatus {
  configured: boolean;
  executablePath: string | null;
  version: string | null;
  running: boolean;
  error: string | null;
}

export interface AgentSessionSummary {
  id: string;
  worktreeId: string;
  repositoryId: string;
  title: string;
  status: string;
  providerId: string;
  modelId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentWorktreeContext {
  worktree: typeof worktrees.$inferSelect;
  repository: typeof repositories.$inferSelect;
}

export interface AgentSessionSnapshot {
  session: AgentSessionSummary;
  context: AgentWorktreeContext;
  messages: CodingAgentMessage[];
  diff: CodingAgentDiff[];
}

export interface AgentUiEvent {
  runId: string | null;
  type: string;
  payload: unknown;
}

const adapter = new OpenCodeAdapter();
const listeners = new Set<(event: AgentUiEvent) => void>();
const reconcileTimers = new Map<string, NodeJS.Timeout>();

const getInstallation = () =>
  getDatabase()
    .select()
    .from(codingAgentInstallations)
    .where(eq(codingAgentInstallations.id, INSTALLATION_ID))
    .get();

const getContext = (worktreeId: string): AgentWorktreeContext => {
  const db = getDatabase();
  const worktree = db
    .select()
    .from(worktrees)
    .where(eq(worktrees.id, worktreeId))
    .get();
  if (!worktree) throw new Error(`Worktree not found: ${worktreeId}`);
  if (!existsSync(worktree.path)) {
    throw new Error(`Worktree path is unavailable: ${worktree.path}`);
  }
  const repository = db
    .select()
    .from(repositories)
    .where(eq(repositories.id, worktree.repositoryId))
    .get();
  if (!repository) throw new Error(`Repository not found: ${worktree.repositoryId}`);
  return { worktree, repository };
};

const getSessionRecord = (runId: string) => {
  const row = getDatabase()
    .select({ run: runs, agent: codingAgentSessions })
    .from(runs)
    .innerJoin(codingAgentSessions, eq(codingAgentSessions.runId, runs.id))
    .where(eq(runs.id, runId))
    .get();
  if (!row) throw new Error(`Coding-agent session not found: ${runId}`);
  return row;
};

const toSummary = (row: ReturnType<typeof getSessionRecord>): AgentSessionSummary => ({
  id: row.run.id,
  worktreeId: row.run.worktreeId,
  repositoryId: row.run.repositoryId,
  title: row.run.title,
  status: row.run.status,
  providerId: row.agent.providerId,
  modelId: row.agent.modelId,
  createdAt: row.run.createdAt,
  updatedAt: row.run.updatedAt,
});

const emit = (event: AgentUiEvent): void => {
  for (const listener of listeners) listener(event);
};

const setRunStatus = (
  runId: string,
  status: CodingAgentRunStatus,
  errorMessage?: string | null,
): void => {
  getDatabase()
    .update(runs)
    .set({
      status,
      errorMessage,
      outputStatus:
        status === 'busy' ||
        status === 'waiting_permission' ||
        status === 'aborting'
          ? 'streaming'
          : 'idle',
      updatedAt: new Date(),
    })
    .where(eq(runs.id, runId))
    .run();
};

const appendOutputEvent = (runId: string, event: CodingAgentEvent): void => {
  const db = getDatabase();
  db.transaction((tx) => {
    const run = tx.select().from(runs).where(eq(runs.id, runId)).get();
    if (!run) return;
    const sequence = run.lastSequence + 1;
    tx.update(runs)
      .set({
        lastSequence: sequence,
        lastOutputAt: new Date(),
        outputStatus: 'streaming',
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .run();
    tx.insert(runOutputEvents)
      .values({
        id: nanoid(),
        runId,
        sequence,
        eventType: event.type,
        stream: 'opencode',
        payload: JSON.stringify(event.properties ?? null),
        createdAt: new Date(),
      })
      .run();
  });
};

const findRunIdForExternalSession = (externalSessionId: string): string | null =>
  getDatabase()
    .select({ runId: codingAgentSessions.runId })
    .from(codingAgentSessions)
    .where(eq(codingAgentSessions.externalSessionId, externalSessionId))
    .get()?.runId ?? null;

const replaceProjectedMessages = (
  runId: string,
  messages: CodingAgentMessage[],
): void => {
  const db = getDatabase();
  db.transaction((tx) => {
    tx.delete(runMessages).where(eq(runMessages.runId, runId)).run();
    const visible = messages.filter((message) => message.content.trim().length > 0);
    visible.forEach((message, index) => {
      tx.insert(runMessages)
        .values({
          id: `${runId}:${message.id}`,
          runId,
          role: message.role,
          messageType: 'text',
          content: message.content,
          sequence: index + 1,
          createdAt: new Date(message.createdAt),
          completedAt: message.completedAt
            ? new Date(message.completedAt)
            : null,
        })
        .run();
    });
  });
};

const ensureStarted = async (): Promise<void> => {
  const installation = getInstallation();
  if (!installation || !installation.enabled) {
    throw new Error('OpenCode is not configured. Select its executable in Settings.');
  }
  const runtime = adapter.getStatus();
  if (!runtime.running) {
    const version = await adapter.start(
      installation.executablePath,
      app.getPath('userData'),
    );
    getDatabase()
      .update(codingAgentInstallations)
      .set({ version, lastVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(codingAgentInstallations.id, INSTALLATION_ID))
      .run();
  }
};

export const validateOpenCodeExecutable = async (
  executablePath: string,
): Promise<{ path: string; version: string }> => {
  if (!path.isAbsolute(executablePath)) {
    throw new Error('OpenCode executable path must be absolute.');
  }
  const resolvedPath = await fs.realpath(executablePath);
  const stat = await fs.stat(resolvedPath);
  if (!stat.isFile()) throw new Error('Selected OpenCode path is not a file.');
  const { stdout, stderr } = await execFileAsync(resolvedPath, ['--version'], {
    timeout: 5_000,
    windowsHide: true,
  });
  const version = parseOpenCodeVersion(`${stdout}\n${stderr}`);
  if (!version) {
    throw new Error('Selected executable did not return a valid OpenCode version.');
  }
  return { path: resolvedPath, version };
};

export const configureOpenCode = async (executablePath: string) => {
  const validated = await validateOpenCodeExecutable(executablePath);
  await adapter.stop();
  const now = new Date();
  const db = getDatabase();
  db.insert(codingAgentInstallations)
    .values({
      id: INSTALLATION_ID,
      kind: 'opencode',
      name: 'OpenCode',
      executablePath: validated.path,
      version: validated.version,
      enabled: true,
      lastVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: codingAgentInstallations.id,
      set: {
        executablePath: validated.path,
        version: validated.version,
        enabled: true,
        lastVerifiedAt: now,
        updatedAt: now,
      },
    })
    .run();
  return getAgentInstallationStatus();
};

export const getAgentInstallationStatus = (): AgentInstallationStatus => {
  const installation = getInstallation();
  const runtime = adapter.getStatus();
  return {
    configured: Boolean(installation?.enabled),
    executablePath: installation?.executablePath ?? null,
    version: runtime.version ?? installation?.version ?? null,
    running: runtime.running,
    error: runtime.error,
  };
};

export const listAgentWorktrees = (): AgentWorktreeContext[] =>
  getDatabase()
    .select({ worktree: worktrees, repository: repositories })
    .from(worktrees)
    .innerJoin(repositories, eq(repositories.id, worktrees.repositoryId))
    .all();

export const listAgentModels = async (
  worktreeId: string,
): Promise<CodingAgentModel[]> => {
  const context = getContext(worktreeId);
  await ensureStarted();
  return adapter.listModels(context.worktree.path);
};

export const listAgentSessions = (worktreeId?: string): AgentSessionSummary[] => {
  const query = getDatabase()
    .select({ run: runs, agent: codingAgentSessions })
    .from(runs)
    .innerJoin(codingAgentSessions, eq(codingAgentSessions.runId, runs.id))
    .orderBy(desc(runs.updatedAt));
  const rows = worktreeId
    ? query.where(eq(runs.worktreeId, worktreeId)).all()
    : query.all();
  return rows.map((row) => toSummary(row));
};

export const createAgentSession = async (input: {
  worktreeId: string;
  title: string;
  providerId: string;
  modelId: string;
}): Promise<AgentSessionSummary> => {
  const context = getContext(input.worktreeId);
  const installation = getInstallation();
  if (!installation) throw new Error('OpenCode is not configured.');
  await ensureStarted();
  const availableModels = await adapter.listModels(context.worktree.path);
  if (
    !availableModels.some(
      (model) =>
        model.providerId === input.providerId && model.modelId === input.modelId,
    )
  ) {
    throw new Error('Selected OpenCode model is not available.');
  }

  const external = await adapter.createSession(context.worktree.path, input.title);
  const now = new Date();
  const runId = nanoid();
  getDatabase().transaction((tx) => {
    tx.insert(runs)
      .values({
        id: runId,
        repositoryId: context.repository.id,
        worktreeId: context.worktree.id,
        title: input.title,
        prompt: '',
        status: 'idle',
        command: null,
        outputStatus: 'idle',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    tx.insert(codingAgentSessions)
      .values({
        runId,
        installationId: installation.id,
        externalSessionId: external.id,
        providerId: input.providerId,
        modelId: input.modelId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    tx.update(worktrees)
      .set({ activeRunId: runId, updatedAt: now })
      .where(eq(worktrees.id, context.worktree.id))
      .run();
  });
  return toSummary(getSessionRecord(runId));
};

export const reconcileAgentSession = async (runId: string): Promise<void> => {
  const row = getSessionRecord(runId);
  const context = getContext(row.run.worktreeId);
  await ensureStarted();
  try {
    await adapter.getSession(context.worktree.path, row.agent.externalSessionId);
    const messages = await adapter.listMessages(
      context.worktree.path,
      row.agent.externalSessionId,
    );
    replaceProjectedMessages(runId, messages);
  } catch (error) {
    setRunStatus(
      runId,
      'unavailable',
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
};

export const getAgentSessionSnapshot = async (
  runId: string,
): Promise<AgentSessionSnapshot> => {
  await reconcileAgentSession(runId);
  const row = getSessionRecord(runId);
  const context = getContext(row.run.worktreeId);
  const storedMessages = getDatabase()
    .select()
    .from(runMessages)
    .where(eq(runMessages.runId, runId))
    .orderBy(runMessages.sequence)
    .all()
    .map((message) => ({
      id: message.id,
      role: message.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: message.content,
      createdAt: message.createdAt.getTime(),
      completedAt: message.completedAt?.getTime() ?? null,
    }));
  const diff = await adapter.getDiff(
    context.worktree.path,
    row.agent.externalSessionId,
  );
  return {
    session: toSummary(row),
    context,
    messages: storedMessages,
    diff,
  };
};

export const sendAgentMessage = async (
  runId: string,
  content: string,
): Promise<void> => {
  const row = getSessionRecord(runId);
  const context = getContext(row.run.worktreeId);
  await ensureStarted();
  if (!row.run.prompt) {
    getDatabase()
      .update(runs)
      .set({ prompt: content, updatedAt: new Date() })
      .where(eq(runs.id, runId))
      .run();
  }
  setRunStatus(runId, 'busy', null);
  try {
    await adapter.sendPrompt(context.worktree.path, row.agent.externalSessionId, {
      content,
      providerId: row.agent.providerId,
      modelId: row.agent.modelId,
    });
  } catch (error) {
    setRunStatus(
      runId,
      'error',
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
};

export const abortAgentSession = async (runId: string): Promise<void> => {
  const row = getSessionRecord(runId);
  const context = getContext(row.run.worktreeId);
  setRunStatus(runId, 'aborting', null);
  try {
    await adapter.abort(context.worktree.path, row.agent.externalSessionId);
    setRunStatus(runId, 'idle', null);
  } catch (error) {
    setRunStatus(
      runId,
      'error',
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
};

export const respondToAgentPermission = async (
  runId: string,
  permissionId: string,
  response: 'once' | 'always' | 'reject',
): Promise<void> => {
  const row = getSessionRecord(runId);
  const context = getContext(row.run.worktreeId);
  await adapter.respondPermission(
    context.worktree.path,
    row.agent.externalSessionId,
    permissionId,
    response,
  );
  setRunStatus(runId, 'busy', null);
};

export const subscribeToAgentEvents = (
  listener: (event: AgentUiEvent) => void,
): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const scheduleReconcile = (runId: string): void => {
  const existing = reconcileTimers.get(runId);
  if (existing) clearTimeout(existing);
  reconcileTimers.set(
    runId,
    setTimeout(() => {
      reconcileTimers.delete(runId);
      void reconcileAgentSession(runId)
        .then(() => emit({ runId, type: 'messages.updated', payload: null }))
        .catch((error) =>
          emit({
            runId,
            type: 'session.error',
            payload: { error: error instanceof Error ? error.message : String(error) },
          }),
        );
    }, 120),
  );
};

adapter.subscribe((event) => {
  const externalSessionId = readOpenCodeSessionId(event.properties);
  const runId = externalSessionId
    ? findRunIdForExternalSession(externalSessionId)
    : null;
  if (!runId) {
    emit({ runId: null, type: event.type, payload: event.properties });
    return;
  }

  appendOutputEvent(runId, event);
  if (event.type === 'message.updated' || event.type === 'message.part.updated') {
    scheduleReconcile(runId);
  } else if (event.type === 'session.idle') {
    setRunStatus(runId, 'idle', null);
    scheduleReconcile(runId);
  } else if (event.type === 'session.error') {
    setRunStatus(runId, 'error', JSON.stringify(event.properties));
  } else if (event.type === 'permission.updated') {
    setRunStatus(runId, 'waiting_permission', null);
  } else if (event.type === 'session.status') {
    const status =
      event.properties && typeof event.properties === 'object' &&
      'status' in event.properties && event.properties.status &&
      typeof event.properties.status === 'object' &&
      'type' in event.properties.status
        ? event.properties.status.type
        : null;
    if (status === 'busy') setRunStatus(runId, 'busy', null);
    if (status === 'idle') setRunStatus(runId, 'idle', null);
  }
  emit({ runId, type: event.type, payload: event.properties });
});

export const stopCodingAgent = async (): Promise<void> => adapter.stop();

export type { CodingAgentPermission };
