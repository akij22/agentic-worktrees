# Cross-Worktree Conflicts UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Intelligence graph with a reference-aligned, three-column conflict workspace driven exclusively by persisted intelligence snapshots.

**Architecture:** Keep `useIntelligence` and existing typed IPC unchanged. Add pure conflict-selection helpers and focused renderer components for the conflict list, inline details, and action context; compose them only in `Intelligence.tsx`. Continue loading persisted diff comparisons on demand through the existing dialog.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Lucide React, React Router, Vitest, Testing Library.

## Global Constraints

- Modify only `/intelligence` and renderer files under `src/renderer/features/intelligence`, plus their tests and this plan.
- Use real `IntelligenceSnapshotDto` data; never add mock production data, AI conflict guesses, or fabricated progress.
- Show high- and medium-risk overlaps only, ordered high before medium and stably within each risk.
- Keep existing repository selection, refresh, stale-snapshot preservation, chat navigation, and persisted diff comparison.
- Do not modify AppShell, dashboard, coding-agent, settings, Main Process, database, preload, or shared IPC contracts.
- Do not use subagents or Ralph loop.

---

### Task 1: Conflict derivation and summary

**Files:**
- Create: `src/renderer/features/intelligence/components/conflict-view-model.ts`
- Create: `src/renderer/features/intelligence/components/conflict-view-model.test.ts`
- Modify: `src/renderer/features/intelligence/components/IntelligenceSummary.tsx`
- Modify: `src/renderer/features/intelligence/components/intelligence-components.test.tsx`

**Interfaces:**
- Consumes: `IntelligenceSnapshotDto`, `IntelligenceOverlapDto`, and `IntelligenceWorktreeDto`.
- Produces: `selectConflicts(snapshot): IntelligenceOverlapDto[]`, `worktreeFor(snapshot, id): IntelligenceWorktreeDto | undefined`, `conflictFileCount(overlap): number`, and reference-aligned summary cards.

- [ ] **Step 1: Write failing view-model tests**

```ts
it('keeps only high and medium conflicts with stable severity ordering', () => {
  const result = selectConflicts(snapshotWith([mediumA, low, high, mediumB]));
  expect(result.map(({ id }) => id)).toEqual(['high', 'medium-a', 'medium-b']);
});

it('counts unique affected files', () => {
  expect(conflictFileCount({
    ...high,
    targets: [target('src/a.ts'), target('src/a.ts'), target('src/b.ts')],
  })).toBe(2);
});
```

- [ ] **Step 2: Run the tests and verify RED**

```bash
npx vitest run src/renderer/features/intelligence/components/conflict-view-model.test.ts
```

Expected: FAIL because `conflict-view-model.ts` does not exist.

- [ ] **Step 3: Implement deterministic helpers**

```ts
const rank = { high: 0, medium: 1, low: 2 } as const;

export const selectConflicts = (snapshot: IntelligenceSnapshotDto) =>
  snapshot.overlaps
    .map((overlap, index) => ({ overlap, index }))
    .filter(({ overlap }) => overlap.risk !== 'low')
    .sort((left, right) =>
      rank[left.overlap.risk] - rank[right.overlap.risk] || left.index - right.index)
    .map(({ overlap }) => overlap);

export const conflictFileCount = (overlap: IntelligenceOverlapDto) =>
  new Set(overlap.targets.map(({ path }) => path)).size;
```

Also update summary labels to `Active worktrees`, `High-risk conflicts`, `Medium overlaps`, and `Independent worktrees`, using only snapshot counts.

- [ ] **Step 4: Run focused tests and verify GREEN**

```bash
npx vitest run src/renderer/features/intelligence/components/conflict-view-model.test.ts src/renderer/features/intelligence/components/intelligence-components.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/intelligence/components/conflict-view-model.ts src/renderer/features/intelligence/components/conflict-view-model.test.ts src/renderer/features/intelligence/components/IntelligenceSummary.tsx src/renderer/features/intelligence/components/intelligence-components.test.tsx
git commit -m "refactor(intelligence): derive conflict-focused view data"
```

---

### Task 2: Three-column conflict workspace

**Files:**
- Create: `src/renderer/features/intelligence/components/ConflictList.tsx`
- Create: `src/renderer/features/intelligence/components/ConflictDetails.tsx`
- Create: `src/renderer/features/intelligence/components/ConflictActions.tsx`
- Create: `src/renderer/features/intelligence/components/conflict-workspace.test.tsx`
- Delete: `src/renderer/features/intelligence/components/WorktreeOverlapMap.tsx`
- Delete: `src/renderer/features/intelligence/components/AttentionPanel.tsx`
- Delete: `src/renderer/features/intelligence/components/OverlapDetails.tsx`

**Interfaces:**
- `ConflictList` consumes conflicts, selected ID, snapshot, and `onSelect(id)`.
- `ConflictDetails` consumes one overlap plus its left/right worktrees.
- `ConflictActions` consumes the selected overlap, involved worktrees, independent worktrees, `onOpenChat(worktreeId, runId)`, and `onCompare(overlapId)`.

- [ ] **Step 1: Write failing workspace tests**

```tsx
it('updates inline evidence when another conflict is selected', () => {
  render(<ConflictWorkspaceHarness snapshot={snapshot} />);
  fireEvent.click(screen.getByRole('button', { name: /task 2.*task 3/i }));
  expect(screen.getByRole('heading', { name: /task 2.*task 3/i })).toBeTruthy();
  expect(screen.getByText('src/second.ts')).toBeTruthy();
});

it('uses snapshot metrics and real chat identifiers', () => {
  const onOpenChat = vi.fn();
  render(<ConflictActions {...props} onOpenChat={onOpenChat} />);
  expect(screen.getByText('+120')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open Task 1 chat' }));
  expect(onOpenChat).toHaveBeenCalledWith('worktree-1', 'run-1');
});

it('renders independent snapshot worktrees separately', () => {
  render(<ConflictActions {...props} independentWorktrees={[independent]} />);
  expect(screen.getByRole('heading', { name: 'Independent worktrees' })).toBeTruthy();
  expect(screen.getByText(independent.task)).toBeTruthy();
});
```

- [ ] **Step 2: Run the tests and verify RED**

```bash
npx vitest run src/renderer/features/intelligence/components/conflict-workspace.test.tsx
```

Expected: FAIL because the three new components do not exist.

- [ ] **Step 3: Implement `ConflictList`**

Render a dense scrollable list matching the reference. Each button includes textual risk, left/right task names, `overlap.summary`, first target path, real agent names, latest `updatedAt`, and `conflictFileCount(overlap)`. Selected high and medium cards use red and amber borders respectively. Include `Showing N of N conflicts` and no low-risk entries.

- [ ] **Step 4: Implement `ConflictDetails`**

Render the selected pair heading, deterministic summary, risk, `reasonCode`, category, affected paths, and target rows. For each target, derive per-side modified state by checking `left.files` and `right.files` against `leftFilePath`, `rightFilePath`, or `path`. Render qualified symbols from `target.symbol` and matching worktree file `symbols`; do not synthesize affected areas or recommendations unavailable in the DTO.

- [ ] **Step 5: Implement `ConflictActions`**

Render involved worktree cards with task, branch, agent, file count, additions, and deletions. Enable chat buttons only for non-null run IDs. Compare Diffs invokes `onCompare(overlap.id)`. Render all `independent === true` snapshot worktrees below the selected actions.

- [ ] **Step 6: Run tests and verify GREEN**

```bash
npx vitest run src/renderer/features/intelligence/components/conflict-workspace.test.tsx src/renderer/features/intelligence/components/intelligence-components.test.tsx
```

Expected: PASS after obsolete graph-focused tests are replaced with conflict-focused assertions.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/features/intelligence/components
git commit -m "feat(intelligence): render conflict-focused workspace"
```

---

### Task 3: Intelligence page integration and responsive states

**Files:**
- Modify: `src/renderer/pages/Intelligence.tsx`
- Modify: `src/renderer/features/intelligence/components/intelligence-components.test.tsx`
- Retain: `src/renderer/features/intelligence/components/DiffComparison.tsx`

**Interfaces:**
- Consumes: `useIntelligence()`, `selectConflicts(snapshot)`, `ConflictList`, `ConflictDetails`, `ConflictActions`, and `DiffComparison`.
- Produces: reference-aligned `/intelligence` page with local selected-overlap state.

- [ ] **Step 1: Write failing integration assertions**

```tsx
it('defaults to the first high-risk conflict and excludes the graph', async () => {
  render(<MemoryRouter><Intelligence /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'Cross-worktree conflicts' })).toBeTruthy();
  expect(screen.getByText(high.summary)).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Worktree overlap map' })).toBeNull();
});

it('shows a conflict-free state when only low-risk overlaps exist', async () => {
  renderIntelligence(lowOnlySnapshot);
  expect(await screen.findByText('No high or medium conflicts')).toBeTruthy();
});
```

- [ ] **Step 2: Run the integration test and verify RED**

```bash
npx vitest run src/renderer/features/intelligence/components/intelligence-components.test.tsx
```

Expected: FAIL because the page still renders the graph-oriented workspace.

- [ ] **Step 3: Integrate the workspace**

Change title/subtitle to the reference copy. Derive conflicts with `selectConflicts`. Keep `selectedOverlapId` stable with an effect: preserve it if still present, otherwise select the first conflict. Resolve left/right worktrees from the snapshot and render:

```tsx
<div className="grid min-h-[36rem] gap-3 2xl:grid-cols-[minmax(19rem,0.9fr)_minmax(28rem,1.45fr)_minmax(20rem,0.95fr)]">
  <ConflictList ... />
  <ConflictDetails ... />
  <ConflictActions ... />
</div>
```

Remove graph and overlap-details dialog imports. Keep `DiffComparison`, repository selector, refresh behavior, loading, no-repository, no-worktree, stale, warning, and error states. Add the conflict-free state.

- [ ] **Step 4: Run proactive diagnostics**

Run `lsp_diagnostics` on `src/renderer/features/intelligence` and `src/renderer/pages/Intelligence.tsx`. Expected: zero primary TypeScript diagnostics.

- [ ] **Step 5: Run focused verification**

```bash
npx vitest run src/renderer/features/intelligence src/renderer/components/app-shell-layout.test.ts
npm run typecheck
npx eslint src/renderer/features/intelligence src/renderer/pages/Intelligence.tsx
npm run package
```

Expected: all tests pass, TypeScript and changed-file lint report zero errors, and Electron Forge packages successfully.

- [ ] **Step 6: Confirm route isolation**

```bash
git diff --name-only HEAD~3..HEAD
```

Expected: only the design/plan documents, Intelligence page, and Intelligence feature files appear. No AppShell or other screen file changes.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/pages/Intelligence.tsx src/renderer/features/intelligence
git commit -m "feat(intelligence): focus Mission Control on conflicts"
```
