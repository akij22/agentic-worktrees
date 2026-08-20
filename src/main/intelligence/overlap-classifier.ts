import type {
  ChangedRange,
  ClassifiedOverlap,
  CollectedFileChange,
  CollectedWorktreeChanges,
  IntelligenceRisk,
  OverlapTarget,
  OverlapTargetType,
} from './types';

export interface WorktreeOverlapResult {
  overlaps: ClassifiedOverlap[];
  independentWorktreeIds: string[];
}

const RISK_RANK: Record<IntelligenceRisk, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const TARGET_RANK: Record<OverlapTargetType, number> = {
  symbol: 0,
  file: 1,
  module: 2,
  folder: 3,
};

const pathsFor = (file: CollectedFileChange): Set<string> =>
  new Set([file.path, ...(file.previousPath ? [file.previousPath] : [])]);

const sharedFilePath = (
  left: CollectedFileChange,
  right: CollectedFileChange,
): string | null => {
  const rightPaths = pathsFor(right);
  return [...pathsFor(left)].find((filePath) => rightPaths.has(filePath)) ?? null;
};

const rangesOverlap = (left: ChangedRange, right: ChangedRange): boolean => {
  if (left.oldLines === 0 || right.oldLines === 0) return false;
  const leftEnd = left.oldStart + left.oldLines - 1;
  const rightEnd = right.oldStart + right.oldLines - 1;
  return left.oldStart <= rightEnd && right.oldStart <= leftEnd;
};

const commonFolder = (left: string, right: string): string | null => {
  const leftSegments = left.split('/').filter(Boolean);
  const rightSegments = right.split('/').filter(Boolean);
  const common: string[] = [];
  for (let index = 0; index < Math.min(leftSegments.length, rightSegments.length); index += 1) {
    if (leftSegments[index] !== rightSegments[index]) break;
    common.push(leftSegments[index]);
  }
  return common.length >= 2 ? common.join('/') : null;
};

const target = (value: OverlapTarget): OverlapTarget => value;

const sameSymbolTarget = (
  left: CollectedFileChange,
  right: CollectedFileChange,
  sharedPath: string,
): OverlapTarget | null => {
  const rightSymbols = new Set(right.symbols.map(({ qualifiedName }) => qualifiedName));
  const qualifiedName = left.symbols
    .map(({ qualifiedName: name }) => name)
    .find((name) => rightSymbols.has(name));
  return qualifiedName
    ? target({
        type: 'symbol',
        path: sharedPath,
        reasonCode: 'same-symbol',
        risk: 'high',
        leftFilePath: left.path,
        rightFilePath: right.path,
        symbol: qualifiedName,
      })
    : null;
};

const overlappingRangeTarget = (
  left: CollectedFileChange,
  right: CollectedFileChange,
  sharedPath: string,
): OverlapTarget | null =>
  left.ranges.some((leftRange) =>
    right.ranges.some((rightRange) => rangesOverlap(leftRange, rightRange)))
    ? target({
        type: 'file',
        path: sharedPath,
        reasonCode: 'overlapping-original-range',
        risk: 'high',
        leftFilePath: left.path,
        rightFilePath: right.path,
        symbol: null,
      })
    : null;

const compareFilePair = (
  left: CollectedFileChange,
  right: CollectedFileChange,
): OverlapTarget | null => {
  const sharedPath = sharedFilePath(left, right);
  if (sharedPath) {
    return sameSymbolTarget(left, right, sharedPath) ??
      overlappingRangeTarget(left, right, sharedPath) ??
      target({
        type: 'file',
        path: sharedPath,
        reasonCode: 'same-file',
        risk: 'medium',
        leftFilePath: left.path,
        rightFilePath: right.path,
        symbol: null,
      });
  }
  if (left.modulePath && left.modulePath === right.modulePath) {
    return target({
      type: 'module',
      path: left.modulePath,
      reasonCode: 'same-module',
      risk: 'medium',
      leftFilePath: left.path,
      rightFilePath: right.path,
      symbol: null,
    });
  }
  const folder = commonFolder(left.modulePath, right.modulePath);
  return folder
    ? target({
        type: 'folder',
        path: folder,
        reasonCode: 'shared-folder',
        risk: 'low',
        leftFilePath: left.path,
        rightFilePath: right.path,
        symbol: null,
      })
    : null;
};

const bestTarget = (targets: OverlapTarget[]): OverlapTarget | null =>
  [...targets].sort((left, right) =>
    RISK_RANK[left.risk] - RISK_RANK[right.risk] ||
    TARGET_RANK[left.type] - TARGET_RANK[right.type] ||
    left.path.localeCompare(right.path))[0] ?? null;

const overlapSummary = (item: OverlapTarget): string => {
  if (item.reasonCode === 'same-symbol') {
    return `Both agents modified ${item.symbol ?? item.path}`;
  }
  if (item.reasonCode === 'overlapping-original-range') {
    return `Both agents changed overlapping lines in ${item.path}`;
  }
  if (item.reasonCode === 'same-file') return `Both agents modified ${item.path}`;
  if (item.reasonCode === 'crowded-module') {
    return `Three or more agents modify ${item.path}`;
  }
  if (item.reasonCode === 'same-module') return `Agents share module ${item.path}`;
  return `Agents share folder ${item.path}`;
};

const countModuleWorktrees = (
  worktrees: CollectedWorktreeChanges[],
): Map<string, number> => {
  const memberships = new Map<string, Set<string>>();
  for (const worktree of worktrees) {
    for (const modulePath of new Set(worktree.files.map((file) => file.modulePath))) {
      if (!modulePath) continue;
      const members = memberships.get(modulePath) ?? new Set<string>();
      members.add(worktree.worktreeId);
      memberships.set(modulePath, members);
    }
  }
  return new Map([...memberships].map(([modulePath, members]) => [modulePath, members.size]));
};

const compareWorktreePair = (
  left: CollectedWorktreeChanges,
  right: CollectedWorktreeChanges,
  moduleCounts: Map<string, number>,
): ClassifiedOverlap | null => {
  const targets = left.files.flatMap((leftFile) =>
    right.files.flatMap((rightFile) => {
      const match = compareFilePair(leftFile, rightFile);
      return match ? [match] : [];
    }));
  let best = bestTarget(targets);
  if (!best) return null;
  if (best.type === 'module' && (moduleCounts.get(best.path) ?? 0) >= 3) {
    best = { ...best, reasonCode: 'crowded-module' };
  }
  const actionable = best.risk === 'high' ||
    (best.risk === 'medium' &&
      (best.type === 'file' || best.reasonCode === 'crowded-module'));
  return {
    leftWorktreeId: left.worktreeId,
    rightWorktreeId: right.worktreeId,
    risk: best.risk,
    category: best.type,
    reasonCode: best.reasonCode,
    summary: overlapSummary(best),
    actionable,
    targets,
  };
};

const sortOverlaps = (overlaps: ClassifiedOverlap[]): ClassifiedOverlap[] =>
  overlaps.sort((left, right) =>
    RISK_RANK[left.risk] - RISK_RANK[right.risk] ||
    TARGET_RANK[left.category] - TARGET_RANK[right.category] ||
    left.targets[0]?.path.localeCompare(right.targets[0]?.path ?? '') ||
    left.leftWorktreeId.localeCompare(right.leftWorktreeId) ||
    left.rightWorktreeId.localeCompare(right.rightWorktreeId));

export const classifyWorktreeOverlaps = (
  worktrees: CollectedWorktreeChanges[],
): WorktreeOverlapResult => {
  const overlaps: ClassifiedOverlap[] = [];
  const moduleCounts = countModuleWorktrees(worktrees);
  for (let leftIndex = 0; leftIndex < worktrees.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < worktrees.length; rightIndex += 1) {
      const overlap = compareWorktreePair(
        worktrees[leftIndex],
        worktrees[rightIndex],
        moduleCounts,
      );
      if (overlap) overlaps.push(overlap);
    }
  }
  const related = new Set(
    overlaps.flatMap(({ leftWorktreeId, rightWorktreeId }) =>
      [leftWorktreeId, rightWorktreeId]),
  );
  return {
    overlaps: sortOverlaps(overlaps),
    independentWorktreeIds: worktrees
      .map(({ worktreeId }) => worktreeId)
      .filter((worktreeId) => !related.has(worktreeId))
      .sort((left, right) => left.localeCompare(right)),
  };
};
