import { nanoid } from 'nanoid';
import {
  intelligenceDiffComparisonSchema,
  intelligenceOverlapDetailsSchema,
  intelligenceSnapshotSchema,
  intelligenceSnapshotEventSchema,
  type IntelligenceDiffComparisonDto,
  type IntelligenceOverlapDetailsDto,
  type IntelligenceSnapshotDto,
  type IntelligenceSnapshotEventDto,
} from '../../shared/ipc/schemas';
import { classifyWorktreeOverlaps } from './overlap-classifier';
import type { GitChangeCollector } from './git-change-collector';
import type { IntelligenceRepository } from './intelligence-repository';
import { analyzeChangedSymbols } from './symbol-analyzer';
import type {
  CollectedWorktreeChanges,
  PersistedDiffComparison,
  PersistedIntelligenceSnapshot,
  PersistedIntelligenceWorktree,
  PersistedOverlapDetails,
} from './types';

export interface IntelligenceWorktreeSource {
  id: string;
  repositoryId: string;
  path: string;
  branchName: string;
  baseBranchName: string | null;
}

export interface IntelligenceSessionSource {
  id: string;
  worktreeId: string;
  repositoryId: string;
  title: string;
  agentKind: 'codex' | 'opencode';
  agentName: string;
  status: string;
  updatedAt: Date;
}

type IntelligenceTimer = ReturnType<typeof setTimeout> | number;

export interface IntelligenceServiceDependencies {
  listWorktrees: (repositoryId: string) => IntelligenceWorktreeSource[];
  listSessions: () => IntelligenceSessionSource[];
  collector: GitChangeCollector;
  repository: IntelligenceRepository;
  now?: () => number;
  createId?: () => string;
  setTimer?: (callback: () => void, delay: number) => IntelligenceTimer;
  clearTimer?: (timer: IntelligenceTimer) => void;
}

export interface IntelligenceService {
  getSnapshot(repositoryId: string): IntelligenceSnapshotDto | null;
  refresh(repositoryId: string): Promise<IntelligenceSnapshotDto>;
  getOverlap(overlapId: string): IntelligenceOverlapDetailsDto;
  compareDiffs(overlapId: string, targetId?: string): IntelligenceDiffComparisonDto;
  scheduleRefreshForRun(runId: string): void;
  subscribe(listener: (event: IntelligenceSnapshotEventDto) => void): () => void;
}

const ACTIVE_STATUSES = new Set(['busy', 'creating', 'waiting_permission']);

const latestSessionsByWorktree = (
  sessions: IntelligenceSessionSource[],
): Map<string, IntelligenceSessionSource> => {
  const latest = new Map<string, IntelligenceSessionSource>();
  for (const session of sessions) {
    const current = latest.get(session.worktreeId);
    if (!current || session.updatedAt > current.updatedAt) {
      latest.set(session.worktreeId, session);
    }
  }
  return latest;
};

const enrichSymbols = (
  collected: CollectedWorktreeChanges,
): CollectedWorktreeChanges => ({
  ...collected,
  files: collected.files.map((file) => ({
    ...file,
    symbols: file.binary || file.afterContent === null
      ? []
      : analyzeChangedSymbols({
          path: file.path,
          content: file.afterContent,
          ranges: file.ranges,
        }),
  })),
});

const publicWorktree = (worktree: PersistedIntelligenceWorktree) => ({
  worktreeId: worktree.worktreeId,
  runId: worktree.runId,
  task: worktree.task,
  branch: worktree.branch,
  baseBranch: worktree.baseBranch,
  agentKind: worktree.agentKind,
  agentName: worktree.agentName,
  status: worktree.status,
  changedFileCount: worktree.files.length,
  additions: worktree.additions,
  deletions: worktree.deletions,
  files: worktree.files.map((file) => ({
    path: file.path,
    modulePath: file.modulePath,
    additions: file.additions,
    deletions: file.deletions,
    symbols: file.symbols.map(({ qualifiedName }) => qualifiedName),
  })),
  independent: worktree.independent,
  warning: worktree.warning,
  updatedAt: worktree.updatedAt,
});

const publicSnapshot = (
  snapshot: PersistedIntelligenceSnapshot,
  stale = false,
  refreshError: string | null = null,
): IntelligenceSnapshotDto => intelligenceSnapshotSchema.parse({
  id: snapshot.id,
  repositoryId: snapshot.repositoryId,
  startedAt: snapshot.startedAt,
  completedAt: snapshot.completedAt,
  stale,
  refreshError,
  warnings: snapshot.warnings,
  worktrees: snapshot.worktrees.map(publicWorktree),
  overlaps: snapshot.overlaps,
});

const publicOverlap = (
  details: PersistedOverlapDetails,
): IntelligenceOverlapDetailsDto => intelligenceOverlapDetailsSchema.parse({
  overlap: details.overlap,
  left: publicWorktree(details.left),
  right: publicWorktree(details.right),
});

const diffFiles = (comparison: PersistedDiffComparison['left']) => ({
  worktreeId: comparison.worktreeId,
  runId: comparison.runId,
  files: comparison.files.map((file) => ({
    path: file.path,
    modulePath: file.modulePath,
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch,
    binary: file.binary,
  })),
});

const publicComparison = (
  comparison: PersistedDiffComparison,
): IntelligenceDiffComparisonDto => intelligenceDiffComparisonSchema.parse({
  overlapId: comparison.overlapId,
  left: diffFiles(comparison.left),
  right: diffFiles(comparison.right),
});

const collectOne = async (
  collector: GitChangeCollector,
  worktree: IntelligenceWorktreeSource,
): Promise<CollectedWorktreeChanges> => {
  if (!worktree.baseBranchName) {
    throw new Error('base branch is not configured');
  }
  return enrichSymbols(await collector.collect({
    worktreeId: worktree.id,
    repositoryId: worktree.repositoryId,
    worktreePath: worktree.path,
    branchName: worktree.branchName,
    baseBranchName: worktree.baseBranchName,
  }));
};

const collectRepositoryChanges = async (
  dependencies: IntelligenceServiceDependencies,
  candidates: IntelligenceWorktreeSource[],
): Promise<{ collected: CollectedWorktreeChanges[]; warnings: string[] }> => {
  const collected: CollectedWorktreeChanges[] = [];
  const warnings: string[] = [];
  for (const worktree of candidates) {
    try {
      collected.push(await collectOne(dependencies.collector, worktree));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${worktree.id}: ${message}`);
    }
  }
  return { collected, warnings };
};

const toPersistedWorktree = ({
  change,
  source,
  session,
  independent,
  createId,
}: {
  change: CollectedWorktreeChanges;
  source: IntelligenceWorktreeSource;
  session: IntelligenceSessionSource;
  independent: boolean;
  createId: () => string;
}): PersistedIntelligenceWorktree => ({
  id: createId(),
  worktreeId: source.id,
  runId: session.id,
  task: session.title,
  branch: source.branchName,
  baseBranch: source.baseBranchName,
  agentKind: session.agentKind,
  agentName: session.agentName,
  status: session.status,
  additions: change.files.reduce((sum, file) => sum + file.additions, 0),
  deletions: change.files.reduce((sum, file) => sum + file.deletions, 0),
  independent,
  warning: change.warnings.length > 0 ? change.warnings.join('; ') : null,
  updatedAt: session.updatedAt.getTime(),
  files: change.files,
});

export const createIntelligenceService = (
  dependencies: IntelligenceServiceDependencies,
): IntelligenceService => {
  const now = dependencies.now ?? Date.now;
  const createId = dependencies.createId ?? nanoid;
  const setTimer = dependencies.setTimer ?? setTimeout;
  const clearTimer = dependencies.clearTimer ?? clearTimeout;
  const inFlight = new Map<string, Promise<IntelligenceSnapshotDto>>();
  const timers = new Map<string, IntelligenceTimer>();
  const listeners = new Set<(event: IntelligenceSnapshotEventDto) => void>();

  const analyze = async (repositoryId: string): Promise<IntelligenceSnapshotDto> => {
    const startedAt = now();
    const latestSessions = latestSessionsByWorktree(dependencies.listSessions());
    const candidates = dependencies.listWorktrees(repositoryId)
      .filter(({ id }) => latestSessions.has(id));
    const collection = await collectRepositoryChanges(dependencies, candidates);
    const eligible = collection.collected.filter((change) => {
      const session = latestSessions.get(change.worktreeId);
      return change.files.length > 0 || Boolean(session && ACTIVE_STATUSES.has(session.status));
    });
    const classification = classifyWorktreeOverlaps(eligible);
    const independent = new Set(classification.independentWorktreeIds);
    const worktrees = eligible.map((change) => {
      const source = candidates.find(({ id }) => id === change.worktreeId);
      const session = latestSessions.get(change.worktreeId);
      if (!source || !session) {
        throw new Error(`Eligible worktree context is missing: ${change.worktreeId}`);
      }
      return toPersistedWorktree({
        change,
        source,
        session,
        independent: independent.has(source.id),
        createId,
      });
    }).sort((left, right) => left.worktreeId.localeCompare(right.worktreeId));
    const persisted: PersistedIntelligenceSnapshot = {
      id: createId(),
      repositoryId,
      startedAt,
      completedAt: now(),
      warnings: collection.warnings,
      worktrees,
      overlaps: classification.overlaps.map((overlap) => ({
        ...overlap,
        id: createId(),
      })),
    };
    const result = publicSnapshot(dependencies.repository.replaceSnapshot(persisted));
    const event = intelligenceSnapshotEventSchema.parse({
      repositoryId,
      snapshotId: result.id,
      completedAt: result.completedAt,
    });
    listeners.forEach((listener) => listener(event));
    return result;
  };

  const service: IntelligenceService = {
    getSnapshot(repositoryId) {
      const snapshot = dependencies.repository.getLatestSnapshot(repositoryId);
      return snapshot ? publicSnapshot(snapshot) : null;
    },

    refresh(repositoryId) {
      const current = inFlight.get(repositoryId);
      if (current) return current;
      const promise = analyze(repositoryId).finally(() => {
        inFlight.delete(repositoryId);
      });
      inFlight.set(repositoryId, promise);
      return promise;
    },

    getOverlap(overlapId) {
      return publicOverlap(dependencies.repository.getOverlap(overlapId));
    },

    compareDiffs(overlapId, targetId) {
      return publicComparison(
        dependencies.repository.compareDiffs(overlapId, targetId),
      );
    },

    scheduleRefreshForRun(runId) {
      const session = dependencies.listSessions().find(({ id }) => id === runId);
      if (!session) return;
      const current = timers.get(session.repositoryId);
      if (current) clearTimer(current);
      timers.set(session.repositoryId, setTimer(() => {
        timers.delete(session.repositoryId);
        void service.refresh(session.repositoryId).catch((error) => {
          console.error('Failed to refresh intelligence.', {
            repositoryId: session.repositoryId,
            error,
          });
        });
      }, 750));
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return service;
};
