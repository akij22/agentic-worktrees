# Primary Checkout Coding-Agent Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users create coding-agent chats in a valid primary Git checkout, selected by default, without creating a separate Git worktree.

**Architecture:** Persist the existing checkout as a `worktrees.kind = "primary"` workspace row without invoking `git worktree add`; existing rows and newly created isolated worktrees use `kind = "linked"`. A main-process synchronization service validates non-bare working trees and feeds the existing coding-agent, file, terminal, diff, and Git flows through their current workspace IDs.

**Tech Stack:** Electron, TypeScript, React, SQLite, Drizzle ORM, simple-git, Zod, Vitest, Testing Library, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-08-22-primary-checkout-coding-agent-design.md`

## Global Constraints

- Use `npm` for every project command.
- Keep filesystem and Git inspection in the Electron main process.
- Keep IPC channel names and shared request shapes unchanged.
- Do not create a physical worktree, branch, directory, stash, or checkout for a primary workspace.
- Do not expose bare repositories, invalid Git directories, or missing paths as primary targets.
- Keep primary workspaces out of dashboard, conflict-intelligence, and linked-worktree management lists.
- Preserve existing uncommitted user changes, especially in coding-agent navigation components.
- Add production behavior only after a focused failing test and verify each red-green cycle.
- Generate migration artifacts with `npm run db:generate`; never edit generated migration files manually.
- Do not use subagents.

---

### Task 1: Persist workspace kind and isolate linked-worktree APIs

**Files:**
- Create: `src/main/worktrees/worktree-service.test.ts`
- Modify: `src/shared/db/schema.ts`
- Modify: `src/main/database/bootstrap.ts`
- Modify: `src/main/worktrees/worktree-service.ts`
- Generated: `src/main/database/migrations/0006_*.sql`
- Generated: `src/main/database/migrations/meta/0006_snapshot.json`
- Generated: `src/main/database/migrations/meta/_journal.json`
- Modify fixtures that construct `Worktree` values in focused test files reported by `npm run typecheck`

**Interfaces:**
- Produces: `Worktree["kind"]` with the exact union `"primary" | "linked"`.
- Produces: `listWorktreesForRepository(repositoryId)` and `listAllWorktrees()` returning only linked worktrees.
- Preserves: `getWorktreeById(id)` resolving either workspace kind.
- Preserves: `createWorktree(...)` while explicitly persisting `kind: "linked"`.

- [ ] **Step 1: Write the failing linked-worktree filtering test**

Create an in-memory database test using `bootstrapSchemaSql`, seed one repository and two worktree rows, and verify that general lists exclude the primary row while exact lookup still resolves it:

```ts
it("keeps primary workspaces out of linked-worktree lists", () => {
  seedWorktree({ id: "primary-1", kind: "primary", path: "/repo" });
  seedWorktree({ id: "linked-1", kind: "linked", path: "/repo.wt/feature" });

  expect(listAllWorktrees().map(({ id }) => id)).toEqual(["linked-1"]);
  expect(listWorktreesForRepository("repository-1").map(({ id }) => id))
    .toEqual(["linked-1"]);
  expect(getWorktreeById("primary-1")?.kind).toBe("primary");
});
```

The production change caught by this test is removing the `kind = "linked"` predicate from either general list.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/main/worktrees/worktree-service.test.ts`

Expected: FAIL because the bootstrap/schema does not yet support `worktrees.kind` or because the primary row is returned by a general list.

- [ ] **Step 3: Add the discriminator and linked-only behavior**

Add a shared type and schema column:

```ts
export const worktreeKinds = ["primary", "linked"] as const;
export type WorktreeKind = (typeof worktreeKinds)[number];

kind: text("kind").$type<WorktreeKind>().notNull().default("linked"),
```

Add `kind TEXT NOT NULL DEFAULT 'linked'` to the bootstrap `CREATE TABLE worktrees` statement. Filter both list functions with `eq(worktrees.kind, "linked")`, keep exact lookup unfiltered, and set `kind: "linked"` in `createWorktree`.

- [ ] **Step 4: Generate migration artifacts**

Run: `npm run db:generate`

Expected: a generated migration adding the non-null `kind` column with default `linked`, plus generated metadata updates. Inspect the generated SQL; do not edit it.

- [ ] **Step 5: Run the focused test and schema checks GREEN**

Run: `npm test -- src/main/worktrees/worktree-service.test.ts`

Run: `npm run typecheck`

Expected: the focused test passes. Add `kind: "linked"` only to typed fixtures identified by TypeScript until typecheck passes; do not alter unrelated behavior.

- [ ] **Step 6: Review and commit only Task 1 changes**

Run: `git diff --check`

Inspect staged paths and ensure no pre-existing user changes are included. Suggested commit:

```text
feat(database): distinguish primary and linked workspaces

- Add the worktree kind discriminator and generated migration artifacts.
- Keep primary workspace rows out of linked-worktree management lists.
- Mark worktrees created by the existing workflow as linked.
```

---

### Task 2: Synchronize valid primary checkout workspaces

**Files:**
- Create: `src/main/coding-agents/primary-workspace-service.ts`
- Create: `src/main/coding-agents/primary-workspace-service.test.ts`

**Interfaces:**
- Produces: `getPrimaryWorkspaceId(repositoryId: string): string` using a deterministic ID.
- Produces: `synchronizePrimaryWorkspaces(): Promise<AgentWorktreeContext[]>` returning only currently valid primary contexts.
- Produces: `revalidatePrimaryWorkspace(worktreeId: string): Promise<AgentWorktreeContext>` for creation-time validation.
- `AgentWorktreeContext` is a focused exported type pairing `typeof worktrees.$inferSelect` with `typeof repositories.$inferSelect`.

- [ ] **Step 1: Write failing tests for valid, repeated, detached, and invalid synchronization**

Use temporary directories and real local Git repositories initialized through `git init`; configure a local test identity before committing. Test these literal outcomes:

```ts
it("persists one primary workspace for a valid checkout", async () => {
  const contexts = await synchronizePrimaryWorkspaces();

  expect(contexts).toHaveLength(1);
  expect(contexts[0]?.worktree).toMatchObject({
    id: getPrimaryWorkspaceId("repository-1"),
    repositoryId: "repository-1",
    kind: "primary",
    name: "Main checkout",
    branchName: "main",
  });
});

it("updates the same primary row instead of duplicating it", async () => {
  await synchronizePrimaryWorkspaces();
  await git.checkoutLocalBranch("feature/direct-chat");
  const contexts = await synchronizePrimaryWorkspaces();

  expect(contexts[0]?.worktree.branchName).toBe("feature/direct-chat");
  expect(selectPrimaryRows()).toHaveLength(1);
});

it.each(["missing", "not-git", "bare"])(
  "omits a %s repository from primary contexts",
  async (fixtureKind) => {
    configureRepositoryPath(fixtureKind);
    expect(await synchronizePrimaryWorkspaces()).toEqual([]);
  },
);
```

Add a detached-HEAD assertion for the literal branch label `Detached HEAD`. The production changes caught are skipped Git validation, duplicate insertion, stale branch metadata, and exposing bare repositories.

- [ ] **Step 2: Run synchronization tests and verify RED**

Run: `npm test -- src/main/coding-agents/primary-workspace-service.test.ts`

Expected: FAIL because the service exports do not exist.

- [ ] **Step 3: Implement minimal Git inspection and upsert behavior**

Implement inspection in the main process with `existsSync`, `path.resolve`, and `simpleGit`. Require all of:

```ts
const isInsideWorkTree =
  (await git.revparse(["--is-inside-work-tree"])).trim() === "true";
const isBare =
  (await git.revparse(["--is-bare-repository"])).trim() === "true";
const topLevel = path.resolve(
  (await git.revparse(["--show-toplevel"])).trim(),
);
```

Return no context unless `isInsideWorkTree`, `!isBare`, and `topLevel === resolvedPath`. Read the branch with `revparse(["--abbrev-ref", "HEAD"])`, map `HEAD` to `Detached HEAD`, and read the current commit SHA when available.

Use `primary:${repositoryId}` as the deterministic ID. Insert or update a row with `kind: "primary"`, `name: "Main checkout"`, the resolved path, branch label, head SHA, `status: "ready"`, and timestamps. Catch expected Git-validation failures by omitting that repository; allow database errors to propagate.

For `revalidatePrimaryWorkspace`, resolve the row and repository, reject non-primary IDs, rerun inspection, update metadata, and throw `Primary checkout is unavailable for repository: <id>` when validation fails.

- [ ] **Step 4: Run synchronization tests GREEN**

Run: `npm test -- src/main/coding-agents/primary-workspace-service.test.ts`

Expected: all primary synchronization cases pass without network access.

- [ ] **Step 5: Review and commit only Task 2 changes**

Run: `git diff --check`

Suggested commit:

```text
feat(main): synchronize primary checkout workspaces

- Validate repository roots as non-bare Git working trees.
- Persist one deterministic primary workspace per repository.
- Refresh branch and revision metadata before direct session creation.
```

---

### Task 3: Integrate primary workspaces into coding-agent session creation

**Files:**
- Modify: `src/main/coding-agents/coding-agent-service.ts`
- Modify: `src/main/coding-agents/coding-agent-service.test.ts`
- Modify if return typing requires it: `src/main/ipc/index.ts`

**Interfaces:**
- Changes: `listAgentWorktrees(): Promise<AgentWorktreeContext[]>`.
- Preserves: `createAgentSession({ agentKind, worktreeId, title })` request shape and `AgentSessionSummary` response shape.
- Consumes: `synchronizePrimaryWorkspaces()` and `revalidatePrimaryWorkspace(worktreeId)` from Task 2.

- [ ] **Step 1: Write failing service integration tests**

Add tests proving that the coding-agent list contains synchronized primary and linked contexts and that session creation uses the primary path:

```ts
it("lists the primary checkout before linked worktrees", async () => {
  const contexts = await listAgentWorktrees();

  expect(contexts.map(({ worktree }) => worktree.kind)).toEqual([
    "primary",
    "linked",
  ]);
});

it("creates a session in the revalidated primary checkout", async () => {
  const [primary] = await listAgentWorktrees();
  await createAgentSession({
    agentKind: "codex",
    worktreeId: primary!.worktree.id,
    title: "Direct chat",
  });

  expect(mocks.codex.adapter.createSession).toHaveBeenCalledWith(
    primary!.repository.localRootPath,
    "Direct chat",
    { modelId: "gpt-5.4" },
  );
});
```

Add a case that invalidates the primary path after listing and expects creation to reject before the adapter is called. Use a real temporary Git working tree for the repository fixture so the test exercises validation rather than mocking it.

- [ ] **Step 2: Run coding-agent service tests and verify RED**

Run: `npm test -- src/main/coding-agents/coding-agent-service.test.ts`

Expected: FAIL because primary contexts are not synchronized or creation does not revalidate them.

- [ ] **Step 3: Integrate list and creation flows**

Make `listAgentWorktrees` await synchronized primary contexts, query linked contexts with `eq(worktrees.kind, "linked")`, combine them, and sort by repository name with primary before linked targets inside a project.

In `createAgentSession`, resolve the selected context as today; when `context.worktree.kind === "primary"`, replace it with the result of `await revalidatePrimaryWorkspace(input.worktreeId)` before listing models or creating the external session. Keep linked behavior and request validation unchanged.

Update the authenticated IPC callback only if TypeScript requires an explicit async wrapper; do not add a channel or expose Git primitives to preload/renderer.

- [ ] **Step 4: Run integration tests GREEN**

Run: `npm test -- src/main/coding-agents/coding-agent-service.test.ts`

Run: `npm test -- src/main/ipc/github-auth-handlers.test.ts src/preload-auth.test.ts src/shared/ipc/schemas.test.ts`

Expected: all service and IPC contract tests pass with unchanged request payloads.

- [ ] **Step 5: Review and commit only Task 3 changes**

Run: `git diff --check`

Suggested commit:

```text
feat(coding-agent): allow sessions in primary checkouts

- Include synchronized primary workspaces in coding-agent targets.
- Revalidate shared checkouts immediately before creating a session.
- Preserve the existing typed IPC session contract.
```

---

### Task 4: Default the new-session UI to the primary checkout

**Files:**
- Create: `src/renderer/features/coding-agent/lib/workspace-labels.ts`
- Create: `src/renderer/features/coding-agent/lib/workspace-labels.test.ts`
- Modify: `src/renderer/features/coding-agent/components/NewSessionDialog.tsx`
- Modify: `src/renderer/features/coding-agent/components/NewSessionDialog.test.tsx`
- Modify: `src/renderer/features/coding-agent/components/CodingAgentProjectSidebar.tsx`
- Modify: `src/renderer/features/coding-agent/components/SessionCard.tsx`
- Modify: `src/renderer/features/coding-agent/lib/secondary-session-options.ts`
- Modify fixture objects in coding-agent renderer tests to include `kind: "linked"`

**Interfaces:**
- Produces: `getWorkspaceLabel(context): string` returning `Main checkout · <branch>` for primary targets and `<name> · <branch>` for linked targets.
- Produces: `getWorkspaceShortLabel(context): string` returning `Main checkout` for primary targets and the linked branch name otherwise.
- Preserves: `NewSessionDialog` props and `codingAgent.createSession` payload.

- [ ] **Step 1: Write failing label and dialog behavior tests**

Test label behavior with literal expectations:

```ts
expect(getWorkspaceLabel(primaryContext)).toBe("Main checkout · main");
expect(getWorkspaceLabel(linkedContext)).toBe("feature-ui · feat/ui");
expect(getWorkspaceShortLabel(primaryContext)).toBe("Main checkout");
```

Extend `NewSessionDialog.test.tsx` with contexts deliberately ordered linked-first, primary-second. Verify that:

```ts
expect(workspaceOptions.map((option) => option.textContent)).toEqual([
  "Main checkout · main",
  "feature-ui · feat/ui",
]);
expect(workspaceSelect.value).toBe("primary:repository");
expect(container.textContent).toContain(
  "Changes are applied directly to the shared checkout",
);
```

Submit and assert the existing payload contains `worktreeId: "primary:repository"`. Add a separate render with `initialWorktreeId="linked-1"` and verify the explicit linked selection wins over the primary default.

The production changes caught are wrong sorting, wrong default, loss of deep-link selection, misleading labels, and submitting the wrong workspace ID.

- [ ] **Step 2: Run renderer tests and verify RED**

Run: `npm test -- src/renderer/features/coding-agent/lib/workspace-labels.test.ts src/renderer/features/coding-agent/components/NewSessionDialog.test.tsx`

Expected: FAIL because label helpers and primary selection behavior do not exist.

- [ ] **Step 3: Implement labels, sorting, defaulting, and warning**

Add focused helpers that branch only on `context.worktree.kind`. In `NewSessionDialog`, sort each project's contexts with primary first, resolve default selection as:

```ts
const requested = contexts.find(
  ({ worktree }) => worktree.id === initialWorktreeId,
);
const preferred =
  requested ??
  contexts.find(({ worktree }) => worktree.kind === "primary") ??
  contexts[0];
```

Rename the visible field label from `Worktree` to `Workspace`. Render the warning only when the selected context is primary, using accessible text and existing muted/destructive design tokens; do not add animation or a confirmation dialog.

Use `getWorkspaceShortLabel` in the project sidebar, session cards, and secondary-session options so primary sessions never show `Unavailable worktree` or a misleading branch-only label. Apply minimal patches around the existing local sidebar changes and verify the diff does not revert them.

- [ ] **Step 4: Run renderer tests GREEN**

Run: `npm test -- src/renderer/features/coding-agent/lib/workspace-labels.test.ts src/renderer/features/coding-agent/components/NewSessionDialog.test.tsx src/renderer/features/coding-agent/views/CodingAgentLanding.test.tsx src/renderer/features/coding-agent/components/coding-agent-layout.test.tsx`

Expected: all focused UI tests pass and retain the user's compact/collapsed sidebar behavior.

- [ ] **Step 5: Review and commit only Task 4 changes**

Run: `git diff --check`

Before staging, compare the three pre-existing diffs in `CodingAgentProjectSidebar.tsx`, `CodingAgentLanding.test.tsx`, and `CodingAgentWorkspace.tsx`; stage only new feature hunks. Suggested commit:

```text
feat(renderer): default chats to the main checkout

- Put valid primary checkouts first in the workspace selector.
- Explain when an agent will modify the shared checkout directly.
- Label primary sessions consistently across coding-agent navigation.
```

---

### Task 5: Full verification and implementation handoff

**Files:**
- Review all files modified by Tasks 1-4
- Do not modify generated migrations except by rerunning `npm run db:generate`

**Interfaces:**
- Verifies all interfaces and constraints from the approved spec.
- Produces no new behavior.

- [ ] **Step 1: Run all automated tests**

Run: `npm test`

Expected: Vitest exits 0 with no failed test files or tests.

- [ ] **Step 2: Run TypeScript and lint verification**

Run: `npm run typecheck`

Run: `npm run lint`

Expected: both commands exit 0.

- [ ] **Step 3: Run the renderer build**

Run: `npm exec vite -- build --config vite.renderer.config.ts`

Expected: Vite exits 0 and emits the renderer bundle. Do not add generated build output to Git.

- [ ] **Step 4: Inspect database artifacts and final diff**

Run: `git diff --check`

Run: `git status --short`

Confirm that the migration adds only `worktrees.kind`, all existing rows default to `linked`, no secret or build artifact is present, and pre-existing user modifications remain intact.

- [ ] **Step 5: Report the definition of done**

List every modified file and its purpose, commands run with outcomes, migration artifacts generated, preserved pre-existing changes, and any remaining risk. Do not claim completion unless the fresh commands above all passed.
