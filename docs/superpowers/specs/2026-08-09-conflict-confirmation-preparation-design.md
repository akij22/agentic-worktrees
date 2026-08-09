# Conflict Confirmation and Integration Preparation Design

## Summary

This phase extends Cross-Worktree Intelligence from static overlap detection into Git-confirmed conflict preparation. It implements the first shippable segment of the product principle:

> Detect risk → confirm with Git → resolve in an isolated integration sandbox → verify with deterministic checks → integrate safely.

Phase 1 covers **Detect risk → confirm with Git → prepare an isolated integration sandbox**. It does not yet modify conflict files, run coding agents for resolution, execute project verification commands, update target branches, or create pull requests. Those capabilities follow in separately reviewed phases.

The selected scope is one persisted preparation session for one repository, one user-selected target branch, and one selected pair of worktrees. Original coding-agent worktrees are immutable inputs throughout preparation.

## Product Terminology

The UI and contracts distinguish evidence levels explicitly:

- **Overlap:** Two complete worktree deltas touch related files, modules, ranges, or symbols. This is deterministic static evidence, not a Git conflict.
- **Predicted conflict:** Static evidence indicates likely incompatibility, such as both worktrees modifying the same symbol or overlapping original ranges. It is not presented as confirmed.
- **Safe:** Git simulation auto-merges the pair into the selected target and no high semantic same-symbol/range evidence remains.
- **Review Required:** Git simulation auto-merges, but deterministic semantic evidence still warrants human inspection.
- **Conflict:** Git reports unresolved merge entries while integrating the synthetic worktree snapshots.

The application does not use AI to classify or confirm conflicts in Phase 1.

## Scope

### Included

- Existing complete-delta analysis covering committed, staged, unstaged, and untracked changes.
- High/medium overlap and predicted-conflict terminology in Mission Control.
- User-selected target branch, defaulted to the repository default branch.
- Real Git merge simulation for a selected worktree pair.
- Synthetic immutable commits representing each worktree's final complete state without modifying its branch, index, files, or worktree metadata.
- Safe, Review Required, Conflict, and Failed preparation outcomes.
- Durable SQLite preparation sessions, participants, files, evidence, Git operations, and sandbox metadata.
- Isolated Integration Worktree retention for Review Required and Conflict outcomes.
- Removal of disposable simulation state for Safe outcomes.
- Typed, Zod-validated preload/IPC contracts and session-change events.
- File-first Mission Control details and truthful preparation stages.
- Open Integration Worktree in a configured editor when retained.

### Excluded

- Keep First, Keep Second, manual editing, or conflict-marker editing in the renderer.
- Codex/OpenCode resolution execution.
- Typecheck, tests, lint, build, or project-specific verification commands.
- Integration commits intended for final delivery, target-branch updates, pushes, or pull requests.
- Resolve Safe/Resolve All Safe automation.
- More than two participants per preparation session.
- AI predictions or recommendations.

## User Workflow

1. Mission Control refreshes static intelligence and labels each finding as Overlap or Predicted conflict, with **Not confirmed** status.
2. The user selects a finding and chooses **Confirm with Git**.
3. The user confirms a target branch. The selector defaults to the repository default branch and contains validated local/remote branches already available through the Main Process.
4. The Main Process creates a durable preparation session and reports real stages:
   - capturing complete worktree deltas;
   - creating synthetic snapshots;
   - simulating merge;
   - classifying result;
   - preparing isolated sandbox, only when required.
5. If Safe, Mission Control records the Git result, removes disposable refs/worktree state, and moves the finding out of Attention.
6. If Review Required, Mission Control retains the cleanly merged Integration Worktree for inspection.
7. If Conflict, Mission Control retains the Integration Worktree in Git's actual conflicted state.
8. The user inspects affected files, ranges, symbols, Git evidence, original chats, and the Integration Worktree. Resolution actions are intentionally deferred to Phase 2.

## Main Process Architecture

### ConflictIntelligenceService

`ConflictIntelligenceService` is the orchestration boundary for confirmation and preparation. It:

- validates repository, overlap, target branch, participant, and current-snapshot eligibility;
- coalesces duplicate requests for the same repository/overlap/target tuple;
- serializes preparation operations per repository;
- creates and advances the persisted state machine;
- delegates all Git and filesystem work;
- combines static evidence with Git results;
- decides Safe, Review Required, Conflict, or Failed;
- emits typed session-change events; and
- records exact operation failures without deleting the latest static intelligence snapshot.

The service does not directly execute shell commands or access renderer-provided paths.

### IntegrationWorktreeService

`IntegrationWorktreeService` owns synthetic snapshots and sandbox lifecycle. It receives resolved backend entities, not renderer paths. Responsibilities:

- validate that participants belong to the same repository;
- validate the target ref and resolve its commit SHA;
- create a unique session namespace and filesystem location;
- create temporary indexes and synthetic refs;
- create, inspect, retain, or remove Integration Worktrees;
- capture Git conflict entries and conflict-marker ranges;
- prevent paths from escaping configured integration roots;
- preserve retained Review Required/Conflict sandboxes; and
- clean temporary indexes, refs, and disposable Safe/Failed worktrees.

### IntegrationGitAdapter

A focused injected `IntegrationGitAdapter` wraps explicit Git commands. It is distinct from the existing workspace status/publish service because preparation requires temporary indexes, `commit-tree`, synthetic refs, merge sequencing, unmerged-index inspection, and worktree lifecycle operations.

Every command uses argument arrays, fixed environment construction, bounded output, and repository/worktree roots resolved by the Main Process. No renderer string is interpolated into shell source.

### ConflictResolutionRepository

`ConflictResolutionRepository` encapsulates normalized SQLite access and transactions. It creates sessions before side effects, records every state transition and operation, transactionally replaces file/evidence rows after simulation, and reloads sessions for restart recovery and audit views.

A startup reconciliation pass marks interrupted transient sessions as Failed unless their retained sandbox can be validated and safely represented by a terminal Review Required or Conflict state.

## Synthetic Complete-Delta Algorithm

The algorithm captures each original worktree's final filesystem state without writing to its real index or branch.

For each participant, in deterministic left-then-right order:

1. Resolve the participant `HEAD` and merge base. Reject unborn or missing commits with a meaningful error.
2. Allocate a temporary index under the integration session directory.
3. Set `GIT_INDEX_FILE` to that temporary index and `GIT_WORK_TREE` to the original worktree path.
4. Run `git read-tree <participant-head>` into the temporary index.
5. Run `git add -A -- .` against the original worktree using only the temporary index. This captures the final committed, staged, unstaged, deleted, renamed, and non-ignored untracked state. It does not alter the original index.
6. Run `git write-tree` to create an immutable tree object.
7. Run `git commit-tree <tree> -p <participant-head>` with deterministic session metadata to create a synthetic snapshot commit.
8. Store the commit under `refs/agentic-worktrees/integration/<session-id>/<side>`.
9. Verify before and after fingerprints for the original `HEAD`, index checksum, status porcelain, and worktree path. Any unexpected mutation fails the session.

Synthetic refs are internal implementation details and are never presented as user branches.

## Merge Simulation and Sandbox Lifecycle

### Preparation root

Integration Worktrees live under a centralized configured integration root, separate from all original worktrees. A session path includes repository and session IDs, never task titles or renderer-provided paths.

### Merge sequence

1. Create a temporary integration branch from the selected target commit using namespace `agentic/integration/<session-id>`.
2. Add an Integration Worktree for that branch.
3. Merge the left synthetic snapshot with `--no-ff --no-edit`. If clean, record the merge commit.
4. Merge the right synthetic snapshot with `--no-ff --no-edit`.
5. If Git fails, do not abort the failing merge. Capture `git ls-files -u`, status porcelain v2, conflict paths, stage SHAs/modes, and marker ranges. Leave the sandbox in the conflicted state.
6. If both merges succeed, combine the clean Git result with static semantic evidence.

The order is persisted and displayed as First worktree then Second worktree. Phase 1 does not allow reordering after a session begins.

### Retention

- **Safe:** Persist result metadata, then remove the Integration Worktree, integration branch, synthetic refs, and temporary indexes.
- **Review Required:** Retain the clean Integration Worktree and temporary integration branch; remove temporary indexes but retain synthetic refs needed for audit/reproduction.
- **Conflict:** Retain the Integration Worktree, conflicted index/working tree, integration branch, and synthetic refs. Never run `merge --abort` automatically.
- **Failed before meaningful Git state:** Remove disposable resources and retain the failure log.
- **Failed after a conflicted state is confirmed:** Preserve the sandbox when cleanup could destroy evidence, and mark cleanup status explicitly.

Cleanup operations are idempotent and recorded.

## Classification Rules

Classification runs only after Git simulation:

- `Conflict` when Git reports unresolved index entries or an active failed merge with conflict evidence.
- `Review Required` when Git merges cleanly and static analysis contains same qualified symbol, overlapping original ranges, or replacement/deletion of the same original range.
- `Safe` when Git merges cleanly and no high semantic evidence exists.
- `Failed` when preparation cannot produce a trustworthy Git result.

Medium same-file/module overlap that Git merges cleanly is Safe unless a high semantic target is also present. Safe findings leave Attention but remain visible in session history.

## Persisted State Machine

### Session states

- `requested`
- `capturing`
- `simulating`
- `preparing_sandbox`
- `safe`
- `review_required`
- `conflict`
- `failed`

Only terminal states may be returned as completed preparation results. State transitions are monotonic and timestamped.

### SQLite tables

#### `conflict_resolution_sessions`

Stores repository, source intelligence snapshot/overlap, target ref/SHA, ordered participant IDs, state, classification, Git result, integration branch/path, retained/cleanup flags, error summary, created/updated/completed timestamps, and optimistic version.

#### `conflict_resolution_participants`

Stores session, side/order, worktree/run IDs, original branch/HEAD, merge-base SHA, synthetic commit/ref, pre/post status fingerprint, task, and agent identity snapshot.

#### `conflict_resolution_files`

Stores session, normalized path, result kind, left/right paths, Git stage metadata, marker ranges, static ranges/symbols, reason code, and risk.

#### `conflict_resolution_operations`

Stores session, monotonic sequence, stage, operation kind, sanitized command description, status, start/end timestamps, bounded stdout/stderr summary, and error context.

Generated Drizzle migrations are committed; generated SQL/meta files are never manually authored.

## Typed IPC

Shared Zod schemas expose DTOs, not database rows.

### Commands

- `intelligence.listTargetBranches({ repositoryId })`
- `intelligence.prepareConflict({ overlapId, targetBranch })`
- `intelligence.getResolutionSession({ sessionId })`
- `intelligence.listResolutionSessions({ repositoryId, overlapId? })`
- `intelligence.openIntegrationWorktree({ sessionId, editorId })`

### Event

- `intelligence.onResolutionSessionChanged(listener)`

Requests contain IDs and validated branch/editor identifiers only. IPC handlers authenticate the sender, validate input, remain thin, and delegate to services. Secrets and local paths not needed for display remain in the Main Process.

## Mission Control UI

### Attention list

Findings show separate static and Git-confirmation labels:

- Overlap · Not confirmed
- Predicted conflict · Not confirmed
- Review Required · Git mergeable
- Conflict · Git confirmed

Safe sessions are summarized outside Attention and remain available in history.

### Preparation action

Before confirmation, the primary action is **Confirm with Git**. It opens the target-branch selector and starts preparation. During preparation, the UI shows only the persisted current stage text; no percentage or fabricated ETA.

After a retained result, the primary action becomes **Open Integration Worktree**. Resolve controls are not rendered in Phase 1.

### File-first detail

Affected files are the main interaction unit. Each row shows:

- normalized path;
- static overlap/predicted-conflict evidence;
- Git-confirmed state;
- first/second worktree modification state;
- affected ranges and symbols;
- unresolved stage metadata when present; and
- deterministic reason/risk.

Selecting a file displays persisted patches and conflict evidence. Original worktree chat cards remain supporting context.

### States

The renderer handles loading, no overlap, not confirmed, preparing, Safe, Review Required, Conflict, Failed, stale static snapshot, missing sandbox, and restart-reconciled session states with accessible text and retry guidance.

## Error Handling and Safety

- Original worktrees are fingerprinted before and after preparation; detected mutation is a hard failure.
- Integration paths are canonicalized and constrained under the configured integration root.
- Branch names are validated and resolved through Git; arbitrary revisions and option-like names are rejected.
- Concurrent sessions for one repository are serialized.
- Duplicate active requests return the existing session.
- Process termination never triggers destructive cleanup of a confirmed conflict sandbox.
- Cleanup failures are persisted and surfaced; they are never silently ignored.
- Git output is bounded and sensitive absolute paths are omitted from renderer-facing errors when not necessary.

## Testing Strategy

### Unit tests

- static/Git classification matrix;
- state-transition validation;
- duplicate coalescing and repository lock behavior;
- target/ID/path validation;
- retention and cleanup decisions;
- DTO mapping and error sanitization.

### Service tests with fakes

- exact operation ordering;
- transaction boundaries;
- no original-worktree write adapter calls;
- failure recording at every stage;
- idempotent cleanup;
- session-change events.

### Real temporary Git integration tests

- complete final-state capture with committed, staged, unstaged, deleted, renamed, and untracked files;
- original HEAD/index/status fingerprints remain unchanged;
- clean auto-merge classified Safe and disposable worktree removed;
- clean same-symbol merge classified Review Required and sandbox retained;
- real content conflict classified Conflict with unmerged stages and sandbox retained;
- invalid target and cross-repository participants rejected;
- interrupted/failing commands preserve auditable state and obey cleanup rules.

### Persistence and contract tests

- generated migration bootstrap;
- normalized repository round trips and rollback;
- Zod request/response rejection;
- authenticated IPC registration;
- preload invocation and event cleanup.

### Renderer tests

- terminology never presents predictions as confirmed;
- target branch selection;
- truthful preparation stages;
- Safe removal from Attention;
- Review Required/Conflict file-first evidence;
- failure/retry and missing-sandbox states;
- original chat and Integration Worktree editor navigation.

## Delivery Phases After This Specification

### Phase 2 — Resolve

Keep First, Keep Second, manual editing, configured Codex/OpenCode selection, structured resolution prompts, and coding-agent execution only inside retained Integration Worktrees.

### Phase 3 — Verify

Conflict-marker/index checks, repository-derived verification commands, persisted check output, pass/fail gate, and coding-agent repair loop inside the same sandbox.

### Phase 4 — Apply

Auditable integration commits, target update or pull request, safe bulk automation, retention policy, cleanup controls, and complete resolution history.

Each later phase receives a separate design approval and implementation plan before code changes.
