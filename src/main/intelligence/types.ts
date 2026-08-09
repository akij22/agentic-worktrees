export type IntelligenceRisk = 'low' | 'medium' | 'high';
export type OverlapTargetType = 'folder' | 'module' | 'file' | 'symbol';
export type FileChangeType = 'added' | 'modified' | 'deleted' | 'renamed';

export interface ChangedRange {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

export interface ChangedSymbol {
  kind: string;
  name: string;
  qualifiedName: string;
  declarationStart: number;
  declarationEnd: number;
  changedStart: number;
  changedEnd: number;
}

export interface CollectedFileChange {
  path: string;
  previousPath: string | null;
  changeType: FileChangeType;
  folderPath: string;
  modulePath: string;
  additions: number;
  deletions: number;
  patch: string | null;
  ranges: ChangedRange[];
  binary: boolean;
  fingerprint: string;
  afterContent: string | null;
  symbols: ChangedSymbol[];
}

export interface CollectedWorktreeChanges {
  worktreeId: string;
  repositoryId: string;
  mergeBase: string;
  headSha: string;
  files: CollectedFileChange[];
  warnings: string[];
}

export interface OverlapTarget {
  type: OverlapTargetType;
  path: string;
  symbol: string | null;
  leftFilePath: string | null;
  rightFilePath: string | null;
  reasonCode: string;
  risk: IntelligenceRisk;
}

export interface ClassifiedOverlap {
  leftWorktreeId: string;
  rightWorktreeId: string;
  risk: IntelligenceRisk;
  category: OverlapTargetType;
  reasonCode: string;
  summary: string;
  actionable: boolean;
  targets: OverlapTarget[];
}

export interface PersistedIntelligenceWorktree {
  id: string;
  worktreeId: string;
  runId: string | null;
  task: string;
  branch: string;
  baseBranch: string | null;
  agentKind: 'codex' | 'opencode' | null;
  agentName: string | null;
  status: string;
  additions: number;
  deletions: number;
  independent: boolean;
  warning: string | null;
  updatedAt: number;
  files: CollectedFileChange[];
}

export interface PersistedIntelligenceSnapshot {
  id: string;
  repositoryId: string;
  startedAt: number;
  completedAt: number;
  warnings: string[];
  worktrees: PersistedIntelligenceWorktree[];
  overlaps: Array<ClassifiedOverlap & { id: string }>;
}

export interface PersistedOverlapDetails {
  overlap: ClassifiedOverlap & { id: string };
  left: PersistedIntelligenceWorktree;
  right: PersistedIntelligenceWorktree;
}

export interface PersistedDiffComparisonSide {
  worktreeId: string;
  runId: string | null;
  files: CollectedFileChange[];
}

export interface PersistedDiffComparison {
  overlapId: string;
  left: PersistedDiffComparisonSide;
  right: PersistedDiffComparisonSide;
}
