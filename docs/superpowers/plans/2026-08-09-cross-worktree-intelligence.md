# Cross-Worktree Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, deterministic Mission Control that analyzes complete Git task deltas across coding-agent worktrees, persists normalized overlap intelligence, and exposes focused conflict inspection in the Electron renderer.

**Architecture:** A Main Process intelligence service composes a Git collector, TypeScript symbol analyzer, deterministic overlap classifier, and SQLite repository. Shared Zod DTOs define the only renderer boundary; the renderer loads persisted snapshots, requests refreshes, and renders a four-node overlap map with actionable Attention and focused diff inspection.

**Tech Stack:** Electron 43, React 19, TypeScript 5, TypeScript compiler API, simple-git, better-sqlite3, Drizzle ORM/Kit, Zod 4, React Router 7, Tailwind CSS 4, Lucide React, Vitest, Testing Library.

## Global Constraints

- Keep Git, filesystem, AST analysis, classification, persistence, and orchestration in the Electron Main Process.
- Communicate with the renderer only through validated typed IPC contracts.
- Analyze complete worktree deltas from merge-base through committed, staged, unstaged, and untracked changes.
- Use deterministic Git/path/AST rules; do not use AI-generated conflict predictions.
- Support symbol extraction for TS, TSX, JS, and JSX; other languages receive file/module analysis.
- Do not fabricate execution progress or completion percentages.
- Do not add permanent filesystem watchers.
- Do not perform merge, rebase, checkout, reset, or destructive filesystem operations.
- Preserve the last successful snapshot when refresh fails.
- Use `npm` for project commands.
- Regenerate Drizzle artifacts after schema changes; do not hand-edit generated migration files.
- Preserve strict TypeScript settings and avoid `any`.
- Reuse existing renderer primitives and semantic theme tokens.

## File Structure

### Shared contracts and persistence

- Modify `src/shared/db/schema.ts` — normalized intelligence tables and inferred row types.
- Modify `src/main/database/bootstrap.ts` — production bootstrap DDL for new tables.
- Modify `src/main/database/index.test.ts` — bootstrap/upgrade coverage.
- Generate `src/main/database/migrations/0004_*.sql` and migration metadata — Drizzle-generated schema migration.
- Modify `src/shared/ipc/schemas.ts` — intelligence requests, snapshot summaries, overlap details, diff comparison, and event schemas.
- Modify `src/shared/ipc/api.ts` — typed `intelligence` preload namespace.
- Modify `src/shared/ipc/channels.ts` — intelligence invoke/event channels.

### Main Process intelligence

- Create `src/main/intelligence/types.ts` — internal normalized analysis types and dependency interfaces.
- Create `src/main/intelligence/path-model.ts` — path normalization, ignore rules, and module derivation.
- Create `src/main/intelligence/path-model.test.ts` — deterministic path tests.
- Create `src/main/intelligence/git-change-collector.ts` — merge-base-to-working-tree collector.
- Create `src/main/intelligence/git-change-collector.test.ts` — temporary-repository integration tests.
- Create `src/main/intelligence/symbol-analyzer.ts` — TS/JS declaration extraction and range mapping.
- Create `src/main/intelligence/symbol-analyzer.test.ts` — parser unit tests.
- Create `src/main/intelligence/overlap-classifier.ts` — pairwise risk and Attention rules.
- Create `src/main/intelligence/overlap-classifier.test.ts` — rule and ordering tests.
- Create `src/main/intelligence/intelligence-repository.ts` — transactional normalized snapshot persistence and detail reads.
- Create `src/main/intelligence/intelligence-repository.test.ts` — in-memory SQLite repository tests.
- Create `src/main/intelligence/intelligence-service.ts` — refresh orchestration, coalescing, eligibility, partial failures, and DTO assembly.
- Create `src/main/intelligence/intelligence-service.test.ts` — orchestration tests with injected dependencies.
- Modify `src/main/ipc/index.ts` — thin validated intelligence handlers and snapshot event forwarding.
- Modify `src/main/ipc/github-auth-handlers.test.ts` — handler delegation, validation, and event coverage.
- Modify `src/preload.ts` — parsed invoke responses and event subscription.
- Modify `src/preload-auth.test.ts` — preload forwarding/parsing/cleanup coverage.

### Renderer Mission Control

- Modify `src/renderer/App.tsx` — `/intelligence` route.
- Modify `src/renderer/components/AppShell.tsx` — dedicated Intelligence nav item.
- Modify `src/renderer/components/app-shell-layout.ts` — classify Intelligence as a full-height workspace route.
- Modify `src/renderer/components/app-shell-layout.test.ts` — route classification coverage.
- Create `src/renderer/pages/Intelligence.tsx` — page state, repository selection, loading/refresh/error behavior.
- Create `src/renderer/features/intelligence/hooks/use-intelligence.ts` — IPC loading and event subscription.
- Create `src/renderer/features/intelligence/hooks/use-intelligence.test.tsx` — persisted-first refresh behavior.
- Create `src/renderer/features/intelligence/components/IntelligenceSummary.tsx` — summary cards.
- Create `src/renderer/features/intelligence/components/WorktreeOverlapMap.tsx` — four-node paginated map and relationships.
- Create `src/renderer/features/intelligence/components/IntelligenceWorktreeNode.tsx` — operational worktree card.
- Create `src/renderer/features/intelligence/components/AttentionPanel.tsx` — actionable overlap list only.
- Create `src/renderer/features/intelligence/components/OverlapDetails.tsx` — focused file/module/symbol inspection.
- Create `src/renderer/features/intelligence/components/DiffComparison.tsx` — persisted two-worktree patch comparison.
- Create `src/renderer/features/intelligence/components/intelligence-components.test.tsx` — map, Attention, details, comparison, and navigation tests.

---

### Task 1: Shared internal types and deterministic path model

**Files:**
- Create: `src/main/intelligence/types.ts`
- Create: `src/main/intelligence/path-model.ts`
- Test: `src/main/intelligence/path-model.test.ts`

**Interfaces:**
- Produces: `ChangedRange`, `CollectedFileChange`, `CollectedWorktreeChanges`, `ChangedSymbol`, `ClassifiedOverlap`, `OverlapTarget`, `PersistedIntelligenceSnapshot`, `PersistedOverlapDetails`, and `PersistedDiffComparison`.
- Produces: `normalizeGitPath(path: string): string`.
- Produces: `shouldIgnoreIntelligencePath(path: string): boolean`.
- Produces: `deriveModulePath(path: string): string`.
- Produces: `isTypeScriptFamily(path: string): boolean`.

- [ ] **Step 1: Write failing path-model tests**

Create tests covering separators, traversal rejection, ignored paths, and module boundaries:

```ts
import { describe, expect, it } from 'vitest';
import {
  deriveModulePath,
  isTypeScriptFamily,
  normalizeGitPath,
  shouldIgnoreIntelligencePath,
} from './path-model';

describe('intelligence path model', () => {
  it('normalizes Git paths and rejects traversal', () => {
    expect(normalizeGitPath('src\\main\\index.ts')).toBe('src/main/index.ts');
    expect(() => normalizeGitPath('../outside.ts')).toThrow('outside');
    expect(() => normalizeGitPath('/absolute.ts')).toThrow('relative');
  });

  it.each(['.git/index', 'node_modules/a.js', 'dist/app.js', 'coverage/a.ts'])(
    'ignores generated or internal path %s',
    (path) => expect(shouldIgnoreIntelligencePath(path)).toBe(true),
  );

  it('derives stable feature and process module paths', () => {
    expect(deriveModulePath('src/main/coding-agents/diff-stats.ts')).toBe(
      'src/main/coding-agents',
    );
    expect(
      deriveModulePath('src/renderer/features/dashboard/components/Card.tsx'),
    ).toBe('src/renderer/features/dashboard');
    expect(deriveModulePath('scripts/release.ts')).toBe('scripts');
  });

  it.each(['a.ts', 'a.tsx', 'a.js', 'a.jsx'])('recognizes %s', (path) => {
    expect(isTypeScriptFamily(path)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run src/main/intelligence/path-model.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Define focused internal types**

Create `types.ts` with these contracts:

```ts
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

export interface PersistedIntelligenceSnapshot {
  id: string;
  repositoryId: string;
  startedAt: number;
  completedAt: number;
  warnings: string[];
  worktrees: Array<{
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
  }>;
  overlaps: Array<ClassifiedOverlap & { id: string }>;
}

export interface PersistedOverlapDetails {
  overlap: ClassifiedOverlap & { id: string };
  left: PersistedIntelligenceSnapshot['worktrees'][number];
  right: PersistedIntelligenceSnapshot['worktrees'][number];
}

export interface PersistedDiffComparison {
  overlapId: string;
  left: {
    worktreeId: string;
    runId: string | null;
    files: CollectedFileChange[];
  };
  right: {
    worktreeId: string;
    runId: string | null;
    files: CollectedFileChange[];
  };
}
```

- [ ] **Step 4: Implement the path model**

Normalize with `path.posix`, reject absolute/traversing/NUL-containing paths, ignore `.git`, dependency, build, coverage, and cache roots, and derive modules with these exact rules:

1. `src/(main|renderer|shared)/features/<name>` → include through `<name>`.
2. `src/(main|renderer|shared)/<name>` → include through `<name>`.
3. `packages/<name>` or `apps/<name>` → include through `<name>`.
4. Otherwise use the file's immediate parent directory.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
npx vitest run src/main/intelligence/path-model.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the path model**

```bash
git add src/main/intelligence/types.ts \
  src/main/intelligence/path-model.ts \
  src/main/intelligence/path-model.test.ts
git commit -m "feat(intelligence): add normalized path model" \
  -m "- Define focused internal change and overlap contracts.\n- Normalize repository-relative paths and reject traversal.\n- Derive deterministic module boundaries and ignore generated content."
```

---

### Task 2: Complete Git task-delta collector

**Files:**
- Create: `src/main/intelligence/git-change-collector.ts`
- Test: `src/main/intelligence/git-change-collector.test.ts`

**Interfaces:**
- Consumes: path-model functions and `CollectedWorktreeChanges`.
- Produces: `createGitChangeCollector(dependencies?): GitChangeCollector`.
- Produces: `GitChangeCollector.collect(input: { worktreeId; repositoryId; worktreePath; branchName; baseBranchName }): Promise<CollectedWorktreeChanges>`.

- [ ] **Step 1: Write temporary-repository failing tests**

Use `mkdtemp`, `simpleGit`, and real branches to verify:

```ts
it('collects committed, staged, unstaged, and untracked task changes', async () => {
  // Initialize main with src/a.ts and src/b.ts, create feat/test, commit a.ts,
  // stage b.ts, modify a.ts again, and add src/new.ts without staging.
  const result = await collector.collect(input);
  expect(result.files.map(({ path }) => path).sort()).toEqual([
    'src/a.ts',
    'src/b.ts',
    'src/new.ts',
  ]);
  expect(result.files.find(({ path }) => path === 'src/new.ts')).toMatchObject({
    changeType: 'added',
    deletions: 0,
    binary: false,
  });
  expect(result.mergeBase).toMatch(/^[0-9a-f]{40}$/);
});

it('retains rename source and destination paths', async () => {
  // Rename src/old.ts to src/new.ts and change its body.
  expect(result.files[0]).toMatchObject({
    changeType: 'renamed',
    previousPath: 'src/old.ts',
    path: 'src/new.ts',
  });
});

it('returns file metadata but no patch for binary changes', async () => {
  expect(binaryChange).toMatchObject({ binary: true, patch: null });
});
```

Always remove temporary directories in `afterEach`.

- [ ] **Step 2: Run the collector tests and verify RED**

```bash
npx vitest run src/main/intelligence/git-change-collector.test.ts
```

Expected: FAIL because the collector does not exist.

- [ ] **Step 3: Implement Git command and parser helpers**

Use `simpleGit(worktreePath).raw(args)` with argument arrays only. Compute:

```ts
const mergeBase = (
  await git.raw(['merge-base', 'HEAD', input.baseBranchName])
).trim();
const headSha = (await git.raw(['rev-parse', 'HEAD'])).trim();
const nameStatus = await git.raw([
  'diff', '--name-status', '-z', '--find-renames', mergeBase, '--',
]);
const untracked = await git.raw([
  'ls-files', '--others', '--exclude-standard', '-z', '--',
]);
```

For each tracked destination path, request `--numstat` and `--unified=0` against `mergeBase`. Parse hunk headers with:

```ts
/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
```

Read untracked files through validated absolute paths, synthesize an added-file patch, and cap text parsing at 1 MiB. Hash normalized path, patch/content, and stats with SHA-256.

- [ ] **Step 4: Handle partial file failures explicitly**

Catch per-file read/parse errors, append a warning containing the normalized path and original error message, and continue. Missing base branch or merge-base failure rejects the worktree collection so the service can mark a worktree-scoped warning.

- [ ] **Step 5: Run collector tests and verify GREEN**

```bash
npx vitest run src/main/intelligence/git-change-collector.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the collector**

```bash
git add src/main/intelligence/git-change-collector.ts \
  src/main/intelligence/git-change-collector.test.ts
git commit -m "feat(intelligence): collect complete worktree deltas" \
  -m "- Compare each worktree from merge-base through its working tree.\n- Include committed, staged, unstaged, untracked, renamed, and binary changes.\n- Persist normalized ranges, patches, stats, fingerprints, and explicit warnings."
```

---

### Task 3: TypeScript and JavaScript symbol analyzer

**Files:**
- Create: `src/main/intelligence/symbol-analyzer.ts`
- Test: `src/main/intelligence/symbol-analyzer.test.ts`

**Interfaces:**
- Consumes: `CollectedFileChange` and `ChangedRange`.
- Produces: `analyzeChangedSymbols(input: { path: string; content: string; ranges: ChangedRange[] }): ChangedSymbol[]`.

- [ ] **Step 1: Write failing symbol tests**

```ts
it('maps changed ranges to the smallest qualified declaration', () => {
  const content = `
class SessionService {
  createSession() {
    return 'created';
  }
}
`;
  expect(analyzeChangedSymbols({
    path: 'src/session.ts',
    content,
    ranges: [{ oldStart: 3, oldLines: 1, newStart: 4, newLines: 1 }],
  })).toContainEqual(expect.objectContaining({
    kind: 'method',
    name: 'createSession',
    qualifiedName: 'SessionService.createSession',
  }));
});

it('distinguishes identical method names under different classes', () => {
  expect(symbols.map(({ qualifiedName }) => qualifiedName)).toEqual([
    'First.run',
    'Second.run',
  ]);
});

it('extracts function-valued variables and type declarations', () => {
  expect(names).toEqual(expect.arrayContaining(['loadData', 'SessionState']));
});

it('returns an empty result for unsupported or malformed files', () => {
  expect(analyzeChangedSymbols({ path: 'README.md', content: '# x', ranges })).toEqual([]);
});
```

- [ ] **Step 2: Run symbol tests and verify RED**

```bash
npx vitest run src/main/intelligence/symbol-analyzer.test.ts
```

Expected: FAIL because the analyzer does not exist.

- [ ] **Step 3: Implement compiler-API traversal**

Use `typescript.createSourceFile` with script kind selected from the extension. Traverse named declarations and build parent-qualified names. Convert declaration positions with `sourceFile.getLineAndCharacterOfPosition`. Intersect declaration lines against each range's new-side span and return the smallest enclosing declaration per changed span.

Recognize:

```ts
FunctionDeclaration
MethodDeclaration
ClassDeclaration
InterfaceDeclaration
TypeAliasDeclaration
EnumDeclaration
VariableDeclaration with ArrowFunction or FunctionExpression initializer
PropertyDeclaration with executable initializer
```

Deduplicate by `kind + qualifiedName + declarationStart + declarationEnd` and sort by declaration start, then qualified name.

- [ ] **Step 4: Run symbol tests and verify GREEN**

```bash
npx vitest run src/main/intelligence/symbol-analyzer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the analyzer**

```bash
git add src/main/intelligence/symbol-analyzer.ts \
  src/main/intelligence/symbol-analyzer.test.ts
git commit -m "feat(intelligence): analyze changed source symbols" \
  -m "- Extract qualified TypeScript and JavaScript declarations locally.\n- Map changed diff ranges to their smallest enclosing symbols.\n- Fall back safely for unsupported or malformed source files."
```

---

### Task 4: Deterministic overlap classification

**Files:**
- Create: `src/main/intelligence/overlap-classifier.ts`
- Test: `src/main/intelligence/overlap-classifier.test.ts`

**Interfaces:**
- Consumes: `CollectedWorktreeChanges` with populated symbols.
- Produces: `classifyWorktreeOverlaps(worktrees: CollectedWorktreeChanges[]): { overlaps: ClassifiedOverlap[]; independentWorktreeIds: string[] }`.

- [ ] **Step 1: Write a risk-rule matrix as failing tests**

Cover exact expected outcomes:

```ts
it.each([
  ['same qualified symbol', sameSymbolPair, 'high', true],
  ['overlapping original ranges', overlappingRangePair, 'high', true],
  ['same file different methods', sameFilePair, 'medium', true],
  ['same module different files', sameModulePair, 'medium', false],
  ['shared parent only', sharedFolderPair, 'low', false],
])('%s', (_name, worktrees, risk, actionable) => {
  const result = classifyWorktreeOverlaps(worktrees);
  expect(result.overlaps[0]).toMatchObject({ risk, actionable });
});

it('marks worktrees with no relationships as independent', () => {
  expect(classifyWorktreeOverlaps([left, unrelated]).independentWorktreeIds)
    .toEqual(['left', 'unrelated']);
});

it('makes a module overlap actionable when three worktrees touch it', () => {
  expect(result.overlaps.every(({ actionable }) => actionable)).toBe(true);
});
```

- [ ] **Step 2: Run classifier tests and verify RED**

```bash
npx vitest run src/main/intelligence/overlap-classifier.test.ts
```

Expected: FAIL because the classifier does not exist.

- [ ] **Step 3: Implement target generation and rule precedence**

Compare each ordered pair once. Build target keys as:

```ts
const symbolKey = `${file.path}#${symbol.qualifiedName}`;
const fileKey = file.path;
const moduleKey = file.modulePath;
```

Apply precedence `symbol/original-range > file > module > folder`. Keep all matching targets, but derive the relationship's risk/category/reason from its highest-priority target. A rename compares both source and destination paths.

Changed original ranges overlap when both old spans are non-empty and:

```ts
left.oldStart <= right.oldStart + right.oldLines - 1 &&
right.oldStart <= left.oldStart + left.oldLines - 1
```

- [ ] **Step 4: Implement actionable and stable ordering rules**

High is always actionable. Medium is actionable for same-file overlap or when at least three worktrees touch the module. Sort by severity, target rank (`symbol`, `file`, `module`, `folder`), path, and worktree IDs.

- [ ] **Step 5: Run classifier tests and verify GREEN**

```bash
npx vitest run src/main/intelligence/overlap-classifier.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the classifier**

```bash
git add src/main/intelligence/overlap-classifier.ts \
  src/main/intelligence/overlap-classifier.test.ts
git commit -m "feat(intelligence): classify deterministic overlaps" \
  -m "- Detect symbol, source-range, file, module, and folder relationships.\n- Apply explicit low, medium, and high risk precedence.\n- Mark independent worktrees and filter actionable Attention items."
```

---

### Task 5: Normalized SQLite schema and repository

**Files:**
- Modify: `src/shared/db/schema.ts`
- Modify: `src/main/database/bootstrap.ts`
- Modify: `src/main/database/index.test.ts`
- Generate: `src/main/database/migrations/0004_*.sql`
- Generate: `src/main/database/migrations/meta/0004_snapshot.json`
- Modify: `src/main/database/migrations/meta/_journal.json`
- Create: `src/main/intelligence/intelligence-repository.ts`
- Test: `src/main/intelligence/intelligence-repository.test.ts`

**Interfaces:**
- Produces tables described in the approved spec.
- Produces `createIntelligenceRepository(database): IntelligenceRepository`.
- Produces `replaceSnapshot(input): PersistedIntelligenceSnapshot`, `getLatestSnapshot(repositoryId): PersistedIntelligenceSnapshot | null`, `getOverlap(overlapId): PersistedOverlapDetails`, and `compareDiffs(overlapId, targetId?): PersistedDiffComparison`.

- [ ] **Step 1: Extend the database test with failing bootstrap assertions**

Execute `bootstrapSchemaSql` against in-memory SQLite and assert:

```ts
const tables = sqlite.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'intelligence_%'",
).all() as Array<{ name: string }>;
expect(tables.map(({ name }) => name).sort()).toEqual([
  'intelligence_changed_files',
  'intelligence_changed_symbols',
  'intelligence_overlaps',
  'intelligence_overlap_targets',
  'intelligence_snapshots',
  'intelligence_worktrees',
]);
```

- [ ] **Step 2: Write failing repository transaction tests**

Use `BetterSqlite3(':memory:')`, execute the complete bootstrap, wrap it with Drizzle, and verify:

```ts
it('replaces one repository snapshot transactionally', () => {
  repository.replaceSnapshot(first);
  repository.replaceSnapshot(second);
  expect(repository.getLatestSnapshot('repo-1')?.id).toBe(second.id);
  expect(countRows('intelligence_snapshots')).toBe(1);
});

it('rolls back replacement when a child insert fails', () => {
  repository.replaceSnapshot(first);
  expect(() => repository.replaceSnapshot(invalidSecond)).toThrow();
  expect(repository.getLatestSnapshot('repo-1')?.id).toBe(first.id);
});

it('loads normalized overlap targets and both persisted patches', () => {
  expect(repository.compareDiffs('overlap-1')).toMatchObject({
    left: { worktreeId: 'left' },
    right: { worktreeId: 'right' },
  });
});
```

- [ ] **Step 3: Run database/repository tests and verify RED**

```bash
npx vitest run \
  src/main/database/index.test.ts \
  src/main/intelligence/intelligence-repository.test.ts
```

Expected: FAIL because schema tables and repository do not exist.

- [ ] **Step 4: Add six Drizzle tables and indexes**

Use text IDs, timestamp-ms integers, booleans in integer mode, foreign keys with cascade from snapshots, and unique indexes for:

```text
(snapshot_id, worktree_id)
(intelligence_worktree_id, path)
(changed_file_id, qualified_name, declaration_start, declaration_end)
(snapshot_id, left_intelligence_worktree_id, right_intelligence_worktree_id)
(overlap_id, target_type, path, symbol)
```

Store ranges as validated JSON text and patches as nullable text. Export inferred row types.

- [ ] **Step 5: Mirror schema in bootstrap DDL and generate migrations**

Append `CREATE TABLE IF NOT EXISTS` and index statements to `bootstrapStatements`, then run:

```bash
npm run db:generate
```

Expected: one new generated migration and matching metadata. Do not edit those generated files manually.

- [ ] **Step 6: Implement transactional repository methods**

Accept an injected `BetterSQLite3Database<typeof schema>`. In `replaceSnapshot`, delete the prior snapshot for the same repository and insert the candidate hierarchy inside `database.transaction`. Parse all JSON columns on read and return the internal persisted models defined in `types.ts`; Task 7 validates the assembled public DTO before it crosses IPC.

- [ ] **Step 7: Run database/repository tests and verify GREEN**

```bash
npx vitest run \
  src/main/database/index.test.ts \
  src/main/intelligence/intelligence-repository.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit schema and persistence**

```bash
git add src/shared/db/schema.ts src/main/database/bootstrap.ts \
  src/main/database/index.test.ts src/main/database/migrations \
  src/main/intelligence/intelligence-repository.ts \
  src/main/intelligence/intelligence-repository.test.ts
git commit -m "feat(intelligence): persist normalized snapshots" \
  -m "- Add snapshot, worktree, file, symbol, overlap, and target tables.\n- Generate Drizzle migration artifacts and production bootstrap DDL.\n- Replace repository snapshots transactionally and load focused overlap diffs."
```

---

### Task 6: Shared typed IPC intelligence contracts

**Files:**
- Modify: `src/shared/ipc/schemas.ts`
- Modify: `src/shared/ipc/api.ts`
- Modify: `src/shared/ipc/channels.ts`
- Modify: `src/shared/ipc/schemas.test.ts`

**Interfaces:**
- Produces: `IntelligenceSnapshotDto`, `IntelligenceOverlapDetailsDto`, `IntelligenceDiffComparisonDto`, and `IntelligenceSnapshotEventDto`.
- Produces request schemas for repository ID, overlap ID, and optional target ID.
- Produces `Api['intelligence']`.

- [ ] **Step 1: Write failing schema sanitization and validation tests**

Add fixtures that assert accepted values and rejected path leakage:

```ts
expect(intelligenceSnapshotSchema.parse(snapshot)).toMatchObject({
  repositoryId: 'repo-1',
  worktrees: [{ worktreeId: 'wt-1', agentKind: 'codex' }],
});
expect(() => intelligenceRepositoryRequestSchema.parse({ repositoryId: '' }))
  .toThrow();
expect(intelligenceSnapshotSchema.parse({ ...snapshot, secret: '/tmp/private' }))
  .not.toHaveProperty('secret');
```

- [ ] **Step 2: Run shared schema tests and verify RED**

```bash
npx vitest run src/shared/ipc/schemas.test.ts
```

Expected: FAIL because intelligence schemas do not exist.

- [ ] **Step 3: Define DTO schemas**

The initial snapshot DTO contains summaries only:

```ts
export const intelligenceRiskSchema = z.enum(['low', 'medium', 'high']);
export const intelligenceWorktreeSchema = z.object({
  worktreeId: z.string().min(1),
  runId: z.string().min(1).nullable(),
  task: z.string(),
  branch: z.string(),
  baseBranch: z.string().nullable(),
  agentKind: codingAgentKindSchema.nullable(),
  agentName: z.string().nullable(),
  status: z.string(),
  changedFileCount: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  files: z.array(z.object({
    path: z.string(),
    modulePath: z.string(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    symbols: z.array(z.string()),
  })),
  independent: z.boolean(),
  warning: z.string().nullable(),
  updatedAt: z.number().int().nonnegative(),
});
```

Add relationship summaries, actionable counts, stale/refresh error fields, details with normalized targets, and diff comparison with left/right patch records. Do not expose absolute worktree paths or raw database rows.

- [ ] **Step 4: Add channels and API namespace**

Add invoke channels for list repositories, get snapshot, refresh, get overlap, compare diffs, plus one snapshot-changed event. Add:

```ts
intelligence: {
  listRepositories: () => Promise<Repository[]>;
  getSnapshot: (request: { repositoryId: string }) =>
    Promise<IntelligenceSnapshotDto | null>;
  refresh: (request: { repositoryId: string }) =>
    Promise<IntelligenceSnapshotDto>;
  getOverlap: (request: { overlapId: string }) =>
    Promise<IntelligenceOverlapDetailsDto>;
  compareDiffs: (request: { overlapId: string; targetId?: string }) =>
    Promise<IntelligenceDiffComparisonDto>;
  onSnapshotChanged: (
    listener: (event: IntelligenceSnapshotEventDto) => void,
  ) => () => void;
};
```

- [ ] **Step 5: Run shared schema tests and typecheck**

```bash
npx vitest run src/shared/ipc/schemas.test.ts
npm run typecheck
```

Expected: tests PASS; typecheck may remain RED until repository imports are aligned in this task, then must pass before commit.

- [ ] **Step 6: Commit the contracts**

```bash
git add src/shared/ipc/schemas.ts src/shared/ipc/schemas.test.ts \
  src/shared/ipc/api.ts src/shared/ipc/channels.ts
git commit -m "feat(intelligence): define typed IPC contracts" \
  -m "- Add validated snapshot, overlap, comparison, and event DTOs.\n- Expose a focused intelligence API without filesystem or database details.\n- Register dedicated invoke and snapshot-change channels."
```

---

### Task 7: Intelligence orchestration service

**Files:**
- Create: `src/main/intelligence/intelligence-service.ts`
- Test: `src/main/intelligence/intelligence-service.test.ts`

**Interfaces:**
- Consumes: collector, analyzer, classifier, repository, `listWorktreesForRepository`, and `listAgentSessions` through injected dependencies.
- Produces: `createIntelligenceService(dependencies): IntelligenceService`.
- Produces methods matching the Main Process side of the shared API plus `scheduleRefreshForRun(runId: string): void` and `subscribe(listener): () => void`.

- [ ] **Step 1: Write failing orchestration tests**

Cover eligibility, symbol enrichment, partial failures, and coalescing:

```ts
it('includes changed worktrees with sessions and active unchanged sessions', async () => {
  const snapshot = await service.refresh('repo-1');
  expect(snapshot.worktrees.map(({ worktreeId }) => worktreeId)).toEqual([
    'active-empty',
    'changed-idle',
  ]);
});

it('coalesces concurrent refreshes for one repository', async () => {
  const [left, right] = await Promise.all([
    service.refresh('repo-1'),
    service.refresh('repo-1'),
  ]);
  expect(collector.collect).toHaveBeenCalledTimes(2); // once per eligible worktree
  expect(left.id).toBe(right.id);
});

it('persists valid worktrees when one collector fails', async () => {
  expect(await service.refresh('repo-1')).toMatchObject({
    stale: false,
    warnings: [expect.stringContaining('broken-worktree')],
  });
});

it('retains the previous snapshot when repository analysis cannot complete', async () => {
  await expect(service.refresh('repo-1')).rejects.toThrow();
  expect(repository.getLatestSnapshot('repo-1')).toEqual(previous);
});
```

- [ ] **Step 2: Run service tests and verify RED**

```bash
npx vitest run src/main/intelligence/intelligence-service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement eligibility and latest-session selection**

Select the latest session by `updatedAt`, map agent status from that session, collect each worktree, and include it when it has files or status is `busy`, `creating`, or `waiting_permission`. Populate symbols only for non-binary TS/JS files with `afterContent`.

- [ ] **Step 4: Implement refresh coalescing and snapshot replacement**

Use `Map<string, Promise<IntelligenceSnapshotDto>>` for in-flight refreshes. Generate stable IDs with `nanoid`, classify enriched worktrees, persist once, assemble and validate the public DTO with `intelligenceSnapshotSchema`, notify subscribers after commit, and remove the promise in `finally`.

- [ ] **Step 5: Implement debounced event scheduling**

Resolve `runId` to a session/repository, debounce repository refresh by 750 ms, and react only to `message.updated`, `message.part.updated`, `session.idle`, `session.error`, `permission.updated`, and `session.status`. Log failed background refreshes with repository context.

- [ ] **Step 6: Run service tests and verify GREEN**

```bash
npx vitest run src/main/intelligence/intelligence-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the service**

```bash
git add src/main/intelligence/intelligence-service.ts \
  src/main/intelligence/intelligence-service.test.ts
git commit -m "feat(intelligence): orchestrate repository analysis" \
  -m "- Select eligible agent worktrees and enrich deterministic Git deltas.\n- Coalesce refreshes, tolerate worktree-scoped failures, and preserve snapshots.\n- Debounce relevant coding-agent activity into local refreshes."
```

---

### Task 8: Thin IPC handlers and preload bridge

**Files:**
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/ipc/github-auth-handlers.test.ts`
- Modify: `src/preload.ts`
- Modify: `src/preload-auth.test.ts`

**Interfaces:**
- Consumes: singleton `intelligenceService` constructed from production dependencies.
- Produces: validated invoke handlers and exact-listener cleanup for snapshot events.

- [ ] **Step 1: Add failing IPC handler tests**

Mock the intelligence service and assert:

```ts
await invoke(IPC_CHANNELS.INTELLIGENCE_REFRESH, { repositoryId: 'repo-1' });
expect(mocks.refreshIntelligence).toHaveBeenCalledWith('repo-1');
await expect(
  invoke(IPC_CHANNELS.INTELLIGENCE_REFRESH, { repositoryId: '' }),
).rejects.toThrow();
```

Subscribe a fake BrowserWindow, trigger the service listener, and assert only the validated public event is sent.

- [ ] **Step 2: Add failing preload tests**

Assert each method uses its dedicated channel and parses its response. For `onSnapshotChanged`, capture the listener, send a payload with an extra `secret` property, assert Zod strips it, then assert cleanup removes the exact function.

- [ ] **Step 3: Run IPC/preload tests and verify RED**

```bash
npx vitest run \
  src/main/ipc/github-auth-handlers.test.ts \
  src/preload-auth.test.ts
```

Expected: FAIL because intelligence handlers and bridge methods do not exist.

- [ ] **Step 4: Register thin validated handlers**

Add handlers that parse request schemas, delegate to the service, and parse response DTOs. Keep them alongside existing thin handler functions. Do not place Git or database logic in `src/main/ipc/index.ts`.

In the existing `subscribeToAgentEvents` callback, call `intelligenceService.scheduleRefreshForRun(event.runId)` when `runId` is non-null, then continue broadcasting the original coding-agent event.

- [ ] **Step 5: Implement the preload namespace**

Parse every invoke response with the matching schema. Implement event subscription using the exact listener pattern already used for GitHub status and terminal events.

- [ ] **Step 6: Run IPC/preload tests and verify GREEN**

```bash
npx vitest run \
  src/main/ipc/github-auth-handlers.test.ts \
  src/preload-auth.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit IPC integration**

```bash
git add src/main/ipc/index.ts src/main/ipc/github-auth-handlers.test.ts \
  src/preload.ts src/preload-auth.test.ts
git commit -m "feat(intelligence): expose validated desktop APIs" \
  -m "- Delegate intelligence requests through thin authenticated IPC handlers.\n- Parse preload responses and snapshot events with shared Zod schemas.\n- Schedule debounced refreshes from relevant coding-agent events."
```

---

### Task 9: Intelligence route, data hook, and page states

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/AppShell.tsx`
- Modify: `src/renderer/components/app-shell-layout.ts`
- Modify: `src/renderer/components/app-shell-layout.test.ts`
- Create: `src/renderer/pages/Intelligence.tsx`
- Create: `src/renderer/features/intelligence/hooks/use-intelligence.ts`
- Test: `src/renderer/features/intelligence/hooks/use-intelligence.test.tsx`

**Interfaces:**
- Produces: `/intelligence` route and dedicated sidebar entry.
- Produces: `useIntelligence(repositoryId)` returning `{ snapshot, state, refresh, repositories, selectedRepositoryId, selectRepository }`.

- [ ] **Step 1: Write failing route classification and hook tests**

Add:

```ts
expect(isDashboardWorkspace('/intelligence')).toBe(true);
```

The full-height workspace classification prevents the standard padded shell from constraining Mission Control.

Hook test:

```tsx
it('shows persisted data before refreshing and accepts newer events', async () => {
  window.api.intelligence.getSnapshot = vi.fn().mockResolvedValue(persisted);
  window.api.intelligence.refresh = vi.fn().mockResolvedValue(fresh);
  const { result } = renderHook(() => useIntelligence('repo-1'));
  await waitFor(() => expect(result.current.snapshot).toEqual(persisted));
  await waitFor(() => expect(result.current.snapshot).toEqual(fresh));
  act(() => pushedListener({ repositoryId: 'repo-1', snapshotId: 'new' }));
  expect(window.api.intelligence.getSnapshot).toHaveBeenCalledTimes(2);
});
```

Also test stale refresh failure preserves `snapshot` and exposes a recoverable error.

- [ ] **Step 2: Run route/hook tests and verify RED**

```bash
npx vitest run \
  src/renderer/components/app-shell-layout.test.ts \
  src/renderer/features/intelligence/hooks/use-intelligence.test.tsx
```

Expected: FAIL because route and hook do not exist.

- [ ] **Step 3: Add route and navigation**

Add a network-style inline SVG icon and **Intelligence** item between Coding Agent and Settings. Add `<Route path="/intelligence" element={<Intelligence />} />`. Extend `isDashboardWorkspace` to return true for `/` and `/intelligence` while preserving dashboard-only sidebar resize behavior.

- [ ] **Step 4: Implement persisted-first hook state**

On repository change:

1. Load the latest persisted snapshot.
2. Publish it immediately when present.
3. Start refresh without clearing the snapshot.
4. Replace on success or keep and mark stale on failure.
5. Subscribe once to snapshot events and reload only matching repositories.
6. Ignore stale async responses after unmount or repository switch.

- [ ] **Step 5: Implement the page shell and explicit states**

Match the approved concept and current app tokens. Render repository selector, freshness, Refresh, title/description, skeleton state, no-repository state, no-eligible-worktree state, stale warning, and partial worktree warnings. For a populated snapshot, render a semantic `<section aria-label="Worktree intelligence results">` containing the repository-wide worktree and overlap counts; Task 10 replaces that minimal compiled result region with the complete map and Attention components.

- [ ] **Step 6: Run focused tests and typecheck**

```bash
npx vitest run \
  src/renderer/components/app-shell-layout.test.ts \
  src/renderer/features/intelligence/hooks/use-intelligence.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit route and data state**

```bash
git add src/renderer/App.tsx src/renderer/components/AppShell.tsx \
  src/renderer/components/app-shell-layout.ts \
  src/renderer/components/app-shell-layout.test.ts \
  src/renderer/pages/Intelligence.tsx \
  src/renderer/features/intelligence/hooks/use-intelligence.ts \
  src/renderer/features/intelligence/hooks/use-intelligence.test.tsx
git commit -m "feat(intelligence): add Mission Control route" \
  -m "- Add Intelligence as a dedicated full-height sidebar destination.\n- Load persisted snapshots before background refreshes.\n- Preserve usable stale data and expose explicit loading and recovery states."
```

---

### Task 10: Mission Control map and actionable Attention panel

**Files:**
- Create: `src/renderer/features/intelligence/components/IntelligenceSummary.tsx`
- Create: `src/renderer/features/intelligence/components/WorktreeOverlapMap.tsx`
- Create: `src/renderer/features/intelligence/components/IntelligenceWorktreeNode.tsx`
- Create: `src/renderer/features/intelligence/components/AttentionPanel.tsx`
- Create: `src/renderer/features/intelligence/components/OverlapDetails.tsx`
- Create: `src/renderer/features/intelligence/components/DiffComparison.tsx`
- Create: `src/renderer/features/intelligence/components/intelligence-components.test.tsx`
- Modify: `src/renderer/pages/Intelligence.tsx`

**Interfaces:**
- Consumes: shared intelligence DTOs and `navigate('/coding-agent/:worktreeId/:runId')`.
- Produces: four-node pagination, accessible relationship map, actionable-only panel, overlap details, and comparison dialog.

- [ ] **Step 1: Write failing renderer behavior tests**

Use jsdom and Testing Library:

```tsx
it('renders at most four worktrees and paginates deterministically', () => {
  render(<WorktreeOverlapMap snapshot={fiveWorktreeSnapshot} />);
  expect(screen.getAllByTestId('intelligence-worktree-node')).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: 'Next worktrees' }));
  expect(screen.getByText('Worktree five')).toBeInTheDocument();
});

it('shows only actionable overlaps in Attention', () => {
  render(<AttentionPanel overlaps={[high, mediumPassive, low]} />);
  expect(screen.getByText(high.summary)).toBeInTheDocument();
  expect(screen.queryByText(mediumPassive.summary)).not.toBeInTheDocument();
  expect(screen.queryByText(low.summary)).not.toBeInTheDocument();
});

it('opens the related worktree chat', () => {
  fireEvent.click(screen.getByRole('button', { name: /open chat/i }));
  expect(navigate).toHaveBeenCalledWith('/coding-agent/wt-1/run-1');
});

it('loads overlap details and compares persisted patches', async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Compare diff' }));
  await screen.findByText('createSession');
  expect(window.api.intelligence.compareDiffs).toHaveBeenCalledWith({
    overlapId: 'overlap-1',
  });
});
```

Also assert risk labels exist as text, independent worktrees show “Safely independent,” and warnings do not rely on color alone.

- [ ] **Step 2: Run component tests and verify RED**

```bash
npx vitest run src/renderer/features/intelligence/components/intelligence-components.test.tsx
```

Expected: FAIL because components do not exist.

- [ ] **Step 3: Implement summary and worktree nodes**

Use compact existing card patterns: `rounded-xl border border-border bg-card/40`, uppercase 10px labels, `font-mono` paths/stats, semantic `text-chart-3` additions and `text-destructive` deletions. Nodes show task, branch, agent, status, up to three changed files/symbols, totals, and independent state. Do not render completion percentages.

- [ ] **Step 4: Implement the overlap map**

Use a CSS grid with four fixed node positions around a central engine card. Render relationship connectors in an absolute SVG with `aria-hidden="true"`; accompany it with an off-screen semantic list describing every visible connection and risk. Use solid high, dashed medium, and dotted low lines plus text labels.

Paginate sorted worktrees in groups of four. Filter visible relationship lines to pairs on the current page; keep repository-wide Attention separate.

- [ ] **Step 5: Implement Attention and focused detail**

Attention filters `actionable === true`, orders by the server-provided stable order, and exposes Review overlap / Compare diff / Inspect files. `OverlapDetails` loads only when opened and lists reason, both worktrees, targets, paths, qualified symbols, and changed ranges.

- [ ] **Step 6: Implement persisted two-column diff comparison**

Load `compareDiffs` on demand. Reuse existing diff line utilities where content is available; otherwise render persisted unified patches in synchronized scrollable panes with file selector tabs. Include Open chat for both sides when run IDs exist. Display a clear binary/no-text state.

- [ ] **Step 7: Run renderer tests and verify GREEN**

```bash
npx vitest run src/renderer/features/intelligence/components/intelligence-components.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Build the renderer and inspect the result**

```bash
npm run package
```

Expected: Electron Forge packages successfully and the renderer compiles without route or styling errors. Compare the running screen against the supplied concept at 1600×1000 and the app minimum 960×600; preserve scroll access rather than compressing unreadably.

- [ ] **Step 9: Commit Mission Control UI**

```bash
git add src/renderer/features/intelligence src/renderer/pages/Intelligence.tsx
git commit -m "feat(intelligence): render worktree Mission Control" \
  -m "- Visualize four parallel agent worktrees around deterministic overlaps.\n- Surface actionable conflicts separately and mark independent worktrees.\n- Add overlap inspection, persisted diff comparison, and direct chat navigation."
```

---

### Task 11: End-to-end verification and documentation

**Files:**
- Modify: `README.md`
- Modify only as required by diagnostics: files already changed in Tasks 1–10.

**Interfaces:**
- Documents: local intelligence behavior, TS/JS symbol scope, refresh semantics, and user actions.

- [ ] **Step 1: Add concise README usage documentation**

Document the Intelligence sidebar entry, repository selection, local deterministic analysis, risk meanings, Attention semantics, Compare diff, and Open chat. State explicitly that non-TS/JS files receive file/module analysis and that no AI inference or fabricated progress is used.

- [ ] **Step 2: Run proactive diagnostics before builds**

```text
lsp_diagnostics on:
- src/main/intelligence
- src/shared/ipc
- src/shared/db/schema.ts
- src/main/ipc/index.ts
- src/preload.ts
- src/renderer/features/intelligence
- src/renderer/pages/Intelligence.tsx
- src/renderer/App.tsx
- src/renderer/components/AppShell.tsx
```

Expected: no TypeScript errors. Fix all errors before continuing.

- [ ] **Step 3: Run focused intelligence tests**

```bash
npx vitest run \
  src/main/intelligence \
  src/main/database/index.test.ts \
  src/shared/ipc/schemas.test.ts \
  src/main/ipc/github-auth-handlers.test.ts \
  src/preload-auth.test.ts \
  src/renderer/features/intelligence \
  src/renderer/components/app-shell-layout.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run required project verification**

```bash
npm run typecheck
npm run lint
npm test
npm run package
```

Expected: typecheck, tests, and package exit 0. Lint must introduce no new warnings or errors. If Electron packaging changes the native `better-sqlite3` ABI and Node tests later fail, run `npm rebuild better-sqlite3` before re-running `npm test`.

- [ ] **Step 5: Run final diagnostics and repository checks**

Run `lens_diagnostics` with `mode=all`, then:

```bash
git diff --check
git status --short
git diff --stat
```

Expected: no blocking diagnostics, whitespace errors, databases, `.env`, logs, worktree directories, `dist`, `out`, or other build artifacts staged.

- [ ] **Step 6: Commit documentation and final fixes**

```bash
git add README.md
git commit -m "docs: document cross-worktree intelligence" \
  -m "- Explain local deterministic overlap analysis and supported symbol languages.\n- Document risk, Attention, diff comparison, refresh, and chat-navigation behavior."
```

- [ ] **Step 7: Produce the completion report**

Report every modified file grouped by shared contracts, Main Process, renderer, generated migration, tests, and documentation. Include exact verification commands and their observed results; do not claim success without fresh command output.
