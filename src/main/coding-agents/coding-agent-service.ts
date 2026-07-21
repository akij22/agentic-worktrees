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
  codingAgentSessionDiffs,
  codingAgentSessions,
  repositories,
  runMessages,
  runOutputEvents,
  runs,
  worktrees,
} from '../../shared/db/schema';
import { CodexAdapter } from './codex-adapter';
import {
  findCodexInSystem,
  parseCodexVersion,
} from './codex-utils';
import { OpenCodeAdapter } from './opencode-adapter';
import {
  findOpenCodeInSystem,
  parseOpenCodeVersion,
} from './opencode-utils';
import type {
  CodingAgentAdapter,
  CodingAgentDiff,
  CodingAgentEvent,
  CodingAgentKind,
  CodingAgentMessage,
  CodingAgentModel,
  CodingAgentPermission,
  CodingAgentRunStatus,
} from './types';

const execFileAsync = promisify(execFile);

export interface AgentInstallationStatus {
  kind: CodingAgentKind;
  name: string;
  configured: boolean;
  executablePath: string | null;
  version: string | null;
  running: boolean;
  error: string | null;
}

export interface AgentStatus {
  installations: AgentInstallationStatus[];
}

export interface AgentSessionSummary {
  id: string;
  agentKind: CodingAgentKind;
  agentName: string;
  worktreeId: string;
  repositoryId: string;
  title: string;
  status: string;
  errorMessage: string | null;
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
  turnDiff: CodingAgentDiff[];
}

export interface AgentUiEvent {
  runId: string | null;
  type: string;
  payload: unknown;
}

interface CodingAgentHarness {
  installationId: CodingAgentKind;
  name: string;
  adapter: CodingAgentAdapter;
  discover: () => Promise<string | null>;
  parseVersion: (output: string) => string | null;
}

const harnesses: Record<CodingAgentKind, CodingAgentHarness> = {
  opencode: {
    installationId: 'opencode',
    name: 'OpenCode',
    adapter: new OpenCodeAdapter(),
    discover: findOpenCodeInSystem,
    parseVersion: parseOpenCodeVersion,
  },
  codex: {
    installationId: 'codex',
    name: 'Codex',
    adapter: new CodexAdapter(),
    discover: findCodexInSystem,
    parseVersion: parseCodexVersion,
  },
};

const harnessKinds = Object.keys(harnesses) as CodingAgentKind[];
const startupPromises = new Map<CodingAgentKind, Promise<void>>();
const listeners = new Set<(event: AgentUiEvent) => void>();
const reconcileTimers = new Map<string, NodeJS.Timeout>();
const reasoningByRun = new Map<string, Map<string, string>>();

const persistSessionDiffs = (
  runId: string,
  diffs: CodingAgentDiff[],
): void => {
  if (diffs.length === 0) return;
  const db = getDatabase();
  const updatedAt = new Date();
  db.transaction((tx) => {
    diffs.forEach((diff) => {
      const id = `${runId}:${diff.file}`;
      tx.insert(codingAgentSessionDiffs)
        .values({
          id,
          runId,
          file: diff.file,
          before: diff.before,
          after: diff.after,
          additions: diff.additions,
          deletions: diff.deletions,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: codingAgentSessionDiffs.id,
          set: {
            before: diff.before,
            after: diff.after,
            additions: diff.additions,
            deletions: diff.deletions,
            updatedAt,
          },
        })
        .run();
    });
  });
};

const getPersistedSessionDiffs = (runId: string): CodingAgentDiff[] =>
  getDatabase()
    .select({
      file: codingAgentSessionDiffs.file,
      before: codingAgentSessionDiffs.before,
      after: codingAgentSessionDiffs.after,
      additions: codingAgentSessionDiffs.additions,
      deletions: codingAgentSessionDiffs.deletions,
    })
    .from(codingAgentSessionDiffs)
    .where(eq(codingAgentSessionDiffs.runId, runId))
    .all();

const readHeadFile = async (directory: string, file: string): Promise<string> => {
  try {
    return (
      await execFileAsync('git', ['show', `HEAD:${file}`], {
        cwd: directory,
        maxBuffer: 10 * 1024 * 1024,
      })
    ).stdout;
  } catch {
    // Files added during the session do not exist in HEAD.
    return '';
  }
};

const readWorktreeFile = async (
  directory: string,
  file: string,
): Promise<string> => {
  const resolvedDirectory = path.resolve(directory);
  const resolvedFile = path.resolve(resolvedDirectory, file);
  if (
    resolvedFile !== resolvedDirectory &&
    !resolvedFile.startsWith(`${resolvedDirectory}${path.sep}`)
  ) {
    throw new Error(`Coding agent returned a diff outside the worktree: ${file}`);
  }
  try {
    return await fs.readFile(resolvedFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
};

const hydrateDiffContent = async (
  directory: string,
  diffs: CodingAgentDiff[],
): Promise<CodingAgentDiff[]> =>
  Promise.all(
    diffs.map(async (diff) => {
      if (diff.before || diff.after) return diff;
      const [before, after] = await Promise.all([
        readHeadFile(directory, diff.file),
        readWorktreeFile(directory, diff.file),
      ]);
      return { ...diff, before, after };
    }),
  );

const getInstallation = (kind: CodingAgentKind) =>
  getDatabase()
    .select()
    .from(codingAgentInstallations)
    .where(eq(codingAgentInstallations.id, kind))
    .get();

const getHarness = (kind: string): CodingAgentHarness => {
  if (kind !== 'opencode' && kind !== 'codex') {
    throw new Error(`Unsupported coding-agent installation kind: ${kind}`);
  }
  return harnesses[kind];
};

const getHarnessForInstallation = (installation: {
  id: string;
  kind: string;
}): CodingAgentHarness => {
  const harness = getHarness(installation.kind);
  if (installation.id !== harness.installationId) {
    throw new Error(
      `Coding-agent installation identity mismatch: ${installation.id}`,
    );
  }
  return harness;
};

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
    .select({
      run: runs,
      agent: codingAgentSessions,
      installation: codingAgentInstallations,
    })
    .from(runs)
    .innerJoin(codingAgentSessions, eq(codingAgentSessions.runId, runs.id))
    .innerJoin(
      codingAgentInstallations,
      eq(codingAgentInstallations.id, codingAgentSessions.installationId),
    )
    .where(eq(runs.id, runId))
    .get();
  if (!row) throw new Error(`Coding-agent session not found: ${runId}`);
  return row;
};

const toSummary = (row: ReturnType<typeof getSessionRecord>): AgentSessionSummary => ({
  id: row.run.id,
  agentKind: getHarnessForInstallation(row.installation).installationId,
  agentName: row.installation.name,
  worktreeId: row.run.worktreeId,
  repositoryId: row.run.repositoryId,
  title: row.run.title,
  status: row.run.status,
  errorMessage: row.run.errorMessage,
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

const appendOutputEvent = (
  runId: string,
  kind: CodingAgentKind,
  event: CodingAgentEvent,
): void => {
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
        stream: kind,
        payload: JSON.stringify(event.properties ?? null),
        createdAt: new Date(),
      })
      .run();
  });
};

const findRunIdForExternalSession = (
  kind: CodingAgentKind,
  externalSessionId: string,
): string | null => {
  const session = getDatabase()
    .select({ runId: codingAgentSessions.runId })
    .from(codingAgentSessions)
    .innerJoin(
      codingAgentInstallations,
      eq(codingAgentInstallations.id, codingAgentSessions.installationId),
    )
    .where(eq(codingAgentSessions.externalSessionId, externalSessionId))
    .get();
  if (!session) return null;
  const record = getSessionRecord(session.runId);
  return getHarnessForInstallation(record.installation).installationId === kind
    ? session.runId
    : null;
};

const replaceProjectedMessages = (
  runId: string,
  messages: CodingAgentMessage[],
): void => {
  const db = getDatabase();
  reasoningByRun.set(
    runId,
    new Map(
      messages
        .filter((message) => message.reasoning.trim().length > 0)
        .map((message) => [message.id, message.reasoning]),
    ),
  );
  db.transaction((tx) => {
    tx.delete(runMessages).where(eq(runMessages.runId, runId)).run();
    const visible = messages.filter(
      (message) =>
        message.content.trim().length > 0 || message.reasoning.trim().length > 0,
    );
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

const ensureStarted = async (harness: CodingAgentHarness): Promise<void> => {
  const installation = getInstallation(harness.installationId);
  if (!installation || !installation.enabled) {
    throw new Error(
      `${harness.name} is not configured. Select its executable in Settings.`,
    );
  }
  getHarnessForInstallation(installation);
  const runtime = harness.adapter.getStatus();
  if (runtime.running && runtime.version) return;
  const startupPromise = startupPromises.get(harness.installationId);
  if (startupPromise) return startupPromise;

  const currentStartup = (async () => {
    // Multiple renderer requests can arrive together on first navigation.
    // Re-check the runtime after waiting for the lock so only one harness
    // process/client pair is created for that burst.
    const currentRuntime = harness.adapter.getStatus();
    if (currentRuntime.running && currentRuntime.version) return;
    const version = await harness.adapter.start(
      installation.executablePath,
      app.getPath('userData'),
    );
    getDatabase()
      .update(codingAgentInstallations)
      .set({ version, lastVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(codingAgentInstallations.id, harness.installationId))
      .run();
  })();
  startupPromises.set(harness.installationId, currentStartup);
  try {
    await currentStartup;
  } finally {
    if (startupPromises.get(harness.installationId) === currentStartup) {
      startupPromises.delete(harness.installationId);
    }
  }
};

export const validateAgentExecutable = async (
  kind: CodingAgentKind,
  executablePath: string,
): Promise<{ path: string; version: string }> => {
  const harness = harnesses[kind];
  if (!path.isAbsolute(executablePath)) {
    throw new Error(`${harness.name} executable path must be absolute.`);
  }
  const resolvedPath = await fs.realpath(executablePath);
  const stat = await fs.stat(resolvedPath);
  if (!stat.isFile()) {
    throw new Error(`Selected ${harness.name} path is not a file.`);
  }
  const { stdout, stderr } = await execFileAsync(resolvedPath, ['--version'], {
    timeout: 5_000,
    windowsHide: true,
  });
  const version = harness.parseVersion(`${stdout}\n${stderr}`);
  if (!version) {
    throw new Error(
      `Selected executable did not return a valid ${harness.name} version.`,
    );
  }
  return { path: resolvedPath, version };
};

export const configureAgent = async (
  kind: CodingAgentKind,
  executablePath: string,
): Promise<AgentStatus> => {
  const harness = harnesses[kind];
  const validated = await validateAgentExecutable(kind, executablePath);
  await harness.adapter.stop();
  const now = new Date();
  const db = getDatabase();
  db.insert(codingAgentInstallations)
    .values({
      id: harness.installationId,
      kind: harness.installationId,
      name: harness.name,
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
        kind: harness.installationId,
        name: harness.name,
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

export const autoDiscoverAgent = async (
  kind: CodingAgentKind,
): Promise<AgentStatus | null> => {
  const candidate = await harnesses[kind].discover();
  if (!candidate) return null;
  try {
    await validateAgentExecutable(kind, candidate);
  } catch {
    // A PATH entry can be another program named like the harness. Treat it as
    // undiscovered so the IPC caller can continue to the file picker.
    return null;
  }
  return configureAgent(kind, candidate);
};

export const getAgentInstallationStatus = (): AgentStatus => ({
  installations: harnessKinds.map((kind) => {
    const harness = harnesses[kind];
    const installation = getInstallation(kind);
    if (installation) getHarnessForInstallation(installation);
    const runtime = harness.adapter.getStatus();
    return {
      kind,
      name: harness.name,
      configured: Boolean(installation?.enabled),
      executablePath: installation?.executablePath ?? null,
      version: runtime.version ?? installation?.version ?? null,
      running: runtime.running,
      error: runtime.error,
    };
  }),
});

export const listAgentWorktrees = (): AgentWorktreeContext[] =>
  getDatabase()
    .select({ worktree: worktrees, repository: repositories })
    .from(worktrees)
    .innerJoin(repositories, eq(repositories.id, worktrees.repositoryId))
    .all();

export const listAgentModels = async (
  runId: string,
): Promise<CodingAgentModel[]> => {
  const row = getSessionRecord(runId);
  const context = getContext(row.run.worktreeId);
  const harness = getHarnessForInstallation(row.installation);
  await ensureStarted(harness);
  return harness.adapter.listModels(context.worktree.path);
};

export const listAgentSessions = (worktreeId?: string): AgentSessionSummary[] => {
  const query = getDatabase()
    .select({
      run: runs,
      agent: codingAgentSessions,
      installation: codingAgentInstallations,
    })
    .from(runs)
    .innerJoin(codingAgentSessions, eq(codingAgentSessions.runId, runs.id))
    .innerJoin(
      codingAgentInstallations,
      eq(codingAgentInstallations.id, codingAgentSessions.installationId),
    )
    .orderBy(desc(runs.updatedAt));
  const rows = worktreeId
    ? query.where(eq(runs.worktreeId, worktreeId)).all()
    : query.all();
  return rows.map((row) => toSummary(row));
};

export const createAgentSession = async (input: {
  agentKind: CodingAgentKind;
  worktreeId: string;
  title: string;
}): Promise<AgentSessionSummary> => {
  const harness = harnesses[input.agentKind];
  const context = getContext(input.worktreeId);
  const installation = getInstallation(input.agentKind);
  if (!installation?.enabled) {
    throw new Error(`${harness.name} is not configured.`);
  }
  getHarnessForInstallation(installation);
  await ensureStarted(harness);
  const availableModels = await harness.adapter.listModels(context.worktree.path);
  const defaultModel =
    availableModels.find((model) => model.isDefault) ?? availableModels[0];
  if (!defaultModel) {
    throw new Error(`No ${harness.name} models are available.`);
  }

  const external = await harness.adapter.createSession(
    context.worktree.path,
    input.title,
    { modelId: defaultModel.modelId },
  );
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
        providerId: defaultModel.providerId,
        modelId: defaultModel.modelId,
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

export const setAgentSessionModel = async (input: {
  runId: string;
  providerId: string;
  modelId: string;
}): Promise<AgentSessionSummary> => {
  const row = getSessionRecord(input.runId);
  const context = getContext(row.run.worktreeId);
  const harness = getHarnessForInstallation(row.installation);
  await ensureStarted(harness);
  const availableModels = await harness.adapter.listModels(context.worktree.path);
  if (
    !availableModels.some(
      (model) =>
        model.providerId === input.providerId && model.modelId === input.modelId,
    )
  ) {
    throw new Error(`Selected ${harness.name} model is not available.`);
  }

  getDatabase()
    .update(codingAgentSessions)
    .set({
      providerId: input.providerId,
      modelId: input.modelId,
      updatedAt: new Date(),
    })
    .where(eq(codingAgentSessions.runId, input.runId))
    .run();
  return toSummary(getSessionRecord(input.runId));
};

export const reconcileAgentSession = async (runId: string): Promise<void> => {
  try {
    const row = getSessionRecord(runId);
    const context = getContext(row.run.worktreeId);
    const harness = getHarnessForInstallation(row.installation);
    await ensureStarted(harness);
    const externalSession = await harness.adapter.getSession(
      context.worktree.path,
      row.agent.externalSessionId,
    );
    if (externalSession.status) {
      setRunStatus(runId, externalSession.status, null);
    }
    const messages = await harness.adapter.listMessages(
      context.worktree.path,
      row.agent.externalSessionId,
    );
    replaceProjectedMessages(runId, messages);
  } catch (error) {
    setRunStatus(
      runId,
      'unavailable',
      error instanceof Error && error.message
        ? error.message
        : 'Unknown error while reconciling the coding-agent session.',
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
  const harness = getHarnessForInstallation(row.installation);
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
      reasoning: reasoningByRun.get(runId)?.get(message.id.slice(runId.length + 1)) ?? '',
      createdAt: message.createdAt.getTime(),
      completedAt: message.completedAt?.getTime() ?? null,
    }));
  const lastUserMessage = [...storedMessages]
    .reverse()
    .find((message) => message.role === 'user');
  const persistedDiff = getPersistedSessionDiffs(runId);
  const sessionDiff =
    persistedDiff.length === 0
      ? await harness.adapter.getDiff(
          context.worktree.path,
          row.agent.externalSessionId,
        )
      : [];
  const currentDiff = lastUserMessage
    ? await harness.adapter.getDiff(
        context.worktree.path,
        row.agent.externalSessionId,
        lastUserMessage.id.slice(runId.length + 1),
      )
    : [];
  // turnDiff holds only the changes made after the last user message, while
  // diff accumulates every change in the session.
  const hydratedSessionDiff = await hydrateDiffContent(
    context.worktree.path,
    sessionDiff,
  );
  const turnDiff = await hydrateDiffContent(context.worktree.path, currentDiff);
  persistSessionDiffs(runId, [...hydratedSessionDiff, ...turnDiff]);
  const diff = await hydrateDiffContent(
    context.worktree.path,
    getPersistedSessionDiffs(runId),
  );
  persistSessionDiffs(runId, diff);
  return {
    session: toSummary(row),
    context,
    messages: storedMessages,
    diff,
    turnDiff,
  };
};

export const sendAgentMessage = async (
  runId: string,
  content: string,
  reasoningVariant?: string,
): Promise<void> => {
  const row = getSessionRecord(runId);
  const context = getContext(row.run.worktreeId);
  const harness = getHarnessForInstallation(row.installation);
  await ensureStarted(harness);
  if (reasoningVariant) {
    const selectedModel = (
      await harness.adapter.listModels(context.worktree.path)
    ).find(
      (model) =>
        model.providerId === row.agent.providerId &&
        model.modelId === row.agent.modelId,
    );
    if (!selectedModel?.reasoningVariants.includes(reasoningVariant)) {
      throw new Error('Selected reasoning level is not available for this model.');
    }
  }
  if (!row.run.prompt) {
    getDatabase()
      .update(runs)
      .set({ prompt: content, updatedAt: new Date() })
      .where(eq(runs.id, runId))
      .run();
  }
  setRunStatus(runId, 'busy', null);
  try {
    await harness.adapter.sendPrompt(
      context.worktree.path,
      row.agent.externalSessionId,
      {
        content,
        providerId: row.agent.providerId,
        modelId: row.agent.modelId,
        reasoningVariant,
      },
    );
    // Adapters may return before the harness finishes processing. Reconcile
    // shortly after submission so the user's message is projected immediately.
    scheduleReconcile(runId);
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
  const harness = getHarnessForInstallation(row.installation);
  setRunStatus(runId, 'aborting', null);
  try {
    await harness.adapter.abort(context.worktree.path, row.agent.externalSessionId);
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
  const harness = getHarnessForInstallation(row.installation);
  await harness.adapter.respondPermission(
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

const handleAdapterEvent = (
  kind: CodingAgentKind,
  event: CodingAgentEvent,
): void => {
  const runId = event.sessionId
    ? findRunIdForExternalSession(kind, event.sessionId)
    : null;
  if (!runId) {
    const payload =
      event.type === 'server.exit'
        ? {
            ...(event.properties !== null &&
            typeof event.properties === 'object' &&
            !Array.isArray(event.properties)
              ? event.properties
              : { detail: event.properties }),
            agentKind: kind,
          }
        : event.properties;
    emit({ runId: null, type: event.type, payload });
    return;
  }

  appendOutputEvent(runId, kind, event);
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
};

harnessKinds.forEach((kind) => {
  harnesses[kind].adapter.subscribe((event) => handleAdapterEvent(kind, event));
});

export const stopCodingAgents = async (): Promise<void> => {
  await Promise.all(harnessKinds.map((kind) => harnesses[kind].adapter.stop()));
};

export type { CodingAgentPermission };
