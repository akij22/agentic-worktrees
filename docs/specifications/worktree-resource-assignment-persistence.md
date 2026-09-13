# Worktree Resource Assignment persistence and migration

Status: proposed specification for #67  
Parent: #57  
Depends on: approved coordinator state machine in #66

## Goals

Persist enough information to:

- distinguish desired, verified, failed, and recovery-required Assignment state;
- reconstruct or reject an interrupted coordinator attempt without inference;
- pin every Resource version/content/security/configuration identity;
- verify each live runtime generation before provider admission;
- publish revisioned events exactly once logically through an outbox;
- migrate current session-scoped Capability state by Worktree union;
- assign currently usable installed Skills to every existing Worktree;
- preserve legacy session history and support transactional retry/rollback.

The database does not persist prompts, outputs, Skill bodies, Capability settings, secret references, credentials, authorization headers, private paths, provider session identifiers, or raw provider events in Assignment tables.

## SQLite conventions

- Foreign keys remain enabled.
- Timestamps are UTC epoch milliseconds.
- Public optimistic revisions and ordinals are non-negative SQLite integers and cross IPC as decimal strings.
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

### `worktree_assignments`

One mutable coordinator aggregate per Worktree.

| Column | Type | Rules |
|---|---|---|
| `worktree_id` | text | PK, FK `worktrees(id) ON DELETE CASCADE` |
| `revision` | integer | non-negative optimistic revision |
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
- revision increments exactly once per accepted non-idempotent desired mutation, not per apply attempt.

Cross-row invariants cannot be expressed safely as SQLite `CHECK`s and are verified by repository code plus tests.

### `worktree_assignment_attempts`

Durable journal for apply, lazy runtime join, recovery, global update participation, and removal.

| Column | Type | Rules |
|---|---|---|
| `id` | text | PK UUID |
| `worktree_id` | text | FK Worktree `ON DELETE CASCADE` |
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
| `provider_version` | text | exact version |
| `effective_state_digest` | text | exact safe projection digest |
| `verified_at` | integer | non-null |
| `invalidated_at` | integer nullable | null only while usable |
| `invalidation_code` | text nullable | allowlisted reason |

Primary key: `(worktree_id, agent_kind, runtime_generation)`.

Only a non-invalidated row matching the current verified generation and runtime manager's current generation can admit work. Attestation rows are evidence, never a source for reconstructing provider state.

### `worktree_assignment_outbox`

Transactional renderer/event publication.

| Column | Type | Rules |
|---|---|---|
| `event_id` | text | PK UUID |
| `worktree_id` | text | FK Worktree `ON DELETE CASCADE` |
| `revision` | integer | aggregate revision |
| `event_type` | text | allowlisted Assignment event |
| `schema_version` | integer | currently `1` |
| `safe_payload_json` | text | validated safe projection only |
| `created_at` | integer | non-null |
| `published_at` | integer nullable | null while pending |

Unique: `(worktree_id, revision, event_type)`. The payload may contain Resource IDs/versions, phase, availability, progress counts, failure code, and allowed actions. It may not contain prohibited data listed in Goals.

Consumers deduplicate by `event_id`; snapshots use revision monotonicity. Published rows may be pruned after the documented event-replay retention window, never before all renderer windows can refresh by snapshot.

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
6. insert one outbox event;
7. commit.

No provider operation occurs inside a database transaction.

### Attempt progress

Every stage boundary uses a short transaction that checks attempt status, aggregate revision/generation, and participant runtime generation before advancing exactly one legal state. Participant state is written before/after provider operations according to the coordinator write-ahead protocol:

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
- insert outbox event.

### Verified rollback

One transaction checks every affected participant is `rolled_back`, then:

- retain prior verified generation;
- set `failed_rolled_back` (or `stable` when desired was explicitly reverted);
- mark attempt terminal with failure code;
- invalidate target attestations;
- insert outbox event.

### Recovery required

One transaction marks uncertain participants `unknown`, aggregate and attempt `recovery_required`, invalidates all affected runtime attestations, and inserts the event. Runtime termination follows through the owned runtime manager; inability to terminate does not reopen admission.

## Startup reconciliation query

Before IPC prompt handlers are enabled, query:

- every aggregate not safely `stable`;
- every nonterminal attempt;
- every attempt at `commit_pending`;
- every non-invalidated runtime attestation;
- every unpublished outbox row;
- migration status.

Rules:

- database `verified` attempt + matching aggregate is committed even if event unpublished; republish outbox;
- `none` boundary with no participant beyond `planned` may safely resume preparation/waiting;
- any participant `staged`/`activated` without a terminal verified commit enters recovery/rollback according to exact durable evidence;
- a `rolling_back` attempt resumes only when remaining participant prior-state verification is possible; otherwise recovery required;
- attestations for nonexistent/stale runtime generations are invalidated;
- desired differing from verified with no failed terminal attempt is queued;
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

- Worktree deletion cascades aggregate, generations, generation resources/provider rows, attempts/participants, attestations, migration-created outbox rows associated with that Worktree, subject to the existing requirement that Worktree history/references permit deletion.
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
- unique generation/resource/provider membership;
- one active attempt per Worktree;
- Worktree cascades and Resource-version restrictions;
- generation ownership invariant in repository transactions;
- outbox uniqueness and payload schema rejection.

### Revision and transaction tests

- expected revision success/conflict;
- identical desired set is a no-op;
- desired mutation plus attempt plus event is atomic;
- crash/failure injection at every attempt boundary;
- verified commit and rollback all-or-nothing;
- ambiguous provider effect enters recovery required;
- event publish failure replays from outbox without duplicate logical transition.

### Migration fixtures

- empty database;
- Worktrees with no sessions/resources;
- multiple sessions in one Worktree with overlapping active Capabilities;
- multiple Worktrees with distinct Capability unions;
- active/inactive/failed Capability mixtures;
- conflicting active Capability versions fails closed;
- transitional Capability rows fail preflight;
- missing/unconfigured/mismatched installation fails preflight;
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
- Any conflict or interruption either rolls back fully or leaves a deterministic, retryable journal with legacy authority intact.
- Startup cannot admit provider work until migration and Assignment reconciliation are safe.
