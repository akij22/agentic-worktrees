# Conflict Confirmation and Integration Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confirm selected cross-worktree risks with real Git simulation and retain isolated Integration Worktrees for semantic review or actual merge conflicts without modifying original worktrees.

**Architecture:** Extend the existing deterministic intelligence subsystem with a persisted preparation state machine, a focused Git adapter for synthetic snapshots/merge simulation, and a repository-scoped orchestration service. Expose preparation only through typed preload/IPC and render truthful Git confirmation plus file-first evidence in the existing Intelligence route.

**Tech Stack:** Electron 43, Node child processes, Git, React 19, TypeScript 5 strict mode, Zod, SQLite, Drizzle ORM/Kit, Vitest, Testing Library.

## Global Constraints

- Phase 1 supports one repository, one selected overlap pair, and one user-selected target branch per session.
- Original coding-agent worktrees, branches, indexes, and files must never be modified.
- Synthetic snapshots include committed, staged, unstaged, deleted, renamed, and non-ignored untracked final state.
- Safe results remove disposable sandbox state; Review Required and Conflict results retain isolated Integration Worktrees.
- Renderer input contains IDs and validated branch/editor identifiers only; Main Process resolves all paths.
- No conflict resolution edits, coding-agent resolution, verification commands, target updates, pushes, or PR creation in this phase.
- No AI classification, fabricated progress, subagents, or Ralph loop.

---

### Task 1: Preparation domain model and deterministic classification

**Files:**
- Create: `src/main/conflicts/types.ts`
- Create: `src/main/conflicts/conflict-classifier.ts`
- Create: `src/main/conflicts/conflict-classifier.test.ts`

**Interfaces:**
- Produces `ConflictResolutionState`, `ConflictClassification`, `GitConflictFile`, `SyntheticParticipant`, `PreparedConflictSession`, `MergeSimulationResult`, and `classifyConfirmedConflict(input)`.
- Consumes existing `ClassifiedOverlap` and `OverlapTarget` from `src/main/intelligence/types.ts`.

- [ ] Write failing tests for the classification matrix:

```ts
expect(classifyConfirmedConflict({ git: { kind: 'conflict', files: [file] }, targets: [] })).toBe('conflict');
expect(classifyConfirmedConflict({ git: { kind: 'clean', files: [] }, targets: [sameSymbol] })).toBe('review_required');
expect(classifyConfirmedConflict({ git: { kind: 'clean', files: [] }, targets: [sameModule] })).toBe('safe');
```

Also test monotonic allowed transitions: requested→capturing→simulating→safe/review_required/conflict/failed and reject terminal-state transitions.

- [ ] Run `npx vitest run src/main/conflicts/conflict-classifier.test.ts` and verify RED.
- [ ] Implement string-union types, transition guard, and classifier. High semantic reasons are `same-symbol`, `overlapping-range`, and same-original-range replacement/deletion reason codes already emitted by the overlap classifier; Git unresolved entries always win.
- [ ] Run the focused test and `npm run typecheck`; expect PASS.
- [ ] Commit `src/main/conflicts` as `feat(conflicts): define preparation state model`.

---

### Task 2: Normalized persistence and generated migration

**Files:**
- Modify: `src/shared/db/schema.ts`
- Create: `src/main/conflicts/conflict-resolution-repository.ts`
- Create: `src/main/conflicts/conflict-resolution-repository.test.ts`
- Modify: `src/main/database/index.test.ts`
- Generate: `src/main/database/migrations/0005_*.sql`
- Generate: `src/main/database/migrations/meta/0005_snapshot.json`
- Modify generated journal: `src/main/database/migrations/meta/_journal.json`

**Interfaces:**
- Produces `ConflictResolutionRepository` with `createSession`, `updateSession`, `replaceParticipants`, `replaceFiles`, `appendOperation`, `getSession`, `listSessions`, and `findActive`.
- Stores state from Task 1 without exposing Drizzle rows.

- [ ] Write failing repository tests using in-memory `better-sqlite3`: session round trip with ordered participants/files/operations, transactional rollback, and active tuple lookup.
- [ ] Add four schema tables exactly matching the approved spec, with repository/overlap/session indexes, cascade deletes, unique `(sessionId, side)`, unique `(sessionId, sequence)`, JSON text for bounded ranges/stages, and integer timestamps.
- [ ] Implement repository mappings and transaction-scoped hierarchy replacement. Invalid persisted enum strings throw rather than silently coercing.
- [ ] Run repository/database tests and verify GREEN.
- [ ] Run `npm run db:generate`; do not hand-edit generated artifacts.
- [ ] Re-run `npx vitest run src/main/conflicts/conflict-resolution-repository.test.ts src/main/database/index.test.ts` and `npm run typecheck`.
- [ ] Commit schema, repository, tests, and generated migration as `feat(conflicts): persist preparation sessions`.

---

### Task 3: Synthetic snapshot Git adapter and real integration tests

**Files:**
- Create: `src/main/conflicts/integration-git-adapter.ts`
- Create: `src/main/conflicts/integration-git-adapter.test.ts`
- Create: `src/main/conflicts/git-process.ts`
- Create: `src/main/conflicts/git-process.test.ts`

**Interfaces:**
- `GitProcess.run({ cwd, args, env? }): Promise<{ stdout; stderr }>` uses `execFile`/`spawn`, never a shell string.
- `IntegrationGitAdapter` produces `resolveRef`, `captureFingerprint`, `createSyntheticSnapshot`, `createIntegrationWorktree`, `mergeSynthetic`, `inspectConflicts`, and `cleanup`.

- [ ] Write failing process tests proving option-like unsafe refs are rejected, output is bounded, argument arrays are preserved, and non-zero exits retain command context.
- [ ] Implement `GitProcess` with injected runner for unit tests, UTF-8 bounded output, explicit Git environment, and `--` separators where supported.
- [ ] Write real temporary-repository tests that create target/left/right branches and dirty participant worktrees. Assert synthetic tree content includes committed, staged, unstaged, deleted, renamed, and untracked files while original HEAD, index checksum, and porcelain status remain byte-identical.
- [ ] Write clean/conflict tests: sequential synthetic merges return clean metadata or real `git ls-files -u` stages and leave the integration worktree conflicted.
- [ ] Implement temporary-index capture using `GIT_INDEX_FILE`, `read-tree`, `add -A`, `write-tree`, `commit-tree`, and `update-ref` under `refs/agentic-worktrees/integration/<session>/<side>`.
- [ ] Implement worktree creation under an injected integration root, deterministic merge ordering, conflict inspection, marker-range extraction, and idempotent cleanup.
- [ ] Run `npx vitest run src/main/conflicts/integration-git-adapter.test.ts src/main/conflicts/git-process.test.ts`; expect PASS and confirm originals unchanged.
- [ ] Run primary LSP diagnostics on `src/main/conflicts`.
- [ ] Commit as `feat(conflicts): simulate complete worktree merges`.

---

### Task 4: Integration worktree lifecycle service

**Files:**
- Create: `src/main/conflicts/integration-worktree-service.ts`
- Create: `src/main/conflicts/integration-worktree-service.test.ts`

**Interfaces:**
- `prepare({ sessionId, repository, targetBranch, left, right }): Promise<IntegrationPreparationResult>`.
- Inputs are backend-resolved repository/worktree records; no renderer paths.
- Result includes participant fingerprints/synthetic refs, Git result, normalized affected files, sandbox branch/path, retained flag, and cleanup status.

- [ ] Write failing fake-adapter tests for exact capture/merge order, cross-repository rejection, target validation, Safe cleanup, Review retention, Conflict retention, failure cleanup, post-operation original fingerprint mismatch, and idempotent retries.
- [ ] Implement canonical path containment under the integration root, deterministic left/right order, operation callbacks, pre/post fingerprint enforcement, and retention decisions supplied by the classifier.
- [ ] Normalize Git conflict stages and static overlap targets into file-first evidence without guessing symbols/ranges.
- [ ] Run focused tests and typecheck; expect PASS.
- [ ] Commit as `feat(conflicts): manage isolated integration worktrees`.

---

### Task 5: Persisted ConflictIntelligenceService orchestration

**Files:**
- Create: `src/main/conflicts/conflict-intelligence-service.ts`
- Create: `src/main/conflicts/conflict-intelligence-service.test.ts`
- Create: `src/main/conflicts/index.ts`

**Interfaces:**
- Produces `prepareConflict({ overlapId, targetBranch })`, `getSession(sessionId)`, `listSessions({ repositoryId, overlapId? })`, `listTargetBranches(repositoryId)`, `onSessionChanged(listener)`, and `reconcileInterruptedSessions()`.
- Depends on Task 2 repository, Task 4 lifecycle service, current intelligence overlap/snapshot access, repository/worktree lookup, branch listing, ID/time factories, and event callback.

- [ ] Write failing tests for input ownership, stale/missing overlap, active request coalescing, per-repository serialization, truthful persisted transitions, operation logging, Safe/Review/Conflict DTOs, failure recording, and event emission.
- [ ] Extend the intelligence repository/service only as needed to resolve the source snapshot and persisted overlap participants by IDs; do not expose database rows to IPC.
- [ ] Implement the repository lock and in-flight tuple map. Create the session before side effects, persist every state, and finalize only after lifecycle output is stored.
- [ ] Implement restart reconciliation: transient states become failed unless retained Git evidence can be validated through the lifecycle service.
- [ ] Wire production dependencies in `src/main/conflicts/index.ts` using centralized workspace/integration-root configuration.
- [ ] Run focused service tests and typecheck.
- [ ] Commit as `feat(conflicts): orchestrate Git confirmation sessions`.

---

### Task 6: Typed schemas, channels, preload, IPC, and events

**Files:**
- Modify: `src/shared/ipc/schemas.ts`
- Modify: `src/shared/ipc/schemas.test.ts`
- Modify: `src/shared/ipc/channels.ts`
- Modify: `src/shared/ipc/api.ts`
- Modify: `src/preload.ts`
- Modify: `src/preload-auth.test.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/ipc/github-auth-handlers.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Adds `listTargetBranches`, `prepareConflict`, `getResolutionSession`, `listResolutionSessions`, `openIntegrationWorktree`, and `onResolutionSessionChanged` under `window.api.intelligence`.
- DTO includes session state/classification, source overlap ID, target branch/SHA, ordered participant snapshots, normalized file evidence, current truthful stage, sandbox metadata, operations, and timestamps.

- [ ] Write failing Zod tests for valid/invalid branch names, IDs, enum states, file evidence, and event payloads.
- [ ] Write failing preload tests for exact invoke channels/requests and listener cleanup.
- [ ] Write failing authenticated IPC tests proving raw invalid input is rejected before service calls and editor IDs resolve through Main Process editor service.
- [ ] Implement schemas/types/channels/API/preload with no `any`.
- [ ] Add thin authenticated handlers and BrowserWindow event broadcast. Invoke startup reconciliation once after database/service initialization.
- [ ] Run schema, preload, IPC tests and typecheck; expect PASS.
- [ ] Commit as `feat(conflicts): expose typed preparation APIs`.

---

### Task 7: Renderer preparation hook and conflict confirmation view model

**Files:**
- Create: `src/renderer/features/intelligence/hooks/use-conflict-preparation.ts`
- Create: `src/renderer/features/intelligence/hooks/use-conflict-preparation.test.tsx`
- Modify: `src/renderer/features/intelligence/components/conflict-view-model.ts`
- Modify: `src/renderer/features/intelligence/components/conflict-view-model.test.ts`

**Interfaces:**
- Hook consumes selected repository/overlap IDs and returns branches, selected target, latest session, preparing/error state, `prepare()`, and event-driven reload.
- View model produces explicit display kind `overlap | predicted_conflict | safe | review_required | conflict`, confirmation label, Attention filtering, and file-first rows.

- [ ] Write failing hook tests for branch loading, default target, prepare request, persisted event reload, stale request cancellation, and user-friendly errors.
- [ ] Write failing view-model tests proving static findings remain unconfirmed, same-symbol becomes predicted, Git Conflict wins, Safe leaves Attention, and Review/Conflict remain.
- [ ] Implement hook using only `window.api.intelligence`; preserve last terminal session during refresh failures.
- [ ] Implement pure display derivation without AI or task-title inference.
- [ ] Run focused renderer tests and typecheck.
- [ ] Commit as `feat(intelligence): model Git confirmation state`.

---

### Task 8: File-first Confirm + Prepare Mission Control UI

**Files:**
- Create: `src/renderer/features/intelligence/components/ConflictPreparation.tsx`
- Create: `src/renderer/features/intelligence/components/ConflictFileEvidence.tsx`
- Create: `src/renderer/features/intelligence/components/conflict-preparation.test.tsx`
- Modify: `src/renderer/features/intelligence/components/ConflictList.tsx`
- Modify: `src/renderer/features/intelligence/components/ConflictDetails.tsx`
- Modify: `src/renderer/features/intelligence/components/ConflictActions.tsx`
- Modify: `src/renderer/pages/Intelligence.tsx`
- Modify: `src/renderer/pages/Intelligence.test.tsx`

**Interfaces:**
- Uses Task 7 hook and existing chat/diff callbacks.
- Primary action is Confirm with Git before a session and Open Integration Worktree for retained Review/Conflict sessions.

- [ ] Write failing UI tests for terminology, target branch selection, prepare request, truthful stage labels, Safe removal from Attention, Git-confirmed badge, file/stage evidence, failed state, and editor/chat navigation.
- [ ] Implement compact target selector and Confirm with Git action. Disable duplicate submit while preparing.
- [ ] Replace generic conflict assumptions with explicit static/Git labels in the list.
- [ ] Make `ConflictFileEvidence` the selected detail's primary content. Render ranges/symbols/stages from DTO only.
- [ ] Update action context with target, sandbox, current stage, Git result, and Open Integration Worktree. Do not render Phase 2 resolution controls.
- [ ] Keep compare diffs and clickable original chat cards.
- [ ] Run renderer tests, primary diagnostics, typecheck, changed-file lint, and Electron package.
- [ ] Commit as `feat(intelligence): prepare Git-confirmed conflicts`.

---

### Task 9: Documentation and complete verification

**Files:**
- Modify: `README.md`
- Modify only files above when diagnostics require fixes.

- [ ] Document overlap/predicted/confirmed terminology, synthetic snapshots, original-worktree immutability, Integration Worktree retention, and Phase 1 limitations.
- [ ] Run proactive primary LSP diagnostics on `src/main/conflicts`, intelligence changes, shared IPC/schema, preload, IPC, and renderer intelligence files.
- [ ] Run focused tests:

```bash
npx vitest run src/main/conflicts src/main/intelligence src/main/database/index.test.ts src/shared/ipc/schemas.test.ts src/main/ipc/github-auth-handlers.test.ts src/preload-auth.test.ts src/renderer/features/intelligence src/renderer/pages/Intelligence.test.tsx
```

- [ ] Run the full gate, rebuilding `better-sqlite3` for Node before tests and restoring Electron natives afterward:

```bash
npm rebuild better-sqlite3
npm run typecheck && npm run lint && npm test && npm run package
npm run rebuild
```

- [ ] Run `lens_diagnostics mode=all`, `git diff --check`, `git status --short`, and confirm no original worktree path/database/log/build artifact is staged.
- [ ] Commit documentation/final fixes as `docs: document Git-confirmed conflict preparation`.
- [ ] Report every modified file, exact test counts, lint warnings, package result, and retained limitations without claiming later Resolve/Verify/Apply phases exist.
