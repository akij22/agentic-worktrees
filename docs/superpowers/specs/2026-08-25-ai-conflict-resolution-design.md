# Supervised AI Conflict Resolution Design

**Date:** 2026-08-25
**Status:** Approved
**Scope:** Git-confirmed conflicts retained in an Integration Worktree

## Objective

Add a supervised AI resolution workflow to the existing cross-worktree
conflict review. A user can select a configured Codex or OpenCode agent, model,
and reasoning level; let that agent modify the retained Integration Worktree;
run an explicitly configured verification gate; and then approve commit and
push as two separate operations.

The agent must never be able to commit, push, update the target branch, or
create a pull request by itself. A failed verification command is an absolute
commit blocker. An approved push publishes only the isolated integration
branch, after which the user may explicitly create a pull request toward the
selected target branch.

## Product Decisions

- The first release supports only sessions classified as `conflict` by the
  existing Git confirmation workflow. `review_required` semantic overlaps are
  outside this scope.
- The resolver is selected explicitly for each session. The setup reuses the
  application's existing agent/model/reasoning picker behavior and visual
  language.
- Verification commands are editable for each resolution session. Suggested
  commands are derived from the repository's available package scripts.
- Every configured verification command must pass before commit approval is
  enabled. There is no bypass or “commit anyway” path.
- Commit and push require distinct user actions and distinct persisted
  approvals.
- Push publishes `agentic/integration/<conflict-session-id>` and never writes
  directly to the target branch.
- Pull-request creation is a separate explicit user action after a successful
  push.
- Aborting the agent preserves the Integration Worktree and its changes.
- Conflict detection and classification remain deterministic. AI participates
  only after Git has confirmed a conflict.

## Existing Foundation

The current conflict workflow already provides:

- a persisted conflict preparation session and operation history;
- a target branch and captured participant deltas;
- a private synthetic integration branch;
- a retained Integration Worktree for `conflict` results;
- normalized file evidence, Git stages, marker ranges, and participant context;
- typed IPC and renderer event delivery;
- configured Codex and OpenCode adapters, model discovery, reasoning variants,
  streaming events, abort, and permission responses;
- existing diff, commit, push, pull-request, model picker, reasoning picker,
  agent-message, tool-activity, and permission-card UI patterns.

The new workflow extends these foundations rather than replacing the
deterministic preparation flow or registering the Integration Worktree as a
normal user worktree.

## Alternatives Considered

### Dedicated resolution orchestrator over the existing agent runtime

This is the chosen approach. A conflict-specific orchestrator owns state,
security gates, verification, and Git approvals while reusing the configured
adapter/process/model infrastructure. Resolution sessions remain linked to the
conflict workflow and do not appear as ordinary worktree chats.

### Register the Integration Worktree as an ordinary worktree

This would maximize reuse of the current chat service, but it would expose
technical worktrees in normal navigation, overload regular worktree lifecycle
semantics, and make cleanup and ownership ambiguous.

### Embed Codex and OpenCode directly in the conflict service

This would keep the feature locally self-contained but duplicate executable
discovery, process ownership, model validation, event normalization,
permissions, abort behavior, and adapter logic.

## Architecture

### Preparation remains separate

The existing conflict preparation session remains the immutable record of Git
simulation and classification. Its terminal `conflict` state is not reopened
or overloaded with agent execution states.

Each agent workflow is represented by a child `ConflictAgentResolution`
record. This separation allows retries, audit history, and future resolution
strategies without weakening the meaning of the deterministic classification.

### Main-process components

#### `ConflictResolutionOrchestrator`

Owns the resolution state machine and serializes mutating operations per
resolution. It:

- validates that the parent session is a retained Git-confirmed conflict;
- resolves and revalidates the Integration Worktree path;
- creates resolution attempts;
- composes the resolver prompt from persisted conflict evidence;
- starts, reconciles, and aborts the selected agent runtime;
- captures the working-tree fingerprint and diff after agent activity;
- invokes verification in configured order;
- invalidates verification and approvals when the diff changes;
- delegates approved commit, push, and pull-request operations;
- persists state before emitting sanitized renderer events.

#### `ResolutionAgentRuntime`

Provides a directory-scoped interface over the existing Codex/OpenCode adapter
registry and installation configuration. It reuses model discovery, executable
management, normalized messages, tool activity, permission requests, abort,
and adapter reconciliation.

It does not call the regular `createAgentSession`, because that service
requires a registered user worktree and updates its active chat. Common
adapter-startup and model-validation logic will be extracted behind a shared
internal runtime boundary rather than copied.

The runtime stores its external session identifier on the resolution attempt,
so an interrupted application can reconcile messages and status after restart.

#### `ResolutionVerificationRunner`

Runs the session's immutable command snapshot sequentially inside the
Integration Worktree. A command is represented as an executable plus an array
of literal arguments; shell chaining, interpolation, redirection, and implicit
shell execution are not supported.

The runner captures start/end timestamps, exit code, bounded stdout/stderr
summaries, and an output digest. It supports cancellation and never blocks the
Electron main event loop.

#### `ResolutionGitService`

Owns the only supported paths to commit, push, and create a pull request. It:

- validates the repository, Integration Worktree, branch, HEAD, remote, and
  expected fingerprints before each mutation;
- stages the resolved working tree and creates a commit only after a valid
  commit approval;
- pushes only the recorded integration branch and exact approved commit SHA;
- rejects force pushes and target-branch pushes;
- delegates pull-request creation to the existing authenticated GitHub service;
- returns structured results without exposing credentials or raw Git internals.

#### `ConflictAgentResolutionRepository`

Encapsulates all database access for resolver configuration, attempts,
verification results, approvals, messages, tool activity, and operations.
Writes that change state and their corresponding audit records are
transactional.

### Renderer components

The workflow remains inside the existing Conflict Review screen:

- `ResolutionSetupDialog` selects agent, model, reasoning, optional user
  guidance, and verification commands.
- A shared `AgentModelReasoningPicker` is extracted from `SessionComposer` and
  used by both regular chat and resolution setup. It continues to use
  `PickerMenu`, searchable model options, provider hints, and the existing
  reasoning labels.
- `ConflictAgentResolutionPanel` shows state, attempts, messages, tool
  activity, permission requests, abort/retry actions, verification results,
  and errors.
- Existing message/tool/permission presentation components are reused through
  shared presentation DTOs where their behavior already matches.
- `ResolutionDiffReview` reuses the established diff presentation and displays
  the exact verified fingerprint.
- Separate commit and push confirmation dialogs show the immutable evidence
  covered by each approval.
- Pull-request creation reuses the existing PR form and GitHub flow after push.

The renderer never accesses Git, the filesystem, agent processes, the database,
or GitHub directly.

## Resolution State Machine

The persisted resolver states are:

- `draft`: configuration exists but no attempt is running;
- `resolving`: the selected agent is active;
- `resolution_stopped`: the agent was aborted or stopped without completing;
- `verification_required`: changes exist but are not covered by a successful
  verification fingerprint;
- `verifying`: configured commands are running;
- `verification_failed`: at least one command failed, was cancelled, or the
  working tree changed during verification;
- `awaiting_commit_approval`: all commands passed for the current diff and
  command fingerprints;
- `committing`: an approved commit operation is active;
- `awaiting_push_approval`: the approved commit exists locally;
- `pushing`: an approved push operation is active;
- `pushed`: the exact integration commit exists on the configured remote;
- `pr_created`: the pull request was created successfully;
- `failed`: a non-recoverable orchestration or integrity failure occurred.

Key transitions:

```text
draft -> resolving
resolving -> verification_required | resolution_stopped | failed
resolution_stopped -> resolving | verification_required
verification_required -> verifying | resolving
verifying -> verification_failed | awaiting_commit_approval
verification_failed -> verifying | resolving
awaiting_commit_approval -> committing | verification_required | resolving
committing -> awaiting_push_approval | failed
awaiting_push_approval -> pushing
pushing -> pushed | awaiting_push_approval | failed
pushed -> pr_created
```

Any unapproved filesystem change after successful verification invalidates the
verification fingerprint and returns the session to `verification_required`.
Any HEAD or commit change invalidates pending commit/push approvals and triggers
an integrity error or the appropriate recoverable state.

## Resolver Setup and Prompt

### Agent selection

The setup first selects a configured harness, then loads models using the
Integration Worktree as the model-discovery directory. The user explicitly
chooses:

- `agentKind` (`codex` or `opencode`);
- `providerId` and `modelId`;
- optional `reasoningVariant` supported by that model.

The main process validates all selections again immediately before execution.

### Verification configuration

The application reads repository metadata and suggests available checks. For
the current npm-based project it prioritizes existing scripts in this order:

1. `npm run typecheck`;
2. `npm run lint`;
3. `npm test`;
4. narrower project-specific scripts when explicitly selected by the user.

The user may add, remove, reorder, or edit executable/argument entries before
the first attempt. The accepted configuration is snapshotted on the resolution
record. Editing it later invalidates prior verification and approvals.

### Prompt composition

The system-generated resolver prompt contains:

- target and integration branch names;
- the two participant tasks and branch identities;
- conflict files, Git stages, marker ranges, and deterministic evidence;
- the user's optional instructions;
- the exact Integration Worktree scope;
- explicit prohibitions against commit, push, branch/ref mutation, destructive
  Git operations, and filesystem access outside the sandbox;
- the requirement to leave a conflict-marker-free working tree ready for
  verification.

Prompt constraints are defense in depth and are not treated as the security
boundary.

## Security and Integrity Boundaries

### Filesystem and process scope

- The Main Process resolves the persisted Integration Worktree path through
  `realpath` and verifies ownership by the parent conflict session before every
  agent, verification, or Git operation.
- The resolver process receives workspace-write access only to that directory.
- Writes to the repository's common Git directory, refs, worktree metadata,
  credentials, environment configuration, or unrelated paths are denied.
- The resolution runtime disables network access unless required by the
  existing configured agent transport; agent tool commands do not receive an
  unrestricted network capability.
- Process ownership is tracked and only owned processes are aborted.

### Git mutation policy

Agent command requests that can mutate Git state are rejected regardless of
user-level command approvals. This includes `add`, `commit`, `push`, `reset`,
`checkout`, `switch`, `merge`, `rebase`, `cherry-pick`, `tag`, ref updates,
worktree mutation, configuration mutation, and force operations.

The orchestrator records branch, HEAD, index, and ref fingerprints before
agent execution and verification. Unexpected mutations fail the attempt and
prevent commit. Commit and push remain callable only through
`ResolutionGitService` after approval validation.

### Verification command safety

- Commands use direct process execution with literal argument arrays.
- Empty executables, NUL bytes, overlong arguments, shell operators, shell
  wrappers, and paths resolving outside the Integration Worktree are rejected.
- Verification runs under the same Git-directory write restrictions as the
  agent.
- A command that attempts a forbidden mutation fails the verification gate.
- Output is bounded, secrets are redacted, and full credentials are never
  included in persisted records or IPC responses.

## Verification Gate

After agent activity stops, the orchestrator captures:

- a normalized diff fingerprint;
- current HEAD and integration branch;
- remaining unmerged entries and conflict markers;
- the verification command fingerprint.

Verification cannot succeed while unmerged entries or conflict markers remain.
Commands then run sequentially. Every command must exit with code zero. A
failure, cancellation, timeout, integrity mismatch, or later diff change moves
the resolution to `verification_failed` or `verification_required` and disables
commit approval.

`Run verification again` reuses the saved configuration. `Retry resolution`
starts a new auditable attempt in the same Integration Worktree with optional
additional guidance. Previous attempts and results remain immutable.

## Explicit Approval Model

### Commit approval

The commit confirmation shows:

- complete resolved diff and changed-file summary;
- successful verification commands and timestamps;
- current diff and command fingerprints;
- editable commit message;
- integration branch and current HEAD.

The approval request includes the expected diff fingerprint, command
fingerprint, HEAD, and commit message. The Main Process persists the approval
with authenticated local GitHub user identity when available, timestamp, and
evidence fingerprints. It revalidates everything before staging or committing.
Any mismatch rejects the approval without mutation.

After commit, the exact commit SHA is stored and the state becomes
`awaiting_push_approval`.

### Push approval

The push confirmation shows remote, integration branch, commit SHA, and target
branch. Its approval is stored separately and covers only that SHA and remote
branch. The backend rejects target-branch updates, changed SHAs, missing commit
approval, force options, and non-fast-forward rewrites.

### Pull request

After push, the user may explicitly open the existing pull-request dialog.
Head is fixed to the pushed integration branch and base is fixed to the parent
session's target branch. The user can edit title and body but cannot silently
change the approved branch relationship within this flow.

## Persistence Model

Drizzle-managed normalized tables will cover:

### `conflict_agent_resolutions`

One active resolver workflow per parent conflict session. Stores state,
selected harness/model/reasoning, user guidance, integration branch, expected
path identity, current attempt, fingerprints, approved/local/pushed commit
SHAs, remote branch, timestamps, and sanitized error context.

### `conflict_agent_attempts`

One row per start/retry with external adapter session ID, prompt digest,
status, start/end timestamps, abort reason, and error summary.

### `conflict_agent_messages` and `conflict_agent_tool_calls`

Sanitized projected agent activity linked to an attempt. These support live UI,
restart reconciliation, and audit without coupling the resolver to ordinary
chat runs.

### `conflict_verification_commands`

Ordered executable/argument configuration snapshotted for the resolution.

### `conflict_verification_results`

Immutable result rows per verification run and command, including status, exit
code, duration, bounded output summaries/digests, and covered fingerprints.

### `conflict_resolution_approvals`

Separate commit and push approvals containing approval kind, evidence
fingerprints or SHA, intended branch/remote, approver identity when available,
and timestamp. Approvals are append-only; invalidation is represented by a new
audit operation rather than deletion.

### `conflict_agent_operations`

Ordered state-transition and integrity events for setup, attempts,
verification, abort, retry, approval, commit, push, reconciliation, and PR
creation.

Schema changes are mirrored in bootstrap DDL and generated through
`npm run db:generate`; generated migrations are not hand-edited.

## Typed IPC Surface

Dedicated validated capabilities will include:

- list configured resolver agents and models;
- create/update draft resolution configuration;
- start, retry, abort, and reconcile an agent attempt;
- respond to a resolver-scoped permission request;
- get/list resolution sessions and subscribe to resolution changes;
- run or cancel verification;
- approve commit with expected fingerprints and message;
- approve push with expected commit SHA and remote branch;
- create a pull request from the pushed integration branch.

Each mutation has its own IPC channel. Handlers validate payloads and delegate
to the orchestrator; the preload exposes narrow typed functions. Responses are
structured DTOs and user-safe errors rather than database entities or process
objects.

## User Interface States

### Eligibility

`Resolve with AI` is visible only when the selected preparation session:

- has state and classification `conflict`;
- is retained;
- has a non-null Integration Worktree and integration branch;
- has no completed child resolver workflow.

### Setup

The setup dialog contains agent, model, reasoning, optional instructions, and
an ordered verification-command editor. It handles missing installations,
model loading, empty models, invalid commands, and unavailable Integration
Worktrees explicitly.

### Active attempt

The panel shows agent status, messages, reasoning summaries already exposed by
the adapters, tool activity, permission cards, current file changes, and a
single `Stop agent` action. Permanent/global permission grants are not offered
from the resolver flow.

### Verification

Commands display queued/running/passed/failed/cancelled states, duration, and a
bounded output summary. Failure presents `Retry resolution` and
`Run verification again`; commit controls are absent.

### Commit and push

The UI renders approval actions only in their exact eligible states. Dialogs
cannot be bypassed with generic workspace Git controls. After push, the panel
offers pull-request creation and displays the resulting URL.

### Recovery and errors

Recoverable states retain the Integration Worktree and expose a focused retry.
Integrity violations show what changed without leaking sensitive absolute
paths. No UI fabricates completion progress; it reports persisted stages and
real command/agent events only.

## Restart and Idempotency

On application startup the orchestrator reconciles non-terminal resolver
records:

- active adapter sessions are queried and projected again;
- missing or stopped adapter sessions become `resolution_stopped` or
  `verification_required` based on current changes;
- interrupted verification results become cancelled and require a new run;
- an interrupted commit is reconciled by matching parent HEAD, commit content,
  and recorded fingerprint;
- an interrupted push is reconciled against the exact remote branch SHA;
- mismatches never trigger automatic retry of a mutating operation.

Commit, push, and PR creation use operation IDs and expected SHAs so duplicate
IPC delivery cannot repeat or broaden a mutation.

## Error Handling

- Invalid parent sessions, missing Integration Worktrees, stale paths, changed
  target refs, and missing agent installations reject before process startup.
- Agent startup, streaming, permission, and abort failures preserve diagnostic
  context and a recoverable workflow where safe.
- Verification timeouts and cancellations are recorded per command and block
  commit.
- Commit failure retains the verified worktree but requires integrity
  reconciliation before another approval.
- Push failure returns to `awaiting_push_approval` only when local SHA and
  remote state remain safe; otherwise it becomes `failed`.
- PR failure leaves the successfully pushed branch intact and permits an
  explicit retry.
- Secrets, tokens, private paths, and raw environment values are redacted from
  logs, persistence, events, and renderer errors.

## Testing Strategy

### Unit tests

- resolver state transitions and invalid transitions;
- eligibility and prompt assembly;
- model/reasoning validation;
- command parsing, ordering, cancellation, and forbidden patterns;
- path ownership, ref fingerprinting, and approval invalidation;
- renderer view-model and control eligibility.

### Repository tests

- Drizzle bootstrap and generated migration behavior;
- transactional creation and updates;
- immutable attempts/results/approvals;
- restart reconstruction and audit ordering.

### Service and integration tests

- fake Codex/OpenCode runtimes for start, stream, permission, abort, retry, and
  reconciliation;
- temporary Git repositories for resolved marker detection, hard verification
  gate, approved commit, exact-SHA push, forbidden target push, and restart
  idempotency;
- verification processes with success, failure, timeout, cancellation, output
  bounds, and attempted Git mutation;
- GitHub service delegation for the fixed integration-head/target-base PR.

### IPC and preload tests

- schema validation and sanitization for every capability;
- thin handler delegation;
- parsed responses and event subscription cleanup;
- rejection of stale fingerprints, invalid states, paths, commands, branches,
  and SHAs.

### Renderer tests

- eligibility and setup states;
- reuse of model/reasoning picker behavior;
- editable/reorderable verification configuration;
- live agent activity, permission response, stop, and retry;
- hard blocking after failed verification;
- separate commit and push dialogs;
- invalidation when the diff changes;
- post-push pull-request flow and recovery states.

### Completion gate

Run focused conflict/agent/IPC/renderer suites first, then:

```bash
npm run typecheck
npm run lint
npm test
npm run package
```

Database artifacts are regenerated after schema changes. Manual Electron
verification covers the complete setup, resolution, failure, approval, push,
and PR workflow against disposable local/remote fixture repositories.

## Non-Goals

- AI-based conflict detection or risk classification;
- resolution of `review_required` semantic overlaps;
- multiple competing resolver agents or voting;
- autonomous commit, push, PR creation, merge, or target-branch update;
- force push, automatic merge, rebase, cherry-pick, or branch deletion;
- verification bypasses;
- arbitrary shell pipelines or unrestricted network commands;
- editing either original participant worktree;
- automatic cleanup of a retained Integration Worktree after push or PR.

## Future Extensions

After the supervised single-agent flow is proven, separate designs may add:

- semantic `review_required` resolution;
- alternative proposals from multiple agents;
- repository-level verification presets and policies;
- richer test-result parsing;
- automated PR review feedback loops;
- approved cleanup and archival policies.
