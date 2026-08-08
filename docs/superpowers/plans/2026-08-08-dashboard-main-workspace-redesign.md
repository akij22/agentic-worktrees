# Dashboard Main Workspace Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace only the Dashboard's main repository workspace with the approved branches-first design while preserving the sidebar, backend, and existing chat-status mapping.

**Architecture:** `Dashboard` remains the renderer state owner and passes its existing selected-repository branch state into the presentational `RepositoryWorkspace`. `RepositoryWorkspace` renders repository summaries, branch states, worktree rows, and selected-worktree context from props; the existing create dialog gains an optional preferred base branch without changing any API call or backend contract.

**Tech Stack:** React 19, TypeScript 5, Tailwind CSS 4, Lucide React, existing shadcn-style UI primitives, Vitest, Testing Library, jsdom.

## Global Constraints

- Do not modify `RepositorySidebar`.
- Do not modify backend, database, IPC, preload, shared schemas, Git services, or GitHub services.
- Do not modify `src/renderer/features/dashboard/dashboard-state.ts`.
- Keep `getDashboardChatStatus` and the Ready, Running, Completed, and Error mapping exactly unchanged.
- Use only current renderer data; do not invent branch sync state, last-activity values, filters, sorting, or GitHub actions.
- Reuse the existing worktree dialog, selection behavior, chat summary, and Coding Agent navigation.
- Use the approved `design-concepts/dashboard-modern-concept.png` as the visual direction while retaining semantic theme tokens.
- Use `npm` for all project commands.

## File Structure

- Modify `src/renderer/features/dashboard/components/RepositoryWorkspace.tsx` — present the redesigned main workspace and all repository/branch/worktree states.
- Modify `src/renderer/features/dashboard/components/dashboard-components.test.tsx` — protect the new branch presentation, branch action, existing worktree behavior, and unchanged chat statuses.
- Modify `src/renderer/pages/Dashboard.tsx` — pass selected branch state and support preferred-base-branch dialog initialization.
- Create `src/renderer/pages/Dashboard.test.ts` — test preferred branch dialog initialization as a pure renderer-state behavior.

---

### Task 1: Branches-first repository workspace

**Files:**
- Modify: `src/renderer/features/dashboard/components/RepositoryWorkspace.tsx`
- Modify: `src/renderer/features/dashboard/components/dashboard-components.test.tsx`

**Interfaces:**
- Consumes: `RepositoryBranchListState` from `RepositorySidebar.tsx` as a type only; the sidebar implementation remains untouched.
- Changes: `onCreateWorktree(repository: Repository, preferredBaseBranch?: string): void`.
- Adds: `branchList: RepositoryBranchListState | undefined`.
- Adds: `onBranchesRequested(repositoryId: string): void`.
- Preserves: `getDashboardChatStatus(session)` and `CHAT_STATUS_PRESENTATION` exactly as currently implemented.

- [ ] **Step 1: Convert the dashboard component test to jsdom and add real interaction utilities**

Add the environment directive and imports at the top of `dashboard-components.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
```

Add cleanup after the fixtures:

```tsx
afterEach(() => cleanup());
```

The existing server-rendered tests stay in place.

- [ ] **Step 2: Update existing workspace fixtures with the required branch props**

For each existing `RepositoryWorkspace` render, add:

```tsx
branchList={{
  status: 'ready',
  branches: [
    { name: 'main', protected: true, headCommitSha: 'main-sha' },
    {
      name: worktree.branchName,
      protected: false,
      headCommitSha: worktree.headCommitSha,
    },
  ],
}}
onBranchesRequested={() => undefined}
```

Keep all existing assertions that protect worktree selection, Coding Agent context, changed files, and the four chat-status labels.

- [ ] **Step 3: Write failing tests for the new branch summary and states**

Add these focused tests:

```tsx
it('renders repository summaries and the loaded branch table', () => {
  const markup = renderToStaticMarkup(
    <RepositoryWorkspace
      repository={repository}
      worktrees={[worktree]}
      branchList={{
        status: 'ready',
        branches: [
          { name: 'main', protected: true, headCommitSha: 'main-sha' },
          { name: 'feat/new-work', protected: false, headCommitSha: null },
        ],
      }}
      selectedWorktreeId={worktree.id}
      sessionsByWorktreeId={{ [worktree.id]: chatSummary.snapshot.session }}
      chatSummary={chatSummary}
      onBranchesRequested={() => undefined}
      onCreateWorktree={() => undefined}
      onOpenCodingAgent={() => undefined}
      onSelectWorktree={() => undefined}
    />,
  );

  expect(markup).toContain('Default branch');
  expect(markup).toContain('Branches');
  expect(markup).toContain('2 branches');
  expect(markup).toContain('Worktrees');
  expect(markup).toContain('1 worktree');
  expect(markup).toContain('feat/new-work');
  expect(markup).toContain('Protected');
});

it.each([
  [{ status: 'loading' as const }, 'Loading branches'],
  [{ status: 'error' as const, message: 'Branch request failed.' }, 'Could not load branches'],
  [{ status: 'ready' as const, branches: [] }, 'No branches found'],
])('renders branch state %j', (branchList, expected) => {
  const markup = renderToStaticMarkup(
    <RepositoryWorkspace
      repository={repository}
      worktrees={[]}
      branchList={branchList}
      sessionsByWorktreeId={{}}
      chatSummary={{ status: 'idle' }}
      onBranchesRequested={() => undefined}
      onCreateWorktree={() => undefined}
      onOpenCodingAgent={() => undefined}
      onSelectWorktree={() => undefined}
    />,
  );

  expect(markup).toContain(expected);
});
```

These tests catch removal of summary counts, branch rows, branch metadata, and explicit loading/error/empty feedback.

- [ ] **Step 4: Write a failing interaction test for branch-preselected creation**

Add:

```tsx
it('requests a worktree with the clicked branch preselected', () => {
  const onCreateWorktree = vi.fn();
  render(
    <RepositoryWorkspace
      repository={repository}
      worktrees={[]}
      branchList={{
        status: 'ready',
        branches: [
          { name: 'feat/new-work', protected: false, headCommitSha: null },
        ],
      }}
      sessionsByWorktreeId={{}}
      chatSummary={{ status: 'idle' }}
      onBranchesRequested={() => undefined}
      onCreateWorktree={onCreateWorktree}
      onOpenCodingAgent={() => undefined}
      onSelectWorktree={() => undefined}
    />,
  );

  fireEvent.click(
    screen.getByRole('button', {
      name: 'Create worktree from feat/new-work',
    }),
  );

  expect(onCreateWorktree).toHaveBeenCalledWith(repository, 'feat/new-work');
});
```

The callback is the component's observable boundary; the test does not mock component internals.

- [ ] **Step 5: Run the focused tests and verify RED**

Run:

```bash
npx vitest run src/renderer/features/dashboard/components/dashboard-components.test.tsx
```

Expected: FAIL because `RepositoryWorkspace` does not accept `branchList` or `onBranchesRequested`, does not render branch summaries, and does not emit a preferred base branch.

- [ ] **Step 6: Extend the presentational component interface**

In `RepositoryWorkspace.tsx`, import `BranchDto`, `Skeleton`, and the branch-list type:

```tsx
import type {
  BranchDto,
  CodingAgentSessionDto,
} from '../../../../shared/ipc/schemas';
import { Skeleton } from '../../../components/ui/skeleton';
import type { RepositoryBranchListState } from './RepositorySidebar';
```

Extend props:

```tsx
branchList?: RepositoryBranchListState;
onBranchesRequested: (repositoryId: string) => void;
onCreateWorktree: (
  repository: Repository,
  preferredBaseBranch?: string,
) => void;
```

Default an absent list to `{ status: 'idle' }` inside the selected-repository branch.

- [ ] **Step 7: Add small local presentation units without changing status derivation**

Inside `RepositoryWorkspace.tsx`, add focused local components/functions:

```tsx
const countLabel = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

const SummaryCard = ({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) => (
  <div className="rounded-xl border border-border bg-card/60 px-4 py-3 shadow-sm">
    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      {label}
    </p>
    <div className="mt-3 flex min-w-0 items-end justify-between gap-3">
      <p className="truncate font-mono text-lg font-semibold text-foreground">
        {value}
      </p>
      <p className="shrink-0 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  </div>
);
```

Add a `BranchTable` local component accepting `repository`, `branchList`, `worktrees`, `sessionsByWorktreeId`, `onBranchesRequested`, `onCreateWorktree`, and `onSelectWorktree`. Associate branches and worktrees with:

```tsx
const worktreeByBranch = new Map(
  worktrees.map((worktree) => [worktree.branchName, worktree]),
);
```

For associated worktrees, derive chat display only with the existing calls:

```tsx
const chatStatus = getDashboardChatStatus(
  sessionsByWorktreeId[worktree.id],
);
const chatPresentation = CHAT_STATUS_PRESENTATION[chatStatus];
```

Do not edit the existing `CHAT_STATUS_PRESENTATION` object.

- [ ] **Step 8: Replace the main workspace markup with the approved hierarchy**

Keep the repository-unselected state. For a selected repository, render:

1. A compact bordered header with repository label, existing Local/Remote, Private, and Archived badges, path/URL, default branch, and the existing primary action.
2. One vertically scrollable content container: `min-h-0 flex-1 overflow-y-auto px-5 py-5 lg:px-6`.
3. A responsive three-card grid using the current default branch, loaded branch count/state, and worktree count.
4. A Branches section and bordered table beneath the cards.
5. A Worktrees section beneath the branch table.
6. A compact empty state when `worktrees.length === 0`.
7. When worktrees exist, a responsive grid containing the worktree list and selected-worktree details/chat context.

Use theme-driven classes such as `bg-card/60`, `border-border`, `text-muted-foreground`, `bg-primary/10`, and `border-primary/30`. Keep controls at least 32px high in this dense desktop UI and preserve focus rings.

Branch rows must render:

- Branch name.
- `Default` when `branch.name === repository.defaultBranch`.
- `Protected` when `branch.protected`.
- Associated worktree name or `Not created`.
- Existing mapped chat status only when a worktree is associated.
- “Select worktree” for an associated worktree, otherwise “Create worktree from {branch.name}”.

Preserve `WorktreeChatSummary`, `Detail`, the worktree status formatter, selection via `aria-current`, and `Open Coding Agent`.

- [ ] **Step 9: Run the focused tests and verify GREEN**

Run:

```bash
npx vitest run src/renderer/features/dashboard/components/dashboard-components.test.tsx
```

Expected: PASS, including the existing four-status test and the new branch interaction test.

- [ ] **Step 10: Refactor only after green**

Review `RepositoryWorkspace.tsx` for repeated table shells and status indicator markup. Extract only repeated presentational blocks that make the file easier to scan. Do not create a new service, state module, status helper, route, or shared contract.

Re-run:

```bash
npx vitest run src/renderer/features/dashboard/components/dashboard-components.test.tsx
```

Expected: PASS.

- [ ] **Step 11: Commit the tested workspace redesign**

```bash
git add src/renderer/features/dashboard/components/RepositoryWorkspace.tsx \
  src/renderer/features/dashboard/components/dashboard-components.test.tsx
git commit -m "feat(dashboard): redesign repository workspace" \
  -m "- Add repository summaries and a branches-first main workspace.\n- Preserve worktree selection, Coding Agent context, and existing chat-status labels.\n- Cover branch states and branch-preselected creation with renderer tests."
```

---

### Task 2: Dashboard branch data and preferred dialog base

**Files:**
- Modify: `src/renderer/pages/Dashboard.tsx`
- Create: `src/renderer/pages/Dashboard.test.ts`

**Interfaces:**
- Changes: `initialOpenDialog(repo: Repository, preferredBaseBranch?: string): DialogState` becomes an exported pure renderer-state initializer for direct testing.
- Changes: `openCreateDialog(repo: Repository, preferredBaseBranch?: string): void`.
- Passes: `branchList={repositoryBranchLists[selectedRepository.id]}`.
- Passes: `onBranchesRequested={loadRepositoryBranches}`.

- [ ] **Step 1: Write the failing preferred-base initializer test**

Create `src/renderer/pages/Dashboard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Repository } from '../../shared/db/schema';
import { initialOpenDialog } from './Dashboard';

const repository: Repository = {
  id: 'repository',
  githubRepoId: 42,
  ownerLogin: 'owner',
  name: 'agentic-worktrees',
  fullName: 'owner/agentic-worktrees',
  defaultBranch: 'main',
  isPrivate: false,
  isArchived: false,
  cloneUrl: 'https://example.com/repository.git',
  sshUrl: null,
  htmlUrl: 'https://example.com/repository',
  localRootPath: null,
  localCloneStatus: 'ready',
  lastLocalScanAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastSyncedAt: null,
};

describe('Dashboard worktree dialog state', () => {
  it('uses a clicked branch as the initial worktree base', () => {
    const state = initialOpenDialog(repository, 'feat/new-work');

    expect(state).toMatchObject({
      status: 'open',
      repo: repository,
      baseBranch: 'feat/new-work',
      branchesState: 'loading',
    });
  });

  it('falls back to the repository default branch', () => {
    const state = initialOpenDialog(repository);

    expect(state).toMatchObject({
      status: 'open',
      baseBranch: 'main',
    });
  });
});
```

This catches the actual renderer-state regression that would cause a clicked branch to be lost before the dialog opens.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run src/renderer/pages/Dashboard.test.ts
```

Expected: FAIL because `initialOpenDialog` is not exported and does not accept a preferred base branch.

- [ ] **Step 3: Add preferred-base initialization**

Change the initializer in `Dashboard.tsx` to:

```tsx
export const initialOpenDialog = (
  repo: Repository,
  preferredBaseBranch?: string,
): DialogState => ({
  status: 'open',
  repo,
  branches: [],
  branchesState: 'loading',
  baseBranch: preferredBaseBranch ?? repo.defaultBranch ?? '',
  newBranchName: '',
  worktreeName: '',
  submitting: false,
  createBaseBranch: { status: 'idle' },
});
```

Change the callback signature and initial state call:

```tsx
const openCreateDialog = useCallback(
  (repo: Repository, preferredBaseBranch?: string) => {
    setDialog(initialOpenDialog(repo, preferredBaseBranch));
    // existing async branch loading remains here
  },
  [],
);
```

Inside the existing successful `listBranches` update, resolve the base branch without discarding the clicked preference:

```tsx
baseBranch:
  branches.some((branch) => branch.name === prev.baseBranch)
    ? prev.baseBranch
    : repo.defaultBranch ?? branches[0]?.name ?? '',
```

All existing API calls and error handling remain unchanged.

- [ ] **Step 4: Pass branch state and retry behavior into the workspace**

At the existing `RepositoryWorkspace` call, add:

```tsx
branchList={
  selectedRepository
    ? repositoryBranchLists[selectedRepository.id]
    : undefined
}
onBranchesRequested={loadRepositoryBranches}
```

Pass `openCreateDialog` directly as the now-compatible `onCreateWorktree` callback. Do not modify `RepositorySidebar` props or behavior.

- [ ] **Step 5: Run focused dashboard tests and verify GREEN**

Run:

```bash
npx vitest run \
  src/renderer/pages/Dashboard.test.ts \
  src/renderer/features/dashboard/components/dashboard-components.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run renderer-sensitive verification**

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run package
```

Expected:

- Type checking exits 0.
- Lint has no new errors or warnings from changed files; the repository's known baseline warnings may remain.
- All tests pass. If packaging rebuilds `better-sqlite3` for Electron and a subsequent Node test run reports an ABI mismatch, run `npm rebuild better-sqlite3` before re-running tests.
- Electron Forge packages the renderer successfully.

- [ ] **Step 7: Inspect scope and diff quality**

Run:

```bash
git diff --check
git status --short
git diff -- \
  src/renderer/pages/Dashboard.tsx \
  src/renderer/pages/Dashboard.test.ts \
  src/renderer/features/dashboard/components/RepositoryWorkspace.tsx \
  src/renderer/features/dashboard/components/dashboard-components.test.tsx
```

Confirm:

- No `RepositorySidebar` diff exists.
- No `dashboard-state.ts` diff exists.
- No backend/shared/IPC file changed.
- The Ready/Running/Completed/Error mapping is byte-for-byte unchanged.
- The untracked `design-concepts/` reference assets are not accidentally included in implementation commits.

- [ ] **Step 8: Commit the Dashboard integration**

```bash
git add src/renderer/pages/Dashboard.tsx \
  src/renderer/pages/Dashboard.test.ts
git commit -m "feat(dashboard): connect branch-first worktree creation" \
  -m "- Pass the selected repository branch state into the main workspace.\n- Preselect a clicked branch in the existing worktree dialog.\n- Preserve existing renderer data loading and backend boundaries."
```

---

## Final Verification

- [ ] Run `git log -2 --oneline` and confirm the two implementation commits are scoped and in English.
- [ ] Run `git status --short` and confirm only intentionally untracked design-reference assets remain.
- [ ] Confirm every new production behavior was introduced after its focused test failed for the expected reason.
- [ ] Confirm the Dashboard main area visually follows `design-concepts/dashboard-modern-concept.png` without changing the sidebar.
