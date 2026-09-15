# Resource activity evidence contract

Status: approved by HITL for #65; consolidated and cross-document aligned under #57. This document defines behavior and implementation boundaries; it does not implement them.

HITL decisions incorporated:

- retain terminal Worktree-scoped Unknown/conflict metadata for 30 days;
- show legacy Skill rows as requests with Use not verified, never as Used;
- when an exact receipt proves session B used profile/lease A, show the proven Use in B and quarantine the mismatched runtime generation.

## 1. Decision

Resource activity is a durable projection of trusted observations, not a transcript heuristic.

The system stores four independent facts:

1. **Request** — an application or provider asked for a specific Resource.
2. **Use** — the trusted execution/context boundary was crossed.
3. **Outcome** — what happened after the request or confirmed use.
4. **Session attribution** — whether trusted evidence joins the activity to exactly one application session.

A Resource is shown as Used in a session only when Use is confirmed and attribution is exact. Missing, ambiguous, stale, conflicting, or provider-unqualified evidence never becomes Used by inference.

This contract applies to assigned Capabilities and Skills only. It does not create a general event viewer, Marketplace management UI, MCP-resource feature, provider transcript archive, or filesystem audit system.

## 2. Non-negotiable semantics

### 2.1 Capability

- Requested means a trusted application/provider MCP tool item addressed the invocation-time registered server/tool mapping.
- Used means the owned Capability Host passed tool lookup and input validation and entered the exact Capability handler.
- Unknown tool, inactive tool, invalid input, denied permission, or failure before handler entry is not Used.
- Success, reported error, throw, timeout, and cancellation after entry all remain Used; outcome is separate.
- Host entry without one exact trusted provider receipt remains Resource Used at Worktree scope with session Unknown and is excluded from every session activity timeline.

### 2.2 Skill

- Requested means an exact native Skill input or verified Skill command was submitted for the invocation-time assigned Skill identity.
- Used means trusted, version-qualified provider/runtime evidence proves that the complete immutable Skill body entered model context.
- Catalog presence, bridge completion, command name, provider prose, file reads, token use, task success, or a pending/error loader item is not Used.
- Explicit request and context entry are separate. A missing/failed load remains Requested, not Used.
- Automatic is displayed only when the qualified evidence path proves model-selected loading and excludes an explicit route. Otherwise mode is Unknown.
- Filesystem access to a Skill file is outside Managed Skill isolation and never proves Skill Used.

### 2.3 Attribution

Attribution applies to the fact being claimed:

- A **Request** may be exactly attributed when a trusted adapter receives the structured provider request through a provider-session route previously registered to exactly one application `runId` in that runtime generation. It does not need host entry and cannot establish Use. The migration-only exception is an existing application-owned `skill_invocations.run_id` foreign key: it exactly attributes the application's legacy request record to that run with `legacy_unverified` coverage, but proves neither provider receipt nor Use.
- A Capability **Use** requires the host receipt chain plus that exact request/session route.
- A Skill **Use** requires a qualified context-entry receipt plus that exact session route.
- A host-only Capability Use is Worktree-scoped/session Unknown until the provider chain arrives.

The route is application-owned adapter state, not a credential inference. Durable replay uses a keyed digest of the provider session route mapped to one `runId`; no raw provider session ID is persisted in activity evidence.

The relevant runtime/Assignment/catalog generation must have been active and attested when the observation originated. It may be retired by the time history is replayed, but must remain in the immutable recorded generation lineage. It is never inferred from Worktree ownership, runtime ownership, credential/profile, lease, server, timestamps, arguments, result, display name, event ordering, current catalog, or provider session ID alone.

Provider/version qualification is executable configuration. An unknown provider version, schema drift, SDK/CLI mismatch, missing history field, or failed parser is `provider_unqualified` or `evidence_gap`, not best-effort attribution.

## 3. Canonical model

### 3.1 ResourceActivity

One row represents one request/use attempt. Retries create new rows even when Resource, session, and user intent are identical.

```ts
type ResourceKind = "capability" | "skill";
type RequestState = "not_observed" | "requested";
type UseState = "not_confirmed" | "confirmed";
type ActivityLifecycle = "open" | "terminal";
type ActivityOutcome =
  | "not_observed"
  | "success"
  | "reported_error"
  | "thrown"
  | "timeout"
  | "cancelled"
  | "rejected"
  | "permission_denied"
  | "load_failed";
type AttributionState = "exact" | "unknown" | "conflict";
type InvocationMode = "explicit" | "automatic" | "unknown";
type RoutingIntegrity = "verified" | "lease_mismatch" | "unknown";
type EvidenceCoverage =
  | "qualified"
  | "pending"
  | "evidence_gap"
  | "provider_unqualified"
  | "format_drift"
  | "legacy_unverified"
  | "conflict";

type ResourceActivity = {
  id: string;                         // application UUID
  worktreeId: string;
  runId: string | null;               // non-null only for exact attribution
  resourceKind: ResourceKind;
  resourceId: string;
  resourceVersion: string;
  resourceDigest: string | null;       // null only for legacy_unverified
  assignmentRevision: string | null;  // canonical 64-bit decimal; null only for legacy_unverified
  assignmentGenerationId: string | null;
  catalogGenerationId: string | null;
  runtimeGenerationId: string | null;
  provider: "codex" | "opencode" | null;
  providerVersion: string | null;
  adapterContractVersion: number | null;
  requestKey: string | null;          // keyed provider request identity; unique when present
  correlationKey: string | null;      // keyed host/load receipt chain; unique when present
  requestState: RequestState;
  useState: UseState;
  lifecycle: ActivityLifecycle;
  outcome: ActivityOutcome;
  attribution: AttributionState;
  mode: InvocationMode;
  routingIntegrity: RoutingIntegrity;
  coverage: EvidenceCoverage;
  requestedAt: Date | null;
  enteredOrLoadedAt: Date | null;
  finishedAt: Date | null;
  firstObservedAt: Date;
  lastObservedAt: Date;
};
```

`resourceDigest` is the verified immutable descriptor/content digest, not a Skill body or Capability package body. `assignmentRevision` is stored in the activity table as canonical non-negative decimal text because it is an immutable comparison snapshot, not an arithmetic counter; repository code validates/parses it with `BigInt` and never passes it through JavaScript `number`. All generation/provider fields are invocation-time snapshots; current Assignment/catalog state cannot rewrite them. They are nullable only for the migration-only `legacy_unverified` tuple below, never for newly observed activity.

`runId` is the application's session/run foreign key. No provider thread/session ID is stored in this row. `runId` must be null for Unknown or conflict attribution. A Requested-only row may have exact `runId` attribution through the registered provider-session route defined in §2.3; this proves only the request.

`requestKey` is the HMAC of the provider contract's stable request/call/item identity. The qualified contract must prove that the same identity is present on request and terminal receipt events; otherwise no request-to-host merge is allowed. `correlationKey` is the separate HMAC of the host receipt or Skill context-entry chain. Both are unique when non-null and never cross IPC.

### 3.2 ResourceActivityEvidence

This table stores minimal provenance for replay safety and audit of the projection, not raw provider data.

```ts
type EvidenceBoundary =
  | "application.request"
  | "provider.request"
  | "capability_host.entered"
  | "capability_host.outcome"
  | "provider.capability_receipt"
  | "provider.skill_context_receipt"
  | "provider.outcome"
  | "reconciliation.conflict";

type ResourceActivityEvidence = {
  id: string;
  activityId: string;
  boundary: EvidenceBoundary;
  sourceEventKey: string;             // local keyed digest, never raw provider ID
  correlationKey: string | null;      // keyed host/load receipt chain
  providerContract: string;
  observedAt: Date;
};
```

Unique index: `(boundary, sourceEventKey)`. A source replay is a no-op after verifying that its canonical fields agree. The same unique key with different canonical fields is a security/integrity conflict and quarantines the runtime.

The canonical HMAC input is length-prefixed binary data, not delimiter-concatenated user text:

```text
source = HMAC(keyVersion,
  "aw-resource-evidence/source/v1", identityKind, provider, providerVersion,
  adapterContractVersion, worktreeId, runtimeGenerationId, rawScopedIdentity)
correlation = HMAC(keyVersion,
  "aw-resource-evidence/correlation/v1", worktreeId, runtimeGenerationId,
  receiptKind, rawReceipt)
request = HMAC(keyVersion,
  "aw-resource-evidence/request/v1", provider, providerVersion,
  adapterContractVersion, worktreeId, runtimeGenerationId,
  rawStableProviderRequestIdentity)
sessionRoute = HMAC(keyVersion,
  "aw-resource-evidence/session-route/v1", provider, providerVersion,
  worktreeId, runtimeGenerationId, rawProviderSessionId)
```

`identityKind` distinguishes request, item, part, call, host entry, host outcome, and reconciliation records. Provider account/profile/credential material is not an input. The full immutable Resource identity and generation snapshot is compared on replay; a matching key with differing fields is conflict, not deduplication.

Persist neither raw provider IDs nor the raw invocation UUID. Key version is encoded in the digest prefix. The local evidence key remains available for the lifetime of records created with it; rotation keeps prior keys for ingestion-time equality checks until those records expire and never requires raw evidence recovery.

### 3.3 ResourceActivitySessionRoute

Exact provider request attribution and history replay use a privacy-safe route registered when the application creates/resumes a provider session:

```ts
type ResourceActivitySessionRoute = {
  routeKey: string;                    // sessionRoute HMAC from §3.2
  runId: string;
  worktreeId: string;
  provider: "codex" | "opencode";
  providerVersion: string;
  adapterContractVersion: number;
  runtimeGenerationId: string;
  assignmentGenerationId: string;
  catalogGenerationId: string;
  registeredAt: Date;
  retiredAt: Date | null;
};
```

`routeKey` is unique and maps to exactly one run. A second run claim is conflict and generation quarantine. The route is retained/deleted with its run and permits qualified history records from that provider session to be attributed after restart without storing the raw provider session ID. Runtime generation lineage and attested Assignment/catalog snapshots are owned by the coordinator/runtime specifications; activity references them and cannot create or mutate them.

### 3.4 ResourceEvidenceCoverageRecord

Coverage and security facts that are not an invocation must not create synthetic activity:

```ts
type ResourceEvidenceCoverageRecord = {
  id: string;
  worktreeId: string;
  provider: "codex" | "opencode";
  providerVersion: string;
  adapterContractVersion: number;
  runtimeGenerationId: string;
  assignmentGenerationId: string | null;
  catalogGenerationId: string | null;
  kind: "evidence_gap" | "provider_unqualified" | "format_drift" | "security_conflict";
  sourceEventKey: string;              // versioned HMAC
  observedAt: Date;
  resolvedAt: Date | null;
};
```

This is operational coverage state, not Resource activity, has no Resource/session identity, is never rendered, and cannot be joined to a session. Unique index: `(kind, sourceEventKey)`. It is retained for 30 days after resolution or retirement of the affected runtime generation, whichever is later.

### 3.5 Data forbidden from persistence and IPC

Never store or expose in activity, evidence, session-route, or coverage records:

- prompts, arguments, model output, Capability result, exception text, or Skill body;
- credentials, tokens, authorization headers, secret references, or provider configuration;
- private filesystem paths or installation source paths;
- raw provider session/thread/turn/message/item/part/call IDs;
- raw host invocation IDs, MCP JSON-RPC IDs, raw provider events, or full MCP messages;
- provider reasoning, transcript fragments, or command templates.

Provider and host adapters may hold the minimum raw identities transiently in main-process memory for validation, HMAC derivation, exact cancellation, and reconciliation. They never cross preload IPC.

Resource IDs and versions must pass the existing shared Resource schema and may not be synthesized from paths, commands, repository URLs, prompts, or provider payloads. Renderer names come only from immutable installed/Assignment metadata, are Unicode-control stripped and length-limited to 80 grapheme clusters, and never fall back to a provider title or path.

## 4. Evidence qualification matrix

No production path is activated merely because a prototype passed. “Eligible after predicate” means production may enable that exact version only after its production parser reproduces the fixture suite.

| Resource/path | Requested | Used | Current status | Production activation predicate |
|---|---|---|---|---|
| Capability Host boundary | qualified provider request | validated handler entry and typed host outcome | prototype proven; production bridge absent | #73-equivalent host fixtures pass |
| OpenCode Capability 1.18.30 | exact registered ToolPart request | exact terminal host receipt retained by same app-routed session | eligible, not active | production bridge/parser and exact SDK/CLI pair pass #73 matrix |
| Codex Capability 0.154.0 | exact `mcpToolCall` request | host entry cannot be joined to a terminal provider receipt | unqualified | #75 proves a pinned version; until then emit Request only and keep host Use session Unknown |
| OpenCode explicit Skill command 1.18.30 | exact verified `source: skill` command request | correlated full body injection matching assigned digest | eligible, not active | production command snapshot/parser and exact SDK/CLI pair pass #64 matrix |
| OpenCode builtin Skill loader 1.18.30 | trusted loader request | completed trusted ToolPart with exact metadata and full body digest | eligible, not active | production registry/parser and exact SDK/CLI pair pass #64 matrix |
| Codex explicit Skill 0.154.0 | native Skill input | owned private-rollout context record matching full digest | eligible for explicit receipt, not active | production private-rollout parser passes #64 and Managed Skill isolation separately passes #74 |
| Codex automatic Skill 0.154.0 | no reliable request | no reliable context-entry receipt | unqualified | positive version-pinned context-entry proof required |

An eligible-but-inactive path emits no Used claim. If its request parser alone is qualified, it may emit Requested with `Use not verified`; otherwise Resource-dependent admission fails unavailable. A newer or older provider version begins unavailable, not presumptively compatible.

## 5. State reduction

The reducer is deterministic, transactional, idempotent, and monotonic in evidence strength.

### 5.1 Allowed transitions

```text
none
 ├─ request ───────────────> requested / not_confirmed / pending
 └─ positive E2 receipt ───> not_observed / confirmed / qualified

requested / not_confirmed
 ├─ positive E2 receipt ───> requested / confirmed / qualified
 └─ pre-entry failure ─────> requested / not_confirmed / terminal outcome

confirmed
 └─ post-entry outcome ────> confirmed / terminal outcome

unknown host use
 └─ exact provider pair ───> confirmed / exact run attribution

any non-conflict state
 └─ contradictory claim ───> attribution conflict / coverage conflict
```

A positive automatic Skill load may create `confirmed` without `requested`. A post-entry failure never changes `confirmed` back to `not_confirmed`. A late qualified receipt may promote `not_confirmed` to `confirmed`; it may not rewrite Resource identity or generation.

Lifecycle rules:

- Create as `open`. Set `terminal` only from a trusted Resource outcome or when runtime closure/reconciliation proves no further local outcome can arrive and records an evidence gap. Migration has one explicit exception: a legacy bridge-completed `loaded` row becomes terminal with `legacy_unverified` coverage because the historical attempt ended, without implying a trusted Resource outcome or Use.
- `terminal + outcome = not_observed` is valid only with `evidence_gap`, `provider_unqualified`, `format_drift`, or `legacy_unverified` coverage.
- `finishedAt` is non-null exactly when lifecycle is terminal.
- Capability `confirmed` requires `enteredOrLoadedAt`; Skill `confirmed` requires qualified context-entry time.
- Capability mode is always `explicit` or `unknown`, never `automatic`.
- `attribution = exact` requires non-null `runId`; `unknown|conflict` requires null `runId`.
- `coverage = qualified` cannot coexist with `attribution = conflict` or `routingIntegrity = unknown`.
- `coverage = legacy_unverified` requires Skill kind, requested, not confirmed, exact legacy run attribution, unknown routing integrity, and null Resource digest/Assignment revision/Assignment generation/catalog generation/runtime generation/provider/provider version/adapter contract. It can never be promoted or correlated with new E2 evidence.
- Every non-legacy row requires non-null Resource digest, canonical decimal Assignment revision, Assignment/catalog/runtime generation IDs, provider/version, and positive adapter contract version.
- `load_failed` is Skill-only and requires `useState = not_confirmed`.
- `rejected|permission_denied` require `useState = not_confirmed`.
- Capability post-entry `success|reported_error|thrown|timeout|cancelled` require `useState = confirmed`.
- Skill context entry terminalizes Resource loading with `outcome = success`; later model/task failure is not a Resource outcome.

The service validates the complete tuple on every reduction and database read. Invalid combinations fail closed; the database also uses check constraints for direct enum/nullable invariants where SQLite permits them.

### 5.2 Forbidden transitions

- Available/assigned/installed/discovered → Requested or Used.
- Provider completed/success alone → Used.
- Timeout elapsed → timeout outcome without trusted terminal boundary.
- Host entry → exact session without exact provider receipt.
- Unknown/conflict → exact by choosing nearest/first/only-live session.
- Existing activity → retry; retries always receive another application activity ID and host receipt.
- Missing evidence → unused.
- Provider history deletion/compaction → negative evidence.

### 5.3 Request and outcome rules

Pre-entry rejection can terminalize a Requested record with `rejected`, `permission_denied`, or `load_failed` while `useState` remains `not_confirmed`.

After Capability handler entry, `reported_error`, `thrown`, `timeout`, and `cancelled` are outcomes of Used. For Skill, context injection confirms Used; a later model/task error does not become Skill `load_failed` and does not erase Used.

If provider outcome and host outcome disagree, preserve the host outcome as Resource execution truth, mark coverage conflict, and quarantine admission. Do not merge arbitrary provider error text.

## 6. Receipt correlation and cancellation

### 6.1 Capability pairing

The host generates an opaque invocation UUID after validation and immediately before Capability code. It emits typed `entered` and exactly one typed outcome. Every post-entry MCP response preserves the same receipt outside Capability-controlled output.

A session pair requires:

1. trusted host entered evidence;
2. trusted provider evidence retaining the same receipt;
3. adapter routing to exactly one application `runId`;
4. an immutable runtime/Assignment/catalog generation that was active and attested at invocation time;
5. exact invocation-time transformed server/tool forward mapping;
6. a qualified provider/version parser;
7. no conflicting session claim.

Adapter routing to the application session is trustworthy because the application registered that provider session route inside the owned runtime and validates its keyed route identity on every live/replayed event. A lease/profile mismatch does not disqualify the receipt pair or move its session; it independently sets routing-integrity failure and quarantines that runtime generation as §7.2 defines.

The raw receipt is compared in memory. Only its keyed digest is durable.

### 6.2 Cancellation

Provider abort and host cancellation are separate observations. A trusted internal active-invocation registry is keyed by `(runtimeGenerationId, rawInvocationId)` and associates the invocation with adapter dispatch context.

Stop does all of the following:

1. invoke provider-native stop/abort;
2. resolve only invocation IDs already registered to that adapter/session dispatch;
3. send cancellation to the owned host by exact runtime generation and invocation ID;
4. require host acknowledgement and then typed terminal outcome;
5. persist `cancelled` only when the host confirms that outcome.

The renderer sends only “Stop session” and never receives/submits invocation IDs. Ambiguous ownership, stale generation, multiple candidates, mismatch, or missing host acknowledgement is not reported as Capability cancelled; admission enters recovery/quarantine. Host cancellation without an already qualified provider receipt remains Worktree-scoped/session Unknown; provider abort or the cancellation registry alone cannot manufacture a session Use pair.

## 7. Reconciliation, replay, and gaps

### 7.1 Live plus history

Adapters ingest structured provider events before display projection and may replay qualified provider history after reconnect/restart. Both routes call the same reducer.

- Same `(boundary, sourceEventKey)` and same canonical fields: no-op.
- Same key with different fields: conflict and runtime quarantine.
- A provider request observed before host entry may create a session Requested record with `requestKey`. A later terminal provider event must carry the exact same qualified stable provider request identity and the host/load receipt; it resolves both `requestKey` and `correlationKey`. Transactionally merge the Requested projection into the host/load activity, move its evidence rows, and delete the redundant projection. If the provider contract does not preserve that request identity, leave the Requested and Unknown host records separate. Never merge by time/order/name alone.
- New provider record for the same host receipt and same session: corroborating evidence, not a second activity.
- Same host receipt claimed by two sessions: conflict; detach `runId`, set attribution conflict, exclude from both timelines.
- History for a retired generation may update only an activity/evidence chain whose generation was recorded while active, or a Skill receipt whose immutable generation lineage, session route, assigned Resource snapshot, and active interval were durably recorded. It compares against that retired snapshot, never today's catalog.
- An unknown generation, reused generation number, event from an unregistered session route, or retired-generation event that would invent an unanchored Capability host entry is stale: reject it and record a sanitized coverage/security counter.
- Retry/new provider call and new host receipt: new activity.

History replay cannot claim complete coverage after provider deletion/compaction. Write a `ResourceEvidenceCoverageRecord(kind = evidence_gap)` for the affected generation; do not generate synthetic activity rows for unknown possible calls.

### 7.2 Lease/profile mismatch

If a provider event routed from application session B carries a valid host receipt created under profile/lease A, the originating session remains exactly B and the confirmed activity remains visible as Used in B. Set `routingIntegrity = lease_mismatch` and quarantine further runtime admission because Assignment isolation may have failed. The mismatch does not erase an already proven fact. The credential proves the presented lease, not origin, and cannot move the activity to A.

### 7.3 Provider format drift

Unknown variant, missing required field, hash mismatch, parser exception, or unqualified version:

- do not partially parse;
- mark the runtime/provider generation unavailable;
- write a `ResourceEvidenceCoverageRecord` for `format_drift` or `provider_unqualified` without raw payload;
- stop admission for Resource-dependent turns;
- preserve already verified records unchanged.

### 7.4 Quarantine and recovery

Quarantine is owned by the Worktree Runtime lifecycle, scoped to `(worktreeId, provider, runtimeGenerationId)`. It blocks session create/resume/turn admission for that generation while leaving the narrow stop/cancel/drain lane available.

Triggers are conflicting receipt ownership, lease/profile mismatch, cancellation ownership ambiguity, evidence-key field conflict, or qualified-parser format drift. The coordinator drains active work, performs targeted shutdown, and starts a strictly greater generation only after its Assignment/catalog snapshot and provider parser are re-attested. No quarantined process or session is resumed into the new generation.

Historical activity is not rewritten by recovery. Late evidence may complete an open non-conflicting record only under the retired-generation lineage rules above. A conflict record is immutable except for appending corroborating conflict evidence; no operator/provider guess reassigns it. A corrected parser applies only after explicit version/contract qualification and may replay previously unopened raw provider history in memory, but cannot reinterpret persisted digests without the original qualified structured record.

## 8. Persistence and transaction boundaries

Production adds `resource_activity`, `resource_activity_evidence`, `resource_activity_session_routes`, `resource_evidence_coverage`, `resource_activity_streams`, and `resource_activity_outbox` tables behind a repository owned by a `ResourceActivityEvidenceService` in the main process.

`resource_activity_streams` has `run_id` primary key/FK `ON DELETE CASCADE` and a non-negative `sequence`. `resource_activity_outbox` has event UUID, run FK `ON DELETE CASCADE`, sequence, schema version, one validated sanitized upsert/remove delta, created time, and nullable published time; unique `(run_id, sequence)`. No event is created for Unknown/conflict-only changes that have no session projection.

- Nullable `resource_activity.assignment_generation_id` references `worktree_assignment_generations(id) ON DELETE RESTRICT`; nullable `catalog_generation_id` references `worktree_runtime_catalog_generations(id) ON DELETE RESTRICT`; non-legacy runtime generation ID is opaque text validated against recorded runtime lineage. Null lineage is accepted only for the complete `legacy_unverified` invariant and cannot satisfy correlation.
- Session-route lineage uses the same non-null Assignment/catalog foreign keys. Coverage rows use nullable Assignment/catalog foreign keys because unqualified/format-drift evidence may occur before a safe catalog generation exists.
- Host protocol handlers and provider adapters submit validated observations to the service; they never write tables directly.
- Evidence insert and canonical projection update occur in one database transaction. If the sanitized session projection changes, that transaction also increments its run stream sequence and inserts exactly one activity outbox delta.
- Partial unique indexes cover non-null `resource_activity.request_key` and `resource_activity.correlation_key`; evidence uniqueness is `(boundary, source_event_key)`, and coverage uniqueness is `(kind, source_event_key)`.
- A uniqueness conflict is re-read and compared transactionally. SQLite write serialization plus these indexes prevents concurrent live/history ingestion from creating two canonical rows for one receipt chain.
- Activity foreign keys use `worktree_id ON DELETE CASCADE` and nullable `run_id ON DELETE CASCADE`. Route rows use `run_id ON DELETE CASCADE` and `worktree_id ON DELETE CASCADE`. Coverage rows use `worktree_id ON DELETE CASCADE`. Exact session records/routes are deleted with the run. Unknown/conflict activities are created with null `run_id`; they never migrate to another run.
- Resource installation rows are not foreign-key identity. Uninstall cannot erase historical immutable ID/version/digest.
- Assignment and catalog generation IDs are required content-addressed text identities with exact persisted lineage; runtime generation ID is required opaque non-empty text. They are never parsed/coerced as integers or substituted for one another.
- Enum values are runtime-validated at repository/service boundaries; unknown database values fail closed.

The service exposes read models, not database entities. It emits sanitized incremental activity deltas after commit. There is no generic renderer query over raw evidence.

## 9. Retention and deletion

- Session-attributed canonical activity and its minimal evidence digests live for the lifetime of the run/session and are deleted when the user deletes that run.
- Worktree-scoped Unknown/conflict activity is retained for 30 days after terminal observation, then deleted automatically; active/incomplete activity is not purged.
- Published activity outbox deltas may be pruned after seven days because reconnect always fetches an authoritative snapshot; stream sequence remains with the run.
- Coverage/security records are retained for 30 days after `resolvedAt` or affected-generation retirement, whichever is later.
- Deleting a Worktree deletes all remaining activity, session routes, evidence children, and coverage/security records immediately, regardless of an otherwise unexpired 30-day window.
- Provider history compaction does not delete already verified canonical facts.
- Uninstalling a Resource does not delete its historical activity.
- No telemetry/export is added. Existing application data deletion/backup rules apply to these local rows.

The 30-day Unknown/conflict window supports crash reconciliation and diagnosis while minimizing unattributed data. Product UI does not expose an Unknown-activity management screen.

## 10. Legacy migration

### 10.1 `skill_invocations`

Existing rows cannot prove provider context entry.

At cutover:

- copy each valid row into one `ResourceActivity` with immutable Skill ID/version from that row;
- map it to its existing run/worktree;
- use the valid legacy `run_id` foreign key as the migration-only exact attribution of the application request; set `coverage = legacy_unverified`, `useState = not_confirmed`, `attribution = exact`, `routingIntegrity = unknown`, and `mode` only if the legacy value is valid; set Resource digest, Assignment revision/generation, catalog generation, runtime generation, provider/version, and adapter contract null because the legacy source cannot prove them; this exception cannot satisfy provider attribution or Use;
- map legacy pending to `requestState = requested`, `lifecycle = open`, `outcome = not_observed`;
- map legacy loaded to `requestState = requested`, `lifecycle = terminal`, `outcome = not_observed`, with `finishedAt` from the legacy loaded timestamp; bridge completion ended the legacy attempt but did not prove use;
- map legacy failed to `requestState = requested`, `useState = not_confirmed`, `lifecycle = terminal`, `outcome = load_failed` only as a legacy request outcome;
- never map legacy `loaded` to Used;
- do not invent sentinel lineage/digests. The validated all-null legacy lineage tuple is the only exception and can never satisfy new E2 matching.

Migration is idempotent via a stable local `requestKey` derived with the evidence HMAC key from the legacy table domain and row ID. Keep `skill_invocations` byte-for-byte preserved and read-only for rollback after verified cutover; new writes go only to the evidence service.

### 10.2 Capabilities and transcripts

Do not backfill Capability activity from `session_capabilities`, normalized tool calls, run output, provider prose, Assignment, timestamps, or current catalogs. Availability is not activity. Historical Capability use therefore begins empty unless qualified provider/host history can be reconciled through the new bridge after cutover.

Do not reparse existing renderer transcripts for either Resource kind.

### 10.3 Cutover verification

Before enabling new reads:

1. migration transaction completes;
2. source row counts and stable-key uniqueness reconcile;
3. every migrated row is `legacy_unverified` and not Used;
4. forbidden columns/data patterns are absent;
5. repository round-trip and deletion semantics pass;
6. renderer read model never labels a migrated `loaded` row Used.

Failure rolls back the migration and keeps legacy reads active.

## 11. Renderer contract and wording

Activity stays in the existing session transcript/activity area. No page, dashboard, navigation item, statistics panel, or management screen is added.

The renderer receives only:

```ts
type SessionResourceActivityItem = {
  id: string;
  resourceKind: "capability" | "skill";
  resourceId: string;
  resourceVersion: string;
  requestState: "not_observed" | "requested";
  useState: "not_confirmed" | "confirmed";
  lifecycle: "open" | "terminal";
  outcome: ActivityOutcome;
  mode: "explicit" | "automatic" | "unknown";
  coverage: EvidenceCoverage;
  occurredAt: string;
};
```

Only records with exact non-null `runId` and non-conflicting attribution enter this DTO. A lease/profile mismatch with an exact receipt remains honest session activity while separately quarantining future runtime admission; routing internals do not cross IPC. Conflicting session claims remain excluded. Never send attribution internals, request/correlation/evidence keys, provider IDs, generations, digests, paths, receipt IDs, mismatches, or raw errors to the renderer.

Required wording:

| Facts | Renderer label |
|---|---|
| Capability requested, not confirmed, pending | `Capability requested` |
| Capability request terminal before entry | `Capability request denied` or `Capability request failed` |
| Capability confirmed + success/not yet terminal | `Capability used` |
| Capability confirmed + terminal evidence gap | `Capability used · Outcome not verified` |
| Capability confirmed + error/throw | `Capability used · Failed` |
| Capability confirmed + timeout | `Capability used · Timed out` |
| Capability confirmed + cancelled | `Capability used · Cancelled` |
| Explicit Skill requested, not confirmed | `Skill requested` |
| Skill request/load failed before context entry | `Skill not loaded` |
| Skill confirmed, explicit | `Skill used` |
| Skill confirmed, automatic proven | `Skill used automatically` |
| Skill confirmed, mode unknown | `Skill used` |
| provider unqualified/evidence gap with request | `Capability requested · Use not verified` or `Skill requested · Use not verified` |
| legacy row | `Legacy request · Use not verified` |

Unknown Worktree-scoped host use and conflict records do not appear in a session. Absence of an item never renders “not used.” Provider prose and normalized tool-call cards are not upgraded into Resource activity labels.

Timestamps use the main process receive clock, never provider-supplied wall time. Per-source sequence and evidence boundary establish transition order; wall-clock proximity never establishes identity. Renderer ordering uses the confirmed-use boundary time when present, otherwise request time, with stable activity ID tie-break. Late promotion updates the existing item in place; it does not append a duplicate. Loading and empty states use existing transcript patterns. Labels include accessible Resource name from the immutable assignment read model, while identity remains ID/version.

## 12. IPC and security

### 12.1 Central contracts and channels

Create `src/shared/resource-activity/schemas.ts` as the sole Zod definition site for activity requests, result envelopes, snapshots, items, deltas, and events. Add only these constants to `src/shared/ipc/channels.ts`:

| Constant | Wire name | Direction |
|---|---|---|
| `RESOURCE_ACTIVITY_LIST` | `resource-activity:list` | renderer invoke → main |
| `RESOURCE_ACTIVITY_CHANGED` | `resource-activity:changed` | main event → renderer |

```ts
type ResourceActivityIpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: {
      code: "activity_run_not_found" | "activity_access_denied" | "internal_error";
      message: string;
    } };

type SessionResourceActivitySnapshot = {
  runId: string;
  sequence: string;
  items: SessionResourceActivityItem[];
};

type SessionResourceActivityChangedEvent = {
  eventId: string;
  runId: string;
  sequence: string;
  change:
    | { type: "upsert"; item: SessionResourceActivityItem }
    | { type: "remove"; activityId: string };
};
```

Sequences are canonical non-negative decimal strings. Main validates the sender's access to the exact local run and its Worktree on every list request and derives event recipients from application window/run ownership; renderer-supplied Worktree/provider/session identity is ignored.

### 12.2 Delivery and reconnect

Main publishes a changed event only after the activity/outbox transaction commits. Renderer handling is:

- lower sequence: ignore;
- equal sequence and same event ID/change: idempotent ignore;
- equal sequence with different identity/content: discard local activity and refetch;
- next sequence: apply the sanitized upsert/remove;
- sequence gap: do not apply the delta; refetch the full snapshot;
- mount, focus after suspension, or preload reconnect: list once; no polling.

A late exact receipt upserts the existing Requested item. A session conflict/detachment emits remove. Outbox replay may redeliver the same event ID and sequence. Snapshot ordering follows §11 and snapshot schema parsing occurs in main, preload, and renderer boundary code.

Preload exposes only:

```ts
resourceActivity: {
  list(request: { runId: string }): Promise<ResourceActivityIpcResult<SessionResourceActivitySnapshot>>;
  onChanged(listener: (event: SessionResourceActivityChangedEvent) => void): () => void;
}
```

The listener validates every event and returns an unsubscribe function. There is no renderer mutation/evidence/correlation API.

### 12.3 Security

- Main process owns ingestion, qualification, correlation, persistence, and projection.
- Renderer cannot submit evidence, receipts, provider identity, status transitions, cancellation invocation IDs, sequence, or activity IDs for mutation.
- Logs use application activity ID, validated Resource ID, enum states, provider/version, and safe lineage IDs only. No raw evidence payload or private path.
- User-facing errors are fixed safe sentences; detailed sanitized reason codes remain main-process logs.
- Activity channels never share the Assignment mutation envelope or accept generic commands.

## 13. Service ownership

`ResourceActivityEvidenceService` owns the reducer and transaction boundary. It receives typed observations from:

- `CapabilityHostManager` for entered/outcome/cancel acknowledgement;
- provider adapters for raw structured request/terminal receipt evidence before normalization;
- `SkillService`/qualified provider receipt parsers for explicit request and context-entry evidence;
- Worktree Runtime manager for generation qualification and quarantine.

`WorktreeResourceAssignmentService` supplies immutable invocation-time Resource identity and generations but does not decide activity. `CapabilityService` and `SkillService` do not directly mark Used. Renderer DTO construction is separate from provider parsing.

## 14. Acceptance fixtures

Every supported provider/version must pass deterministic reducer tests and real-runtime sanitized fixtures for applicable paths.

### 14.1 Capability

- provider request rejected before host entry;
- successful entry/outcome;
- reported error, throw, timeout, and cancellation after entry;
- two concurrent sessions with distinct receipts;
- same-session retry with distinct receipt;
- runtime restart/history replay;
- duplicate live/history event;
- stale generation;
- same receipt claimed by two sessions;
- profile/lease switch;
- direct credential host call;
- provider abort without host cancellation;
- exact invocation cancellation;
- provider success/receipt without host entry spoof attempt;
- host entry without terminal provider receipt.

### 14.2 Skill

- explicit request with exact context receipt;
- explicit missing/failed load;
- automatic trusted load where observable;
- later model failure after successful load;
- command shadowing;
- partial body and digest mismatch;
- fake title/tool output;
- live/history replay and restart;
- wrong session/runtime/catalog generation;
- provider version/schema drift.

### 14.3 Privacy and migration

- database/IPC/log snapshots contain none of the forbidden data;
- Assignment revisions above JavaScript safe-integer range round-trip as exact canonical decimal text and compare through `BigInt`;
- request-start plus terminal receipt merges only through a stable provider request key; missing keys leave separate honest records;
- coverage gaps/format drift without invocations create coverage records and no synthetic activity;
- HMAC keys and raw receipts never cross IPC;
- loss/unavailability of a required local evidence key fails replay closed as `evidence_gap` while preserving previously canonicalized facts;
- legacy `loaded` never renders Used;
- run deletion and 30-day Unknown retention work as specified;
- retries remain separate while replay remains one record;
- activity snapshot/delta schemas reject malformed data and unauthorized run access;
- next-sequence delta applies, duplicate is idempotent, conflict/gap refetches, and late attribution upsert or conflict removal is ordered durably.

Fixture output stores only versions, booleans, counts, enums, and sanitized reason codes. Any provider failure yields Unknown/Unavailable, never a synthesized pass.

## 15. Traceability to #59

This specification adopts, rather than supersedes, #59:

| #59 requirement | Contract section |
|---|---|
| Keep Available (E0), Requested (E1), Used (E2), and outcome (E3) distinct | §§1–2, §5 |
| Capability Used only after validated handler entry | §§2.1, 6.1 |
| Skill Used only after exact context entry; automatic only with positive mode evidence | §§2.2, 4 |
| Never infer from discovery, permission, prose, success, timing, name, or current catalog | §§2.3, 5.2 |
| Preserve structured provider identity before renderer normalization | §§6–7, 12–13 |
| Invocation-time Resource/version/catalog identity and collision-safe mapping | §§3.1, 6.1 |
| Live/history replay deduplication; retry remains new | §§3.2, 7.1 |
| Unknown session and evidence coverage gaps remain explicit | §§2.3, 7, 11 |
| Legacy Skill `loaded` is bridge-completed, not verified Used | §10 |
| Persist minimal provenance without prompts/results/credentials/paths | §§3.2–3.4, 9, 12 |

Acceptance fixtures in §14 operationalize #59's successful Capability, pre-entry rejection, post-entry failure, permission denial, explicit/automatic Skill, collision/spoof, and reconnect/replay cases. #64 and #73 supply provider-specific executable evidence for those semantics.

## 16. Current release gates

This specification is implementation-ready, but provider claims remain gated:

1. Codex Capability session attribution requires #75 to prove terminal receipt preservation.
2. Codex Managed Skill release requires #74 to prove an exclusive atomic Skill snapshot/true explicit-only boundary.
3. OpenCode production parsers must qualify the installed SDK/CLI version pair.
4. Production bridge implementations must reproduce #64/#73 fixtures; prototype marker strings are not a production protocol.

Until those gates pass, the corresponding path remains unavailable or `Use not verified`. No fallback inference is authorized.

## 17. Decisions inherited by #57

- Requested, Used, outcome, mode, and attribution are independent.
- Used is E2 boundary evidence, not successful task completion.
- Session activity requires exact receipt correlation; Unknown is honest and excluded from session timelines.
- Evidence is replay-safe, append-only in observation, and monotonic in canonical strength.
- Persistence stores immutable Resource identity and keyed evidence digests only.
- Existing Skill `loaded` rows are legacy-unverified, never Used.
- No Capability activity is backfilled from availability or transcript data.
- Renderer wording distinguishes request from verified use and adds no new management surface.
