# Worktree Resource Assignment Coordinator

Status: approved by HITL for #66; consolidated under #57  
Parent: #57  
Scope: main-process orchestration only

## Purpose

`WorktreeResourceAssignmentService` is the sole coordinator for changing which validated Resources are assigned to a Worktree. It serializes desired-state mutation, provider preparation, runtime application, rollback, recovery, and prompt admission without taking ownership of Capability or Skill installation/security policy.

Its contract is deliberately deeper than a collection of IPC handlers:

- callers submit complete desired Resource sets, never imperative enable/disable commands;
- the service owns one revisioned state machine and admission gate per Worktree;
- Capability and Skill subsystems expose narrow preparation/application ports;
- provider runtimes expose generation-scoped verification, not mutable global catalogs;
- renderer code observes projections and events but cannot bypass admission.

## Ownership boundaries

### Coordinator owns

- worktree Assignment desired revision and immutable generation identity;
- serialized/coalesced reconciliation;
- the writer-preferring Worktree admission gate;
- participant discovery for currently live compatible runtimes;
- apply, verification, rollback, and recovery sequencing;
- runtime Assignment attestations;
- user-visible Assignment phase and structured failure category;
- optimistic concurrency and revisioned change events.

### Capability subsystem owns

- installation/package verification and Resource identity;
- settings validation and secret resolution;
- immutable Capability runtime descriptors;
- Capability Host lifecycle and exact active-tool verification;
- Capability invocation evidence.

### Skill subsystem owns

- installation and content digest verification;
- immutable provider projections and collision checks;
- consent/permission digest validation;
- provider/version Managed Skill qualification;
- exact catalog/command/native-channel verification;
- Skill usage evidence.

### Worktree Runtime manager owns

- one runtime per `(agentKind, worktreeId)`;
- runtime generation, process ownership, leases, startup limits and LRU capacity;
- one-active-turn scheduling, session identity registration and event routing;
- targeted shutdown and crash/wake recovery.

The coordinator asks these owners to prepare and attest; it never duplicates their validation or mutates provider internals directly.

## Identities and generations

Only revisions, ordinals, and projection/event sequences are monotonically increasing 64-bit integers represented across IPC as decimal strings. Assignment/desired and catalog generations are content-addressed text identities; runtime generation and attempt IDs are opaque text identities.

- `assignmentRevision`: optimistic-concurrency revision of the Worktree aggregate. Every accepted desired-state mutation increments it, including cancellation/reversion.
- `desiredGeneration`: content address of the complete desired set, including exact Resource IDs, pinned versions/content digests, installation consent/permission digests, and relevant provider qualification fixture versions. Equal sets produce equal generation identities.
- `attemptId`: opaque identifier for one reconciliation attempt. Retries use a new attempt ID but the same desired generation unless desired state changed.
- `verifiedGeneration`: most recent desired generation whose static plans were verified, all live compatible participants applied and attested, and durable commit completed.
- `runtimeGeneration`: opaque text identity of one owned provider process generation.
- `catalogGeneration`: content-addressed persisted identity of one provider/version/adapter-specific effective projection derived from an Assignment generation.
- `runtimeAttestation`: `(agentKind, worktreeId, runtimeGeneration, verifiedGeneration, catalogGeneration, providerVersion, effectiveStateDigest)`.

`desiredGeneration === verifiedGeneration` means the Assignment aggregate is stable. It does not allow a newly started runtime to skip runtime-local verification. A runtime must hold a matching attestation before session create/resume/turn admission.

A Resource version update always changes the desired generation. Assignment identity never floats to “latest installed.”

## Durable aggregate phases

| Phase | Meaning | Prompt admission |
|---|---|---|
| `reconciling` | Startup has not yet proved whether the last attempt committed or rolled back. | Closed |
| `stable` | Desired and verified generations match; no pending attempt. | Open only to runtimes with matching attestations |
| `waiting_for_idle` | A target generation is queued; existing activity is draining. | New turn/session/resume admission closed; control lane open |
| `applying` | Immutable target is being staged, activated, and verified under exclusive admission. | Closed |
| `rolling_back` | A failed attempt is restoring the prior verified generation. | Closed |
| `failed_rolled_back` | Rollback was fully verified; desired differs from verified and awaits retry, replacement, or cancellation. | Open on the prior verified generation only |
| `recovery_required` | Current provider/runtime state cannot be proven equal to either target or prior generation. | Closed |
| `removing` | Worktree teardown owns the gate and is draining/terminating runtimes. | Closed permanently |

`removed` is terminal tombstone behavior, not an active aggregate row.

Transient queue position, blockers, progress step, and retry deadline are projected but are not separate durable phases. `Applying` is never rendered as Enabled.

## Transition table

Only the following phase transitions are valid:

| From | Event/guard | To |
|---|---|---|
| absent | aggregate loaded | `reconciling` |
| `reconciling` | durable verified commit; desired equals verified | `stable` |
| `reconciling` | no ambiguous side effect; unapplied desired target exists | `waiting_for_idle` |
| `reconciling` | latest desired attempt failed and prior rollback is verified | `failed_rolled_back` |
| `reconciling` | target/prior effective state cannot be proven | `recovery_required` |
| `stable` | valid differing desired set persisted | `waiting_for_idle` |
| `waiting_for_idle` | newer desired set or cancellation persisted before side effects | `waiting_for_idle`, or `stable` when it now equals verified |
| `waiting_for_idle` | prepare succeeds, stable-idle holds, exclusive gate acquired | `applying` |
| `waiting_for_idle` | side-effect-free preparation fails | `failed_rolled_back` |
| `applying` | every participant attests and durable commit succeeds | `stable` |
| `applying` | failure after any participant stages | `rolling_back` |
| `applying` | failure before any participant stages | `failed_rolled_back` |
| `rolling_back` | every affected participant attests prior generation | `failed_rolled_back` |
| `rolling_back` | restoration or durable result is ambiguous | `recovery_required` |
| `failed_rolled_back` | retry requested or differing desired set persisted | `waiting_for_idle` |
| `failed_rolled_back` | desired reverted to verified | `stable` |
| `recovery_required` | recovery proves desired generation and commits it | `stable` |
| `recovery_required` | recovery proves prior generation; desired differs | `failed_rolled_back` |
| `recovery_required` | recovery proves prior generation; desired equals prior | `stable` |
| any nonterminal phase | Worktree removal begins | `removing` |
| `removing` | teardown transaction commits | terminal removed/tombstone |

No direct `applying → waiting_for_idle`, `rolling_back → applying`, or `recovery_required → applying` transition is allowed. A new target observed during an immutable attempt waits until that attempt reaches a proven stable/failed result. Recovery first establishes one known generation; applying desired state is a separate attempt.

Lazy runtime join uses a scoped `runtime_join` attempt against the already verified generation. It takes exclusive admission and may project `applying` while that provider is verified, but it does not change desired/verified generations. A clean new runtime that fails before activation is terminated and reported `runtime_unavailable`; the Worktree returns to `stable` for already-attested participants. Any ambiguous divergence enters `recovery_required`.

## Resource projection

Assignment phase and per-Resource/provider availability are separate dimensions.

For each desired Resource and provider, project exactly one availability:

- `pending`: desired but not in the verified generation;
- `enabled`: included in the verified generation and, for a live runtime, covered by a matching runtime attestation;
- `unavailable`: provider/version incompatibility was declared before apply;
- `setup_required`: cannot enter desired state; mutation validation rejects it;
- `failed`: target apply failed and was rolled back;
- `recovery_required`: effective state is unknown.

A declared incompatible provider is excluded from apply participants and does not fail an otherwise valid generation. Explicit use on that provider is rejected before provider submission with `resource_unavailable`. Product release gates may still prohibit shipping provider-asymmetric availability.

## Admission gate

Each Worktree has a writer-preferring asynchronous read/write gate.

### Normal shared admission

These operations acquire a shared admission lease and recheck generation/attestation after acquisition:

- create provider session;
- resume/fork a provider session;
- submit a turn or queued follow-up;
- begin an approval-dependent continuation;
- start/recreate a runtime for provider work.

A turn lease remains held through provider pending, tool execution, permission waiting, aborting, terminal provider event, durable event drain, and final idleness publication. Merely viewing or retaining an idle persisted session holds no lease.

Once an Assignment writer is queued, no new normal shared leases are granted. Existing leases drain. This prevents prompt traffic from starving Assignment changes.

### Exclusive admission

Assignment apply, recovery, startup reconciliation, runtime Assignment verification, and Worktree removal acquire the exclusive lease. Runtime verification performed as part of lazy startup may release exclusivity only after its attestation is durably registered.

### Control lane

While a writer waits or owns the gate, a narrow control lane remains available for operations that can make the Worktree safer or idle:

- abort an existing turn;
- reject or answer an existing permission request;
- cancel a not-yet-started queued Assignment target;
- request stop of an owned blocking runtime;
- inspect blockers/progress;
- invoke an allowed recovery action.

The control lane cannot create/resume sessions, submit prompts, invoke Resources, approve a new Assignment generation, or mutate provider catalogs. Permission approval may continue the existing turn and therefore keep the Assignment queued; the UI states this explicitly.

## Stable idleness

A Worktree is stable-idle only when, under the admission and runtime lifecycle locks:

- no active or provider-pending turn exists;
- no permission request or elicitation is outstanding;
- no abort is in progress;
- no queued provider follow-up is owned by a session;
- no session create/resume/reconciliation is in progress;
- no runtime start/stop/restart or event drain is in progress;
- every participant reports the same terminal status twice around one event-loop checkpoint;
- the participant set and runtime generations are unchanged across that recheck.

Any change restarts the wait. There is no destructive timeout. The queue exposes blockers and elapsed wait; users may cancel the pending change or stop a blocking owned agent.

## Desired-state mutation and coalescing

`setDesiredResources(worktreeId, completeSet, expectedRevision)` performs:

1. validate worktree existence and expected revision;
2. resolve exact installed Resource identities through owner ports;
3. reject missing, invalid, blocked, unsupported, setup-required, ambiguous, colliding, or unconsented entries;
4. construct and persist the immutable desired generation and incremented revision;
5. emit `assignment.changed` with that revision;
6. schedule reconciliation.

A stale revision fails as `assignment_conflict` and includes the current safe projection; it never merges silently.

Coalescing rules:

- before side effects begin, only the newest desired revision is the target;
- superseded generations remain audit/history facts but are never applied;
- once `applying` starts, its target is immutable through verification or rollback;
- mutations accepted during apply become one coalesced next target and cannot alter the in-flight attempt;
- after a verified commit or verified rollback, the newest differing desired generation is scheduled;
- identical complete sets are idempotent: no revision or attempt is created.

Cancellation before apply is a new optimistic mutation restoring the last verified complete set. It increments revision and coalesces normally. There is no deletion or revision rewind. Once side effects begin, “cancel Assignment change” is unavailable; the current attempt must commit or roll back.

## Prepare/apply protocol

### 1. Prepare without provider side effects

For the immutable target, Capability and Skill ports return prepared slices containing:

- exact Resource identity/version/content/permission digests;
- immutable artifacts/projections;
- provider compatibility/qualification result;
- expected effective-state digest per compatible provider;
- reversible apply plan and prior-generation requirements;
- sanitized failure category.

Preparation revalidates installation state immediately before apply. It never starts a provider solely because an Assignment changed.

If preparation fails, no runtime side effect occurred. The aggregate enters `failed_rolled_back` with the prior verified generation still active. “Rolled back” here means no provider mutation was required.

### 2. Queue and drain

The writer is queued, normal admission closes, and the service waits for stable idleness. It acquires Assignment runtime leases so capacity eviction cannot remove participants during the operation.

### 3. Freeze participants

Under exclusive admission and lifecycle locks, capture all currently live compatible `(agentKind, runtimeGeneration)` participants. Recheck target revision, prepared artifact digests, qualification, permission consent, idleness, and participant generations.

A newer desired revision before the first side effect discards this attempt and prepares the newest target. A changed participant or artifact restarts preparation.

No provider process is launched only to participate. Zero live participants is valid: static plans can commit, while every future runtime must verify before admission.

### 4. Stage

Each participant stages the complete provider-specific target without making it available to a turn. Staging may create immutable config/projection files or a replacement runtime generation, but admission remains closed. Stage in deterministic `(agentKind, runtimeGeneration)` order and record which participants accepted.

A provider without a stage/activate boundary must create a replacement runtime generation while the prior generation remains the rollback candidate. If it cannot preserve a verified rollback candidate, the provider/version is unqualified.

### 5. Activate and verify

Activate staged plans in deterministic order. No session can observe partial activation because the exclusive gate remains held. Each participant must return an exact attestation matching target generation, provider version, expected catalog/tool identities, content digests, permissions, and effective-state digest.

Unexpected entries, missing entries, transformed-name collisions, stale callbacks, version changes, watcher drift, process exits, or unverifiable responses fail the attempt.

### 6. Durable commit

In one database transaction:

- set `verifiedGeneration = target`;
- mark the attempt verified;
- persist all participant attestations;
- clear prior failure/recovery metadata;
- enqueue one revisioned outbox event.

After commit, update in-memory state, publish the event, and release exclusive admission. Event publication may retry from the outbox; it cannot undo the committed generation.

## Failure and rollback

Any failure after the first stage begins immediately enters `rolling_back`; the same target is not automatically retried.

Rollback rules:

1. close admission and retain all operation/runtime leases;
2. restore every participant that staged or activated, in reverse acceptance order, to its captured prior verified generation;
3. verify exact prior effective-state digests and runtime generations;
4. invalidate target attestations and discard staged artifacts not referenced elsewhere;
5. durably record the failed attempt and rollback result.

If every affected participant verifies the prior generation, enter `failed_rolled_back`. The desired target remains visible as failed while prompts may use only the prior verified generation. Explicit invocation of desired-only Resources is rejected before provider submission.

If any participant cannot be restored and verified—including crash, timeout, ambiguous provider response, missing rollback artifact, stale runtime generation, or persistence failure after activation—enter `recovery_required`. Terminate only affected owned runtime trees after the configured graceful deadline. Never claim the prior or target generation is Enabled.

Unrelated Worktrees and nonparticipant providers are unaffected.

## Retry policy

- Validation/configuration errors do not retry automatically.
- Stable-idle waiting has no timeout and is not a retry.
- Side-effect-free provider startup/handshake may use the runtime manager's approved three attempts in ten minutes with 1s/3s/10s backoff.
- No stage, activation, verification, rollback, or ambiguous persistence failure is automatically repeated.
- `Retry apply` requires the current expected revision, creates a new attempt ID for the same desired generation, and reruns preparation from source.
- A new desired mutation supersedes a failed target and schedules normally.
- Runtime unavailable after startup exhaustion requires manual retry.

This avoids repeating non-idempotent provider operations while permitting bounded retry before provider mutation.

## Recovery required

Allowed actions are capability-based, not generic commands:

### `retry_recovery`

Reinspect durable attempt data and owned runtime state. If exact target or prior state can be proven, commit that result; otherwise recreate affected runtimes from the last verified generation and verify before reopening admission.

### `recreate_affected_runtimes`

Terminate only tracked affected process trees, create fresh runtime generations lazily or immediately as required for recovery, apply the last verified generation, and attest. Desired state is not silently changed. If desired still differs, a separate explicit `Retry apply` follows.

### `revert_desired`

Optimistic mutation setting desired equal to the last verified generation. It cannot itself reopen admission until runtime recovery proves that generation.

Recovery actions are serialized under the same exclusive gate. Failure remains `recovery_required`; there is no best-effort opening.

## Startup reconciliation

Before any Worktree prompt admission:

1. load desired/verified generations, latest attempt, attestations, and outbox state;
2. if no in-flight/ambiguous attempt exists, enter `stable` when generations match, `failed_rolled_back` only when the latest desired attempt has a durably verified failure/rollback, or `waiting_for_idle` for an unapplied desired target;
3. if the durable commit proves target verification, restore `stable` and republish missing events;
4. if records prove no activation or fully verified rollback, restore the corresponding safe phase;
5. otherwise enter `recovery_required`;
6. invalidate attestations for provider/runtime generations that no longer exist;
7. require lazy runtimes to reapply and attest before their first admitted operation.

Startup never infers completion from files, process presence, timestamps, desired equality alone, or renderer state.

## Runtime crash, wake, and version change

- Crash during an active turn marks that turn Interrupted through the runtime manager and invalidates its Assignment attestation.
- Crash while idle does not change the Worktree's verified generation; a replacement runtime must verify it before admission.
- Crash during apply/rollback causes rollback if exact restoration remains provable, otherwise `recovery_required`.
- Machine wake invalidates runtime health and attestations until re-handshake.
- Provider/app version change drains idle generations and requires provider requalification before new attestations.
- Events with stale runtime or Assignment generations are quarantined and never update UI state.

## Resource update, uninstall, and Worktree removal

A Resource update uses the durable `resource_distribution_operations` parent and frozen Worktree participants defined by the persistence specification. The distribution coordinator creates the parent intent and Resource-level mutation barrier before side effects, computes provisional participants, and queues affected Worktree writers in stable Worktree-ID order. Mutations already ahead may complete; writes that add/re-pin the affected Resource fail `resource_update_pending`, while removals may shrink the provisional set. As writers queue/enter, the coordinator emits projection-sequenced `waiting_for_idle` state without changing revision or desired/verified generations. Under held gates it repeatedly refreshes membership/revisions/targets until the authoritative affected set matches the gates, then atomically freezes participants, requires desired equal verified with no other pending attempt, and stages/activates/verifies linked child attempts. Child readiness is not a commit. Until global commit, each aggregate retains its prior desired/verified generation and revision behind the held gate. One database transaction records the parent global commit decision, increments every affected Worktree revision exactly once, sets desired and verified to its target generation, and updates every aggregate/attestation/outbox projection, or none.

Any pre-commit failure records the parent rollback decision and restores every affected Worktree in reverse order before releasing its gate. Crash recovery follows the durable parent decision and participant boundaries; an orphan child or ambiguous effect enters recovery rather than guessing. Desired mutations and Worktree removal queue behind a frozen participant. A changed target version supersedes a pre-effect parent; explicit pre-effect cancellation cancels it. Both restore distribution-only waiting projections, remove the barrier, and release gates without revision changes before a replacement may start. Unrecoverable rollback closes only divergent Worktrees, but the update is globally failed.

Uninstall uses the same global journal with a null target Resource version and is permitted only after every affected Worktree removal commits globally. Installation content remains until no desired, verified, rollback, activity/evidence-retention, distribution, or in-flight reference exists.

Worktree removal:

1. mark `removing` and permanently close admission;
2. cancel queued not-started targets;
3. abort/drain active owned work according to explicit removal UX;
4. terminate tracked runtimes;
5. in one removal transaction explicitly delete the Worktree activity/evidence/session-route/coverage subtree first, then delete the Worktree so Assignment state, catalog generations, attestations, and remaining children cascade without retained-lineage restrictions;
6. preserve only installation-level immutable Resource identities still referenced outside this Worktree; no Worktree-scoped activity/evidence/route/coverage record survives deletion;
7. emit terminal Worktree events and remove the gate.

## Service interface

Conceptual main-process interface:

```ts
interface WorktreeResourceAssignmentService {
  get(worktreeId: string): Promise<AssignmentProjection>;
  setDesired(input: {
    worktreeId: string;
    expectedRevision: string;
    resources: readonly AssignedResourceIdentity[];
  }): Promise<AssignmentProjection>;
  retryApply(input: { worktreeId: string; expectedRevision: string }): Promise<AssignmentProjection>;
  cancelPending(input: { worktreeId: string; expectedRevision: string }): Promise<AssignmentProjection>;
  recover(input: {
    worktreeId: string;
    expectedRevision: string;
    action: "retry_recovery" | "recreate_affected_runtimes" | "revert_desired";
  }): Promise<AssignmentProjection>;
  withSessionAdmission<T>(request: SessionAdmissionRequest, operation: (lease: AdmissionLease) => Promise<T>): Promise<T>;
  withTurnAdmission<T>(request: TurnAdmissionRequest, operation: (lease: AdmissionLease) => Promise<T>): Promise<T>;
  reconcileStartup(): Promise<void>;
  removeWorktree(worktreeId: string): Promise<void>;
  subscribe(listener: (event: AssignmentChangedEvent) => void): () => void;
}
```

IPC handlers call this service; coding-agent session methods receive admission leases through an injected port. No renderer-provided provider path, generation, attestation, qualification, or effective-state digest is trusted.

## Structured errors

- `assignment_conflict`
- `assignment_invalid_resource`
- `assignment_setup_required`
- `assignment_waiting_for_idle`
- `assignment_apply_failed`
- `assignment_recovery_required`
- `resource_unavailable`
- `resource_update_pending`
- `runtime_unavailable`
- `worktree_removing`
- `operation_cancelled`

Errors expose stable codes, safe user messages, current revision/phase, and allowed actions. `resource_update_pending` is returned only when a complete-set write adds or re-pins the Resource currently owned by a distribution barrier; it is retryable after that parent becomes terminal, includes the current safe projection, and does not reject a write whose only change to that Resource is removal. Internal logs retain sanitized causal chains without prompts, outputs, credentials, Skill bodies, private paths, provider session IDs, or authorization material.

## Required tests

### Model/state tests

- every phase/command transition and invalid transition;
- optimistic conflict and idempotent complete-set mutation;
- coalescing before apply and immutable in-flight target;
- cancellation as revisioned reversion;
- writer preference and control-lane restrictions;
- stable-idle double check and participant-generation change;
- zero-live-runtime commit plus lazy attestation;
- declared provider incompatibility;
- failure at every stage/activate/verify/commit/rollback boundary;
- rollback order and `recovery_required` escalation;
- new desired target after verified failure;
- stale runtime/Assignment events.

### Integration tests

- Capability and Skill slices succeed atomically without sharing ownership;
- mixed live Codex/OpenCode participant plans;
- runtime crash and app restart at every durable boundary;
- outbox replay after commit-before-publish crash;
- update across multiple Worktrees with global rollback;
- uninstall precondition and Worktree removal;
- prompt/session/resume operations cannot cross a queued writer;
- abort/permission response can drain a blocker through the control lane.

### Real-provider qualification

For every supported provider version, verify exact full-set application, no partial turn observation, rollback, restart/resume, runtime attestation, catalog/tool drift closure, targeted cancellation, and sanitized diagnostics. Provider fixtures are release gates, not optional smoke tests.

## Implementation order

1. persistence/outbox/attempt model from #67;
2. pure state reducer and invariant/property tests;
3. writer-preferring admission gate and deterministic scheduler;
4. Capability/Skill preparation ports;
5. runtime Assignment apply/attestation port;
6. coordinator orchestration and crash injection tests;
7. session service integration at create/resume/turn boundaries;
8. IPC and composer projections from #68;
9. pinned real-provider qualification suites.
