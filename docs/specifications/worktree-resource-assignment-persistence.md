# Worktree Resource Assignment persistence and migration

Status: approved by HITL for #67; consolidated and cross-document aligned under #57  
Parent: #57  
Depends on: approved coordinator state machine in #66

## Goals

Persist enough information to:

- distinguish desired, verified, failed, and recovery-required Assignment state;
- reconstruct or reject an interrupted coordinator attempt without inference;
- pin every Resource version/content/security/configuration identity;
- verify each live runtime generation before provider admission;
- publish every renderer-visible transition in projection-sequence order exactly once logically through an outbox;
- persist one global commit/rollback decision for cross-Worktree Resource update and uninstall;
- migrate current session-scoped Capability state by Worktree union;
- assign currently usable installed Skills to every existing Worktree;
- preserve legacy session history and support transactional retry/rollback.

The database does not persist prompts, outputs, Skill bodies, Capability settings, secret references, credentials, authorization headers, private paths, provider session identifiers, or raw provider events in Assignment tables.

## SQLite conventions

- Foreign keys remain enabled.
- Timestamps are UTC epoch milliseconds.
- Public optimistic revisions, projection sequences, activity stream sequences, and ordinals are non-negative SQLite integers and cross IPC as decimal strings.
- IDs are opaque UUIDs except content-addressed IDs/digests.
- SHA-256 values use lowercase `sha256:<64 hex>` encoding and domain-separated canonical JSON inputs.
- Enum columns have database `CHECK` constraints in addition to TypeScript schemas.
- JSON is permitted only for a versioned, safe outbox projection; core Assignment state is normalized.
- Every state-changing repository method uses `BEGIN IMMEDIATE` and validates affected-row counts.
- Application code never relies on row insertion order, `rowid`, timestamps, or nullable equality for identity.

## Normalized schema

Names below are normative. Exact Drizzle property casing may follow repository conventions.

### `resource_versions`

Immutable identity for an installable Resource version. Historical rows survive uninstall while referenced.

| Column | Type | Rules |
|---|---|---|
| `id` | text | PK; content-addressed identity |
| `resource_kind` | text | `CHECK IN ('capability','skill')` |
| `resource_id` | text | stable application Resource ID |
| `version` | text | exact installed version |
| `content_digest` | text | non-null SHA-256 |
| `security_digest` | text | non-null SHA-256 of permissions/policy surface |
| `created_at` | integer | non-null |

Unique: `(resource_kind, resource_id, version, content_digest, security_digest)`.

`security_digest` is Capability permission digest or the canonical Skill policy/permission digest. It contains no policy body. Capability package content comes from `managed_package_installations.active_content_digest` or a canonical bundled artifact descriptor. Skill content comes from `skill_installations.content_digest`.

Current installation rows remain installation owners. Update/install code inserts a new immutable `resource_versions` row and points new Assignment generations at it; it never rewrites an existing version row.

### `worktree_assignment_generations`

Immutable complete Resource-set generation.

| Column | Type | Rules |
|---|---|---|
| `id` | text | PK; content-addressed generation identity |
| `worktree_id` | text | FK `worktrees(id) ON DELETE CASCADE` |
| `ordinal` | integer | non-negative |
| `resource_set_digest` | text | non-null SHA-256; equals `id` payload digest |
| `migration_key` | text nullable | provenance only, never authorization |
| `created_at` | integer | non-null |

Unique: `(worktree_id, ordinal)` and `(worktree_id, resource_set_digest)`.

The generation digest covers sorted generation resources and provider projections. It excludes timestamps, worktree path, display metadata, mutable installation state, and secret values. Identical complete sets in one Worktree reuse the existing generation row.

### `worktree_assignment_generation_resources`

One pinned Resource member of one generation.

| Column | Type | Rules |
|---|---|---|
| `id` | text | PK; content address of generation/member tuple |
| `generation_id` | text | FK generation `ON DELETE CASCADE` |
| `resource_version_id` | text | FK `resource_versions(id) ON DELETE RESTRICT` |
| `configuration_digest` | text | non-null SHA-256 |
| `invocation_policy_digest` | text | non-null SHA-256 |

Unique: `(generation_id, resource_version_id)`.

`configuration_digest` hashes canonical effective installation-scoped configuration in memory. It stores no settings, private paths, secret values, or secret references. Skill entries use a canonical “no configuration” digest unless a future in-scope setting is introduced. `invocation_policy_digest` captures explicit/automatic policy and accepted consent identity without storing instructions.

### `worktree_assignment_generation_resource_providers`

Version-qualified provider projection for each Resource member.

| Column | Type | Rules |
|---|---|---|
| `generation_resource_id` | text | FK generation resource `ON DELETE CASCADE` |
| `agent_kind` | text | supported provider kind |
| `availability` | text | `CHECK IN ('compatible','unavailable')` |
| `qualification_digest` | text | non-null SHA-256 of reviewed provider/version fixture contract |
| `expected_state_digest` | text | non-null SHA-256 of safe effective provider projection |

Primary key: `(generation_resource_id, agent_kind)`.

Every supported provider receives a row, including declared incompatibility. Missing provider rows make the generation invalid. The qualification digest changes when provider version or reviewed fixture changes and therefore creates a new generation.

### `worktree_runtime_catalog_generations`

Immutable provider-specific effective catalog/projection identity used by runtime attestation and activity replay.

| Column | Type | Rules |
|---|---|---|
| `id` | text | PK; content-addressed `sha256:` identity |
| `worktree_id` | text | FK Worktree `ON DELETE CASCADE` |
| `agent_kind` | text | supported provider kind |
| `assignment_generation_id` | text | FK Assignment generation `ON DELETE RESTRICT` |
| `provider_version` | text | exact provider binary version |
| `adapter_contract_version` | integer | positive parser/projection contract version |
| `projection_digest` | text | digest of sorted exact provider projection and qualification identities |
| `created_at` | integer | non-null |

Unique: `(worktree_id, agent_kind, assignment_generation_id, provider_version, adapter_contract_version, projection_digest)`.

This row is not the mutable provider catalog. It is the immutable lineage identity prepared from one Assignment generation for one exact provider/adapter contract. The digest covers transformed server/tool mappings, private Skill projection identities, collision decisions, provider fixture qualification, and baseline effective-state identity without storing bodies, paths, settings, or secrets. Stage/attest and activity observations reference its `id`. It remains retained while an attempt, attestation, session route, activity, or evidence-retention row references it.

### `worktree_assignments`

One mutable coordinator aggregate per Worktree.

| Column | Type | Rules |
|---|---|---|
| `worktree_id` | text | PK, FK `worktrees(id) ON DELETE CASCADE` |
| `revision` | integer | non-negative optimistic desired-set revision |
| `projection_sequence` | integer | non-negative; increments on every committed renderer-visible projection change |
| `phase` | text | coordinator phase check |
| `desired_generation_id` | text | FK generation `ON DELETE RESTRICT` |
| `verified_generation_id` | text nullable | FK generation `ON DELETE RESTRICT` |
| `failure_code` | text nullable | allowlisted structured code |
| `created_at` | integer | non-null |
| `updated_at` | integer | non-null |

Allowed phases: `reconciling`, `stable`, `waiting_for_idle`, `applying`, `rolling_back`, `failed_rolled_back`, `recovery_required`, `removing`.

Repository invariants checked in every transaction:

- desired and verified generations belong to the same Worktree as the aggregate;
- `stable` requires desired equals verified;
- `failed_rolled_back` requires non-null verified and desired differs;
- `recovery_required` may retain either/both generation references but never implies Enabled;
- `failure_code` is null in `stable`;
- revision increments exactly once per accepted non-idempotent desired mutation, not per apply attempt;
- projection sequence increments exactly once in every transaction that changes renderer-visible phase, progress, blockers, admission, failure, allowed actions, or Resource status, including desired mutation, attempt progress, commit, rollback, recovery, and removal.

Cross-row invariants cannot be expressed safely as SQLite `CHECK`s and are verified by repository code plus tests.

### `resource_distribution_operations`

Durable parent decision for one Resource update/uninstall spanning every affected Worktree.

| Column | Type | Rules |
|---|---|---|
| `id` | text | PK UUID |
| `resource_kind` | text | Capability or Skill |
| `resource_id` | text | stable application Resource ID |
| `target_resource_version_id` | text nullable | FK Resource version `ON DELETE RESTRICT`; null only for uninstall |
| `status` | text | `preparing`, `waiting_for_idle`, `applying`, `commit_pending`, `rolling_back`, `verified`, `failed`, `recovery_required`, `superseded`, `cancelled` |
| `side_effect_boundary` | text | `none`, `gates_acquired`, `staged`, `activated`, `commit_pending` |
| `failure_code` | text nullable | sanitized allowlisted code |
| `started_at` | integer | non-null |
| `updated_at` | integer | non-null |
| `completed_at` | integer nullable | terminal only |

At most one nonterminal distribution operation exists for one `(resource_kind, resource_id)`. The parent status is the sole global commit/rollback decision; independent child attempt completion cannot make a Worktree visible as committed. Parent creation installs a Resource-level mutation barrier: until terminal, Assignment writes may remove the affected Resource but cannot newly add it, re-pin it, or select another version; such writes return `resource_update_pending`.

### `resource_distribution_operation_worktrees`

Frozen participant set and crash evidence for the parent operation.

| Column | Type | Rules |
|---|---|---|
| `operation_id` | text | FK distribution operation `ON DELETE CASCADE` |
| `worktree_id` | text | FK Worktree `ON DELETE CASCADE`; repository removal is rejected/queued while parent is active |
| `apply_order` | integer | stable Worktree-ID lock order |
| `observed_revision` | integer | frozen optimistic revision |
| `prior_generation_id` | text | FK Assignment generation `ON DELETE RESTRICT` |
| `target_generation_id` | text | FK Assignment generation `ON DELETE RESTRICT` |
| `attempt_id` | text nullable | unique FK Worktree attempt `ON DELETE RESTRICT`; null while provisional, required when frozen |
| `state` | text | `planned`, `gate_acquired`, `staged`, `activated`, `commit_ready`, `committed`, `rollback_started`, `rolled_back`, `unknown` |
| `updated_at` | integer | non-null |

Primary key: `(operation_id, worktree_id)`; unique `(operation_id, apply_order)` and `(attempt_id)`. Planned participants may be refreshed only while parent boundary is `none`; the set becomes immutable only after all required writer gates are acquired and the frozen snapshot transaction commits. Worktree removal and desired mutation queue while their frozen participant is nonterminal. After a terminal parent decision, Worktree deletion may cascade its participant row without changing the retained safe parent operation result.

### `worktree_assignment_attempts`

Durable journal for apply, lazy runtime join, recovery, distribution participation, and removal.

| Column | Type | Rules |
|---|---|---|
| `id` | text | PK UUID |
| `worktree_id` | text | FK Worktree `ON DELETE CASCADE` |
| `distribution_operation_id` | text nullable | FK distribution operation `ON DELETE RESTRICT`; required for `resource_update` |
| `kind` | text | `assignment_apply`, `runtime_join`, `recovery`, `resource_update`, `removal` |
| `target_revision` | integer | aggregate revision observed at creation |
| `target_generation_id` | text | FK generation `ON DELETE RESTRICT` |
| `prior_verified_generation_id` | text nullable | FK generation `ON DELETE RESTRICT` |
| `status` | text | attempt status check |
| `side_effect_boundary` | text | `none`, `staged`, `activated`, `commit_pending` |
| `failure_code` | text nullable | sanitized allowlisted code |
| `started_at` | integer | non-null |
| `updated_at` | integer | non-null |
| `completed_at` | integer nullable | terminal only |

Statuses: `preparing`, `waiting_for_idle`, `applying`, `rolling_back`, `verified`, `failed_rolled_back`, `recovery_required`, `superseded`, `cancelled`.

Partial unique index: at most one attempt with active status (`preparing`, `waiting_for_idle`, `applying`, `rolling_back`) per Worktree. Attempts are append-only except legal status/boundary/timestamp transitions. A retry creates a new row.

### `worktree_assignment_attempt_participants`

Recovery evidence for every frozen live runtime participant.

| Column | Type | Rules |
|---|---|---|
| `attempt_id` | text | FK attempt `ON DELETE CASCADE` |
| `agent_kind` | text | provider kind |
| `runtime_generation` | text | opaque owned process generation, not provider session ID |
| `provider_version` | text | exact binary version |
| `prior_catalog_generation_id` | text nullable | FK runtime catalog generation `ON DELETE RESTRICT` |
| `target_catalog_generation_id` | text | FK runtime catalog generation `ON DELETE RESTRICT` |
| `apply_order` | integer | deterministic non-negative order |
| `state` | text | participant state check |
| `prior_effective_state_digest` | text nullable | required after freeze when prior exists |
| `target_effective_state_digest` | text | non-null |
| `updated_at` | integer | non-null |

Primary key: `(attempt_id, agent_kind, runtime_generation)`. Unique `(attempt_id, apply_order)`.

States: `planned`, `staged`, `activated`, `verified`, `rollback_started`, `rolled_back`, `unknown`.

No process PID, executable path, catalog path, auth data, provider session ID, prompt, or provider payload is stored.

### `worktree_runtime_assignment_attestations`

Proof that one live runtime generation may admit provider work for one verified Assignment generation.

| Column | Type | Rules |
|---|---|---|
| `worktree_id` | text | FK Worktree `ON DELETE CASCADE` |
| `agent_kind` | text | provider kind |
| `runtime_generation` | text | opaque generation |
| `assignment_generation_id` | text | FK generation `ON DELETE RESTRICT` |
| `catalog_generation_id` | text | FK runtime catalog generation `ON DELETE RESTRICT` |
| `provider_version` | text | exact version |
| `effective_state_digest` | text | exact safe projection digest |
| `verified_at` | integer | non-null |
| `invalidated_at` | integer nullable | null only while usable |
| `invalidation_code` | text nullable | allowlisted reason |

Primary key: `(worktree_id, agent_kind, runtime_generation)`.

Only a non-invalidated row matching the current verified Assignment generation, exact prepared catalog generation, and runtime manager's current opaque runtime generation can admit work. Attestation rows are evidence, never a source for reconstructing provider state.

### `worktree_assignment_outbox`

Transactional renderer/event publication.

| Column | Type | Rules |
|---|---|---|
| `event_id` | text | PK UUID |
| `worktree_id` | text | FK Worktree `ON DELETE CASCADE` |
| `revision` | integer | aggregate desired-set revision at publication |
| `projection_sequence` | integer | aggregate projection sequence for this exact snapshot |
| `event_type` | text | allowlisted Assignment event |
| `schema_version` | integer | currently `1` |
| `safe_payload_json` | text | validated safe projection only |
| `created_at` | integer | non-null |
| `published_at` | integer nullable | null while pending |

Unique: `(worktree_id, projection_sequence)`. Exactly one full-projection event exists per renderer-visible committed transition. The payload may contain Resource IDs/versions, phase, availability, progress counts, failure code, and allowed actions. It may not contain prohibited data listed in Goals.

Consumers deduplicate by `event_id`; snapshots order by projection sequence. Assignment revision remains only the optimistic desired-set concurrency token. Published rows may be pruned after the documented event-replay retention window, never before all renderer windows can refresh by snapshot.

### `worktree_assignment_migrations`

Idempotent data-cutover journal.

| Column | Type | Rules |
|---|---|---|
| `migration_key` | text | PK, fixed versioned key |
| `status` | text | `pending`, `applying`, `verified`, `failed` |
| `source_fingerprint` | text | SHA-256 of canonical source identities/counts |
| `worktree_count` | integer | expected existing Worktrees |
| `resource_version_count` | integer | expected inserted/reused versions |
| `generation_count` | integer | expected baseline generations |
| `failure_code` | text nullable | safe code |
| `started_at` | integer nullable | |
| `completed_at` | integer nullable | |

No source snapshots or private values are stored. Existing legacy tables are the source of truth until status becomes `verified`.

## Transaction boundaries

### Desired mutation

One `BEGIN IMMEDIATE` transaction:

1. load aggregate and compare `expectedRevision`;
2. insert/reuse immutable Resource version and generation graph;
3. if complete set equals current desired, return idempotently without revision/event;
4. increment revision and set desired generation/phase;
5. insert attempt when reconciliation should start;
6. increment projection sequence and insert its one full-projection outbox event;
7. commit.

No provider operation occurs inside a database transaction.

### Attempt progress

Every stage boundary uses a short transaction that checks attempt status, aggregate revision/generation, and participant runtime generation before advancing exactly one legal state. When the transition changes the renderer projection, the same transaction increments projection sequence and inserts its full-projection outbox event. Participant state is written before/after provider operations according to the coordinator write-ahead protocol:

- record `planned` before stage;
- record `staged` only after positive stage acknowledgement;
- record `activated` only after positive activation acknowledgement;
- record `verified` only after exact attestation;
- set attempt boundary `commit_pending` before the final verified commit.

A crash between provider effect and its acknowledgement/write is intentionally ambiguous and reconciles to `recovery_required`, never guessed.

### Verified commit

One transaction checks every required participant is verified, then:

- update aggregate verified generation and `stable` phase;
- insert/replace matching runtime attestations;
- mark attempt `verified` and terminal;
- clear safe failure metadata;
- increment projection sequence and insert its full-projection outbox event.

### Verified rollback

One transaction checks every affected participant is `rolled_back`, then:

- retain prior verified generation;
- set `failed_rolled_back` (or `stable` when desired was explicitly reverted);
- mark attempt terminal with failure code;
- invalidate target attestations;
- increment projection sequence and insert its full-projection outbox event.

### Recovery required

One transaction marks uncertain participants `unknown`, aggregate and attempt `recovery_required`, invalidates all affected runtime attestations, increments projection sequence, and inserts its full-projection event. Runtime termination follows through the owned runtime manager; inability to terminate does not reopen admission.

### Global Resource distribution

1. Insert the parent intent, install its Resource-level mutation barrier, compute a provisional affected-Worktree set, and insert `planned` participant rows with null attempt IDs. Emit safe per-Worktree projection-sequence events for the pending Resource operation; this set is not frozen and no provider side effect is allowed.
2. Queue/acquire candidate Worktree writers in stable Worktree-ID order. Ordinary mutations already ahead of a writer may complete; mutations behind it wait. When a distribution writer owns/queues the Worktree gate, project `waiting_for_idle` with an ordered outbox event without changing desired/verified generation or revision. Require each candidate's prior aggregate to have desired equal verified and no other active/pending attempt.
3. Before any provider side effect, recompute affected membership from authoritative Assignments under the barrier. Deleted Worktrees and Worktrees that removed the Resource leave the provisional set; no Worktree can newly add/re-pin it while the barrier exists. Refresh planned participants/revisions/target generations atomically, acquire any still-required gates, and repeat until the authoritative set and held gates match. Then one transaction rechecks all stable revisions, marks every participant `gate_acquired`, records parent `gates_acquired`, and freezes the set. Create linked `resource_update` attempts only for that frozen snapshot. A changed target installation/version supersedes the parent and requires a new parent; explicit cancellation before effects marks it cancelled. Both transactionally return any distribution-only `waiting_for_idle` projections to prior `stable`, increment projection sequences/outbox events, remove the Resource barrier, and release gates. Neither case changes Assignment revisions.
4. Stage/activate/verify every child while gates remain held. Child state is write-ahead evidence only; no aggregate verified generation changes yet.
5. When all children are `commit_ready`, a short write-ahead transaction rechecks them and persists parent `commit_pending`/side-effect boundary without changing aggregates. Then one `BEGIN IMMEDIATE` global commit transaction rechecks the parent and every frozen revision/participant, increments every affected Worktree Assignment revision exactly once, sets both desired and verified generation to that Worktree's target, sets phase `stable`, updates attempts/attestations, increments each projection sequence, inserts each full-projection outbox event carrying the new revision, marks participants `committed`, and marks parent `verified`. The global desired-set mutation and verification decision are therefore all-or-none durably.
6. Before the atomic commit, target generations exist only in the parent/child journal; Worktree desired/verified generations and revisions remain prior values while gates prevent mutations. On any pre-commit failure, set parent `rolling_back`, roll activated/staged children back in reverse order, verify every prior generation, then return aggregates to prior `stable` projection without revision increments, mark all children rolled back and parent failed, emit ordered projection events, and release gates.
7. Any ambiguous child, failed rollback, missing participant, or crash with provider effect beyond durable evidence sets parent and divergent Worktrees `recovery_required`; unaffected Worktree gates are released only after their prior state is verified.

Restart reads the parent decision first. `verified` means the desired/verified targets and one revision increment per affected Worktree already committed atomically; `rolling_back` resumes exact remaining rollback; pre-`commit_pending` applying state verifies/rolls back from child evidence; `commit_pending` without the atomic committed parent is never guessed committed and enters verified rollback or recovery. Desired mutations/removal queue behind a frozen participant. Uninstall deletes no content until the parent is verified and reference checks pass.

## Startup reconciliation query

Before IPC prompt handlers are enabled, query:

- every aggregate not safely `stable`;
- every nonterminal attempt;
- every attempt at `commit_pending`;
- every non-invalidated runtime attestation;
- every unpublished outbox row;
- migration status;
- every nonterminal Resource distribution operation and its frozen Worktree participants.

Rules:

- database `verified` attempt + matching aggregate is committed even if event unpublished; republish outbox;
- `none` boundary with no participant beyond `planned` recomputes the authoritative affected set under the Resource barrier, restores/updates pending projections, and resumes writer acquisition;
- any participant `staged`/`activated` without a terminal verified commit enters recovery/rollback according to exact durable evidence;
- a `rolling_back` attempt resumes only when remaining participant prior-state verification is possible; otherwise recovery required;
- attestations for nonexistent/stale runtime generations are invalidated;
- desired differing from verified with no failed terminal attempt is queued;
- linked distribution attempts reconcile only under their parent global decision; an orphaned child is `recovery_required`;
- no row is interpreted from age, timestamps, process existence, files, or desired equality alone.

## Initial data migration

Migration key: `worktree-resource-assignment-v1`.

### Preconditions

Run after generated additive DDL migrations and before coding-agent runtimes, session admission, Marketplace mutations, Worktree create/remove, Capability reconciliation, or Skill synchronization can run.

Preflight must establish:

- no duplicate Worktree IDs or broken run→Worktree references;
- no legacy Capability row in `pending_activation`, `reloading`, or `pending_deactivation`; legacy reconciliation must settle these first;
- every included active Capability has a configured installation with matching exact version, permission digest, and resolvable package/bundled content digest;
- no Worktree has active rows for two versions of the same Capability;
- every included Skill has state `installed` or `update_available`, an exact content digest, and valid compatibility metadata;
- canonical digest computation succeeds without reading provider auth or output history.

A failed precondition writes migration status `failed` with a safe code in a separate short transaction and leaves legacy behavior authoritative. It never chooses the newest version, current installation, last timestamp, or arbitrary row.

### Capability union

For each existing Worktree:

1. join `session_capabilities → runs → worktrees`;
2. select only exact `status = 'active'` rows;
3. deduplicate by `(worktree_id, capability_id, version)`;
4. require one version per Capability per Worktree;
5. create/reuse the exact Capability `resource_versions` row;
6. include that Capability once in the Worktree baseline generation.

Inactive and activation-failed rows are not assigned. Their original rows remain available as legacy session history.

### Skill expansion

Take every Skill installation whose state is `installed` or `update_available` and include its currently active pinned version in every Worktree that existed in the migration snapshot. `pending_verification` and `invalid` Skills are excluded.

Provider incompatibility creates `unavailable` provider projection rows; it does not omit the Skill from the Worktree Assignment. This preserves the approved “installed Skills assigned to existing Worktrees” rule without claiming unsupported provider availability.

Worktrees created after the migration snapshot receive the canonical empty generation through the normal Worktree creation transaction.

### Baseline aggregate

For each existing Worktree, create/reuse one generation containing `Capability union ∪ usable installed Skills`, then insert:

- `revision = 0`;
- `projection_sequence = 0`;
- `phase = 'stable'`;
- desired and verified generation equal to the baseline;
- no runtime attestations;
- one migration outbox snapshot event.

Revision zero represents the migration-created baseline, not a renderer mutation. Every subsequent accepted mutation starts at revision one. The baseline is statically verified; future runtimes attest lazily before admission.

### Two-transaction journal

1. Short transaction inserts/updates migration row to `applying` with source fingerprint and expected counts; commit.
2. `BEGIN IMMEDIATE` data transaction rechecks the same source fingerprint, inserts deterministic/content-addressed rows with conflict verification, validates exact counts and generation digests, marks migration `verified`, and commits.

If the process exits during transaction 2, SQLite rolls back all data rows while the journal remains `applying`. On restart, recompute the fingerprint and rerun transaction 2. If source data changed, update the journal to a new preflight attempt only while legacy remains authoritative.

If transaction 2 commits, the verified marker commits with it; there is no state where cutover is declared without all rows.

Every `ON CONFLICT` path reads the existing row and requires exact equality. It never treats an identity collision as success.

## Cutover and legacy preservation

After migration status is `verified`:

- all Assignment reads/writes use the new repository;
- `session_capabilities` becomes read-only legacy evidence;
- old per-session activation controls are removed from mutation paths;
- `skill_invocations` and all conversation/output/history rows remain unchanged;
- no legacy row is deleted or rewritten by this migration;
- a later separately reviewed retention migration may archive/drop obsolete activation state only after product/history requirements are confirmed.

Rollback before verified status is automatic SQLite transaction rollback and continued legacy authority. Rollback after verified cutover requires an application release rollback that still understands the additive tables; it must not attempt to reconstruct session capability state from Worktree Assignments.

## Cascade and retention behavior

- Worktree removal first explicitly deletes its activity/evidence/session-route/coverage subtree in the same removal transaction, then Worktree deletion cascades aggregate, generations, generation resources/provider rows, attempts/participants, catalog generations, attestations, and outbox rows only when no active distribution participant references it. Active distribution makes removal queue/fail until the parent reaches a safe terminal decision; terminal distribution journals retain only Resource IDs, safe codes, counts, and timestamps under their maintenance retention.
- Resource version deletion is restricted while any generation references it. Uninstall removes active installation ownership but retains immutable historical identity rows.
- Generation deletion is restricted while desired, verified, attempt, attestation, or retained audit references exist. Pruning is a dedicated maintenance operation, never part of apply.
- Attempt participant rows cascade only with their attempt/Worktree.
- Runtime attestations are invalidated immediately on generation/process change and may be pruned after the operational recovery window.
- Activity evidence tables are separate and are not cascaded merely because an Assignment changes or Resource is disabled.

## Repository API requirements

Repositories expose transaction-sized operations, not generic table access:

- `getProjection(worktreeId)`;
- `compareAndSetDesired(input)`;
- `createAttempt(input)` / `advanceAttempt(input)`;
- `recordParticipantTransition(input)`;
- `commitVerifiedGeneration(input)`;
- `commitVerifiedRollback(input)`;
- `markRecoveryRequired(input)`;
- `registerRuntimeAttestation(input)` / `invalidateRuntimeAttestation(input)`;
- `listStartupReconciliation()`;
- `listPendingOutbox()` / `markOutboxPublished(eventId)`;
- `runInitialMigration()`.

Each method takes expected revision/status/runtime generation values and fails on zero or multiple affected rows. Callers cannot write phases or participant states arbitrarily.

## Generated migration requirements

Production implementation must:

1. update `src/shared/db/schema.ts` with typed enums, tables, indexes, checks, and inferred row types;
2. run `npm run db:generate`;
3. review generated SQL and snapshots without hand-editing them;
4. keep data conversion in a tested application migrator because it requires canonical Resource descriptors and preflight logic unavailable to static SQL;
5. add bootstrap ordering so data migration completes before Assignment-aware services and coding-agent admission;
6. add schema/bootstrap tests for fresh databases and every supported prior snapshot.

If Drizzle cannot generate a required partial unique index or check safely, change the schema design or document a narrowly reviewed generation limitation. Do not silently hand-maintain migration SQL.

## Required tests

### Schema constraints

- enum/check rejection;
- unique generation/resource/provider/catalog lineage membership;
- one active attempt per Worktree and one active distribution operation per Resource;
- Worktree cascades and Resource-version restrictions;
- generation ownership invariant in repository transactions;
- outbox projection-sequence uniqueness, multiple ordered phase events at one Assignment revision, and payload schema rejection.

### Revision and transaction tests

- expected revision success/conflict;
- identical desired set is a no-op;
- desired mutation plus attempt plus event is atomic;
- crash/failure injection at every attempt boundary;
- verified commit and rollback all-or-nothing;
- ambiguous provider effect enters recovery required;
- event publish failure replays from outbox without duplicate logical transition;
- global update/uninstall crash at participant freeze, each gate/stage/activate boundary, pre-commit, atomic commit, and rollback;
- provisional participant refresh after ahead-of-writer mutation, Resource removal, or Worktree deletion;
- Resource barrier rejects new add/re-pin, target change supersedes, and pre-effect cancel restores stable projections without revision changes;
- concurrent desired mutation and Worktree removal queue behind a frozen global participant;
- global commit increments each frozen revision exactly once and updates every Worktree or none; orphan child attempts enter recovery.

### Migration fixtures

- empty database;
- Worktrees with no sessions/resources;
- multiple sessions in one Worktree with overlapping active Capabilities;
- multiple Worktrees with distinct Capability unions;
- active/inactive/failed Capability mixtures;
- conflicting active Capability versions fails closed;
- transitional Capability rows fail preflight;
- missing/unconfigured/mismatched installation fails global preflight;
- mixed valid/invalid Worktrees create no new authoritative aggregate for any Worktree and leave legacy authority global;
- installed/update-available versus pending/invalid Skills;
- provider-incompatible Skill projection;
- no installed Skills;
- interruption before journal, after applying journal, during data transaction, and after verified commit;
- rerun with same fingerprint is idempotent;
- identity conflict with different payload fails;
- Worktree creation after cutover starts empty at revision zero;
- legacy session Capability and Skill invocation history remains byte-for-byte unchanged.

### Privacy tests

Reject prohibited fields/values from Assignment rows, participant diagnostics, failure details, and outbox payloads. Assert migration diagnostics contain only counts, fixed codes, IDs already safe for renderer display, and digests.

## Acceptance criteria

- Every existing Worktree has exactly one revision-zero stable baseline after verified migration.
- Its Capability set equals the exact union of active legacy session rows.
- Its Skill set equals every usable installed/update-available Skill at the migration snapshot.
- Every Resource is version/content/security/configuration pinned.
- New Worktrees begin with an empty generation.
- No provider starts during migration.
- No legacy history is modified.
- Any migration preflight conflict leaves legacy authority intact for every Worktree; any later interruption either rolls back fully or leaves a deterministic retryable journal.
- Startup cannot admit provider work until migration and Assignment reconciliation are safe.
