# Worktree-scoped Resource Assignment and activity specification

Status: consolidated proposal for #57; implementation must not begin until final HITL approval.  
Scope: Assignment, isolated Worktree Runtimes, managed Capability/Skill execution, and honest session activity for Codex and OpenCode.

## 1. Normative specification set

This overview and the following documents form one normative specification. A production implementation must satisfy all of them.

1. [Assignment coordinator](./worktree-resource-assignment-coordinator.md) — ownership, generations, writer-preferring admission, stable-idle apply, attestation, rollback, recovery, and service interface.
2. [Persistence and migration](./worktree-resource-assignment-persistence.md) — normalized Assignment schema, transactions, journals, outbox, initial migration, cutover, and rollback safety.
3. [IPC and composer behavior](./worktree-resource-assignment-ipc-composer.md) — six narrow channels, shared schemas, complete-set optimistic writes, multi-window synchronization, accessibility, and phase-specific UX.
4. [Resource activity evidence](./resource-activity-evidence-contract.md) — Requested/Used/outcome semantics, exact session attribution, privacy-safe evidence, reconciliation, cancellation, legacy activity migration, and transcript wording.

If an overview summary appears less specific, the linked normative document controls. If two normative documents conflict during implementation, stop and reopen #57; do not choose by convenience.

## 2. Approved product contract

### 2.1 User-visible behavior

- Assignment is one exact complete set of Capability and Skill versions owned by a Worktree.
- Every session and window for a Worktree observes the same desired and verified Assignment.
- The coding-agent composer contains one Worktree Resources control. It is the only new user-facing Assignment surface.
- Marketplace remains responsible for install, update, remove, configuration, consent, and inspection.
- There is no new Resource page, dashboard, management screen, usage analytics, pack UI, recommendation UI, Project scope, or Global scope.
- New Worktrees begin with an empty Assignment.
- Assignment changes apply only when the Worktree is stably idle. Draft text remains editable while waiting/applying, but Send is disabled.
- Cancel/Stop remains available through the narrow control lane.
- Mid-apply edits do not mutate the in-flight generation. A later confirmed complete set coalesces as the next target.
- Applying is never shown as Enabled. Enabled means a verified Worktree generation and a matching attestation for the selected provider runtime.
- Activity appears only in the exact session where qualified evidence proves it. Unknown Worktree activity is hidden from session timelines.

### 2.2 Vocabulary

- **Resource** — internal tagged union of Capability or Skill; not MCP's resource-URI primitive.
- **Capability** — executable code hosted by the owned MCP Capability Host.
- **Skill** — immutable provider-native instruction content.
- **Managed Skill** — a Skill exposed through application-owned provider channels under the exact assigned allowlist.
- **Assignment** — desired and verified complete Resource set for one Worktree.
- **Worktree Runtime** — owned provider process generation keyed by `(agentKind, worktreeId)`.
- **Requested** — a trusted exact request; not proof of execution/load.
- **Used** — Capability handler entry or Skill context entry at the qualified E2 boundary.
- **Outcome** — success/error/timeout/cancellation after the relevant boundary; independent of Used.
- **Unknown** — evidence exists but exact session/use/coverage cannot be established.

Installed, Assigned, Enabled, Requested, Used, and Successful are distinct states.

## 3. System architecture

```text
Renderer composer/session transcript
        │ typed narrow preload API
        ▼
IPC handlers ─────────────── session activity projection
        │                               ▲
        ▼                               │
WorktreeResourceAssignmentService       │
  ├─ CapabilityService/HostManager ─────┤ entered/outcome receipts
  ├─ SkillService/provider projections ─┤ context-entry receipts
  ├─ WorktreeRuntimeManager ────────────┤ session routes/generations
  ├─ ResourceActivityEvidenceService ───┘
  └─ Assignment repositories/outbox
        │
        ▼
owned Codex/OpenCode Worktree Runtime
```

### 3.1 Ownership seams

`WorktreeResourceAssignmentService` is the sole Assignment writer and coordinator. It accepts complete desired sets, serializes reconciliation per Worktree, owns admission, and asks subsystem ports to prepare/apply/attest. It does not install packages, resolve secrets, parse provider evidence, or own child processes.

`CapabilityService` owns Capability installation/configuration validity and immutable host descriptors. `CapabilityHostManager` owns exact host catalog application and typed entered/outcome/cancel transport.

`SkillService` owns immutable Skill identity, content/policy validation, provider projection, collision rejection, and qualified context-entry parsing. It must not mark bridge completion Used.

`WorktreeRuntimeManager` owns process generations, leases, capacity, provider session-route registration, one-active-turn scheduling, attestation, crash handling, targeted shutdown, and quarantine.

`ResourceActivityEvidenceService` owns request/use/outcome reduction, exact receipt pairing, HMAC provenance, persistence, replay, coverage records, retention, and sanitized transcript DTOs. Provider adapters and hosts submit typed observations; they never write activity tables directly.

Renderer and preload never receive filesystem/process/database primitives, raw provider events, receipt IDs, provider session IDs, credentials, settings, paths, Skill bodies, prompts, or outputs.

## 4. Assignment consistency model

- Desired state and last verified generation are persisted separately.
- Every desired mutation is a complete-set replacement with observed optimistic revision. Assignment revision increments only for accepted desired-set changes; a separate projection sequence increments for every committed renderer-visible phase/progress/admission transition and orders outbox delivery.
- Resource identity pins kind, stable ID, exact version, content digest, security/policy digest, and provider projection identity.
- Assignment generation ID is a content-addressed text identity. Runtime generation ID is an opaque owned-process text identity. Catalog generation ID is a persisted content-addressed provider projection/qualification identity linked to exactly one Assignment generation/provider/version/adapter contract. These three domains are never numerically coerced or substituted.
- Equal complete sets reuse a content-addressed Assignment generation; a version/content/policy change creates another generation.
- One immutable attempt reconciles one target generation. Retry gets a new attempt ID; coalesced edits wait for the next attempt.
- A writer-preferring Worktree gate closes new session/create/resume/turn admission as soon as an Assignment writer queues.
- Stable idleness is checked before and after exclusive gate acquisition.
- Prepare has no provider side effects. Stage/activate/verify occurs only under exclusive admission.
- Commit requires exact attestations from every live compatible runtime participant.
- With no live runtime, static verification may commit without prewarming. Every later runtime must lazily apply and attest before admission.
- Failure rolls back participants in reverse order. Admission reopens only if the previous generation is exactly restored and verified.
- The failed desired target remains visible for retry, replacement, or explicit discard.
- Unknown current provider state enters `recovery_required`; no ordinary turn is admitted.
- Startup reconciliation derives state only from aggregate/attempt/participant/outbox records and runtime attestations, never timestamps or assumed side effects.

## 5. Worktree Runtime contract

### 5.1 Topology and isolation

- At most one live runtime generation exists for each `(agentKind, worktreeId)`.
- Provider sessions may share that Worktree Runtime but never share a runtime across Worktrees.
- Runtime credentials/config namespaces, discovery roots, catalogs, routes, processes, and attestations are Worktree-owned.
- Every provider session route is registered to one application run inside one runtime generation.
- Runtime generation and Assignment attestation are checked on session create, resume, and every turn.
- One active turn is allowed per runtime; separate Worktrees may execute concurrently within capacity.

### 5.2 Leases and lifecycle

- Session/turn/control operations acquire reference-counted runtime leases under a lifecycle lock.
- Runtime creation is lazy; Assignment changes do not prewarm absent providers.
- Idle begins only when active turn count and ordinary lease count are zero and no Assignment writer/control operation owns the runtime.
- Normal idle eviction occurs after 60 seconds.
- Under memory pressure, the least-recently-used eligible idle runtime is evicted immediately.
- Shutdown sends graceful provider termination, waits up to five seconds, then terminates only the verified owned process tree.
- Worktree removal drains admission, cancels owned work, shuts down exact runtimes, then applies database cascade behavior.
- Crash invalidates the runtime attestation and its session routes. Resume creates a strictly greater generation and re-attests before admission.
- Never kill by process name, path pattern, broad port range, or unverified PID.

### 5.3 Capacity

- Global live Worktree Runtime capacity is four.
- Per-provider capacity is also four; the global bound therefore remains authoritative for mixed runtimes.
- Capacity is identical on every machine; there is no unapproved low-memory mode.
- If all four slots are leased/busy, requests queue without evicting active runtimes.
- Eligible idle runtimes are evicted LRU to admit queued work.
- Capacity wait is surfaced as runtime availability/progress, not as an Assignment state mutation.
- The accepted benchmark risk is approximately 1.02 GB for four mixed Codex/OpenCode runtimes.

### 5.4 Quarantine

Quarantine scope is `(worktreeId, provider, runtimeGeneration)`. Conflicting receipt claims, lease/profile mismatch, cancellation ambiguity, parser drift, or unverifiable effective state closes ordinary admission for that generation. The control lane drains/stops it. Recovery starts a strictly greater generation, reapplies the verified Assignment, requalifies provider contracts, and creates fresh routes. Historical facts are not reassigned.

## 6. Managed Skill isolation

Managed Skill isolation guarantees exact allowlisted access through application-owned Skill channels. It is not a filesystem sandbox and does not promise confidentiality from arbitrary shell/filesystem access.

Every runtime generation requires:

1. a private provider namespace/configuration owned by that Worktree Runtime;
2. an immutable projection containing exactly assigned Skill ID/version/content/policy digests;
3. no global mutable catalog shared with another Worktree;
4. collision checks across names, commands, transformed names, baseline/provider Skills, and native explicit routes;
5. an atomic provider boundary that binds the verified projection to session start/resume/turn;
6. exact post-activation catalog/effective-state attestation;
7. fail-closed behavior on ambient discovery, schema drift, unverifiable baseline Skills, restart rediscovery, or mismatched generation.

Deny-list enumeration, filesystem watchers, renderer filtering, additive roots, “catalog hidden” settings, timing windows, and verify-then-start sequences are insufficient.

### 6.1 OpenCode

OpenCode 1.18.30 is conditionally enforceable only with private XDG/config/data/cache/state namespaces, disabled external/project discovery, an immutable assigned projection, verified builtin/command ownership, transformed-name collision rejection, and exact SDK/CLI fixture parity. Runtime restart requires complete re-verification.

### 6.2 Codex

Codex 0.154.0 is unavailable for Managed Skills. `skills/extraRoots/set` is additive; baseline and ambient Skills remain discoverable; `skills.include_instructions=false` does not disable explicit mention; per-path disables are not atomically bound to `thread/start`; and restart/resume may rediscover Skills.

Codex becomes eligible only when #74 proves, on a pinned provider version, an exclusive selected Skill snapshot/generation or semantically equivalent true explicit-only mode atomically bound to session/turn admission. OS mediation and OpenCode-only release are not accepted alternatives.

## 7. Capability invocation and cancellation

- The owned host creates an opaque invocation UUID after exact tool lookup and input validation and immediately before Capability code.
- Receipt generation, exception wrapping, timeout, and cancellation live outside Capability code.
- Typed host evidence includes entered and one terminal outcome: success, reported error, throw, timeout, or cancelled.
- Every post-entry MCP response preserves the receipt through a provider-version-qualified channel.
- Session pairing requires the same receipt in one trusted terminal provider event routed to one application run in the invocation-time runtime/Assignment/catalog generation.
- Host-only entry remains Used with session Unknown.
- Provider request without host entry remains Requested, not Used.
- Replay deduplicates; retry creates a new receipt/activity; stale generations are rejected; conflicting session claims are quarantined.
- A valid receipt from session B through profile/lease A attributes Use to B and quarantines the routing mismatch; credentials do not prove origin.

Provider abort and host cancellation are separate. The internal cancellation registry addresses `(runtimeGeneration, invocationId)` and is populated only by trusted host/adapter registration. Renderer Stop never supplies invocation IDs. Report `cancelled` only after the exact host outcome; process shutdown is recovery, not invocation-level proof.

## 8. Activity and privacy

The [activity evidence contract](./resource-activity-evidence-contract.md) is normative. Key release-level rules are:

- Capability E2 = validated handler entry.
- Skill E2 = exact complete-body context entry under an immutable assigned identity.
- Requested, Used, lifecycle, outcome, invocation mode, routing integrity, evidence coverage, and attribution are independent.
- Automatic Skill Used appears only with positive evidence that excludes an explicit route; absence is never rendered unused.
- Session Used requires exact qualified routing/correlation. Unknown/conflict activity is excluded from every session timeline.
- Legacy `skill_invocations.loaded` migrates as `Legacy request · Use not verified`, never Used.
- Capability activity is not backfilled from `session_capabilities`, normalized tool cards, current Assignment, names, or timing.
- Exact session activity and minimal evidence live with the run. Terminal Worktree-scoped Unknown/conflict and resolved coverage records expire after 30 days. Worktree deletion cascades all of them.
- Durable evidence uses domain-separated keyed digests; no raw provider/session/call IDs or host receipts persist.
- No prompt, argument, output, error text, Skill body, credential, token, header, private path, provider payload, or command template enters activity storage, logs, IPC, fixtures, or benchmarks.

## 9. Provider qualification and release gates

| Provider/path | Evidence/isolation result | Product status |
|---|---|---|
| OpenCode Capability explicit | #73 retained exact receipts for success/error/throw/timeout/retry/resume; exact cancellation side channel proven | Eligible after production bridge and SDK/CLI fixture parity |
| Codex Capability explicit | 0.154.0 host completed receipt-bearing SSE and JSON HTTP 200, but provider item remained nonterminal without retained receipt | Unavailable for per-session Used; #75 blocker |
| OpenCode Skill explicit command | #64 verified exact command-source/template/context evidence | Eligible after production parser and SDK/CLI fixture parity |
| OpenCode Skill automatic builtin | #64 verified trusted completed ToolPart/body evidence | Eligible where mode provenance is exact |
| Codex Skill explicit receipt | #64 verified private-rollout context injection | Receipt eligible, but Managed Skill channel unavailable pending #74 |
| Codex Skill automatic | no reliable positive context-entry evidence | Unknown/unavailable |
| OpenCode Managed Skill isolation | conditionally enforceable private namespace | Eligible after production isolation fixtures |
| Codex Managed Skill isolation | 0.154.0 has no atomic exclusive projection | Unavailable; #74 blocker |

Every supported provider and exact CLI/SDK/parser combination starts unavailable until executable qualification succeeds. Failure, missing auth/model, schema drift, or provider outage yields Unknown/Unavailable, never an inferred pass.

The unified user-facing feature must not ship OpenCode-only. Production infrastructure may be implemented behind unavailable gates, but release requires both #74 and #75 (or pinned replacements proving the same contracts) and all acceptance gates below.

## 10. IPC and UI contract

Exactly six Assignment channels exist: get, set desired complete set, retry, cancel pending, recover, and changed event. Session activity adds exactly two separate channels: list snapshot and changed delta. Assignment contracts live only in `src/shared/assignments/schemas.ts`; activity contracts live only in `src/shared/resource-activity/schemas.ts`. Shared Zod schemas are the only wire definitions. Every invoke returns a structured success/error envelope. Main validates every payload and Worktree/run ownership.

The renderer:

- opens one accessible Resources popover/dialog from the composer;
- groups assigned and available validated Resources without exposing backend tables/orchestration;
- submits the complete selected set with observed revision;
- handles loading, empty, setup-required, conflict, waiting, applying, rollback, failure, recovery, removal, and provider-unavailable states;
- preserves a draft during waiting/apply and keeps Cancel/Stop reachable;
- orders Assignment projections by monotonic projection sequence (revision remains the optimistic mutation token), orders activity by per-run stream sequence, and refetches on gaps;
- receives full sanitized activity DTOs only for the exact run;
- uses `requested`, `used`, `used automatically`, `failed`, `timed out`, `cancelled`, `outcome not verified`, and `legacy/use not verified` wording exactly as specified;
- never polls when revisioned events are healthy and never derives state from provider transcript prose.

No generic IPC command, raw database entity, provider configuration, environment variable, filesystem primitive, token, receipt, invocation ID, generation digest, or internal error crosses preload.

## 11. Migration and cutover

### 11.1 Assignment

- Run once under an exclusive migration key and two-transaction journal.
- For each existing Worktree, union exact currently active Capability versions across its sessions.
- Any conflicting active Capability versions fail that Worktree closed; do not choose newest/first.
- Add every currently usable installed Skill to every existing Worktree, as approved for initial migration.
- Migration preflight is global and fail-closed: a missing/mismatched/unconfigured active Capability, conflicting active Capability version, broken Worktree/run reference, or invalid included Skill metadata records a safe migration failure and leaves legacy behavior authoritative for every Worktree. It does not create partially blocked new aggregates.
- Skills in `pending_verification` or `invalid` state are explicitly excluded by the approved migration rule. An otherwise valid installed Skill with provider incompatibility remains assigned with an `unavailable` provider projection; it is not silently omitted.
- Persist a revision-zero desired/verified baseline after static verification. Live/future runtimes must attest lazily before admission.
- New Worktrees created after cutover start empty.
- Preserve `session_capabilities` byte-for-byte and read-only after verified cutover.

### 11.2 Activity

- Migrate valid legacy `skill_invocations` as exact application-owned legacy requests attached to their existing run.
- Legacy `loaded` proves bridge completion only; render Use not verified.
- Preserve the legacy table read-only for rollback and stop new writes after cutover.
- Do not backfill Capability/Skill Used from activation rows or normalized transcripts.

Schema changes use Drizzle generation (`npm run db:generate`); generated artifacts are never hand-edited. Cutover switches reads only after row-count, constraints, privacy, rollback, renderer, and provider-admission checks succeed transactionally.

## 12. End-to-end acceptance matrix

### 12.1 Assignment state and concurrency

- empty new Worktree;
- initial migrated Worktree with Capability union and all usable Skills;
- conflicting legacy Capability versions fail closed;
- complete-set mutation with current and stale revisions;
- equal set/no-op and content/version/policy change;
- two windows submit concurrently; loser receives current full projection;
- writer queues while session active; all new create/resume/turn work stops;
- stable-idle double check catches a racing turn;
- mid-apply edit coalesces as a later immutable target;
- apply succeeds across zero, one, and both provider runtime participants;
- one participant fails stage/activate/attest; reverse rollback verifies prior generation;
- rollback uncertainty enters recovery required;
- restart during every durable phase reconciles without inference;
- prior verified generation admits after verified rollback while failed desired remains visible;
- static commit with no runtime and lazy attestation on next provider admission;
- Resource update/uninstall during pending/apply;
- global Resource distribution installs a Resource mutation barrier, refreshes provisional participants after mutations already ahead of its writers, allows removals but rejects new add/re-pin writes with `resource_update_pending`, freezes every affected prior revision only after all gates match, leaves aggregate desired/verified state unchanged during provider staging, then increments each affected revision exactly once and commits all desired/verified targets atomically or none;
- pre-commit failure rolls back all accepted provider effects, restores the prior stable projection, and does not increment Assignment revisions;
- crash at distribution parent creation, participant freeze, each gate/stage/activate boundary, global pre-commit/commit, and each rollback boundary;
- queued distribution refresh after ordinary mutation/removal, Resource-barrier rejection, target-version supersession, and explicit pre-effect cancellation;
- concurrent desired mutation and Worktree removal queue behind the frozen global participant; orphan child attempts enter recovery;
- Worktree removal while idle, busy, waiting, applying, and recovering.

### 12.2 Runtime lifecycle and capacity

- exact `(agentKind, worktreeId)` reuse and cross-Worktree non-sharing;
- separate provider sessions route to separate application runs;
- one active turn per runtime;
- four live mixed runtimes; fifth queues or evicts eligible LRU idle runtime;
- no active/leased runtime eviction;
- 60-second idle eviction and immediate memory-pressure idle eviction;
- five-second graceful then targeted owned-tree shutdown;
- process crash invalidates attestation/routes and requires a greater generation;
- app exit and Worktree deletion terminate only verified owned PIDs;
- queue cancellation removes only the requesting waiter;
- Assignment writer/control lane cannot deadlock behind ordinary runtime capacity.

### 12.3 Managed Skill isolation

For each qualified provider/version:

- two Worktrees with disjoint assigned Skills cannot discover/invoke each other's Skill through any managed channel;
- unassigned explicit mention/command/native input fails before provider turn admission;
- automatic catalog includes exactly assigned eligible Skills;
- baseline, project, home, ambient, extension/plugin, command, and transformed-name collisions fail closed;
- Skill install/update/uninstall cannot mutate a live immutable projection;
- verify-to-turn race cannot introduce an ambient Skill;
- restart/resume cannot rediscover unassigned Skills;
- provider version/parser/config drift closes admission;
- filesystem read of a Skill does not emit Skill Used and is not claimed isolated.

### 12.4 Capability evidence and cancellation

For each qualified provider/version:

- exact provider request rejected before handler entry remains Requested;
- success, reported error, throw, timeout, and cancellation after entry remain Used with correct outcome;
- two concurrent sessions preserve distinct receipts;
- same-session retry produces a distinct activity;
- live/history replay deduplicates;
- restart history pairs only against immutable recorded generation lineage;
- stale/unknown generation is rejected;
- duplicate same event is idempotent; changed duplicate quarantines;
- same receipt claimed by two sessions becomes conflict/Unknown;
- profile A call originating in session B remains B and quarantines mismatch;
- direct credential invocation is Worktree Used/session Unknown;
- spoofed model/Capability receipt without trusted host evidence is ignored;
- provider abort without host cancellation is not rendered cancelled;
- exact invocation cancellation reaches only its active handler;
- renderer cannot view or submit invocation IDs.

### 12.5 Skill evidence

For each qualified provider/version/path:

- explicit request is distinct from context entry;
- exact full-body digest receipt emits Used;
- missing file/load, partial body, digest mismatch, shadowed command, fake title/tool output, or untrusted plugin never emits Used;
- verified automatic route emits `used automatically`; ambiguous mode emits Used without automatic label;
- later model/task failure does not erase successful context entry;
- wrong session/runtime/catalog generation fails closed;
- live/history/restart replay deduplicates while retry remains new;
- Codex automatic remains Unknown until a positive qualified boundary exists.

### 12.6 IPC, renderer, accessibility, and privacy

- malformed/oversized/unknown IDs and unauthorized Worktree/run access are rejected in main;
- stale multi-window events never regress revision; revision gaps refetch;
- drafts survive waiting/apply projection changes;
- Send/focus/keyboard/focus-return/status announcements match the IPC/composer spec;
- every Assignment and activity loading/empty/error/recovery state has safe wording;
- no additional route/navigation/management UI exists;
- database, logs, IPC snapshots, fixtures, and benchmark artifacts contain none of the forbidden sensitive classes;
- HMAC loss/drift fails replay closed without erasing prior canonical facts;
- run/Worktree deletion and 30-day retention cascades are exact;
- legacy loaded rows never render Used.

## 13. Verification strategy

Implementation uses TDD and the narrowest check first:

1. pure state/reducer/model tests;
2. repository transaction/migration fixtures against isolated SQLite;
3. host/adapter protocol contract tests with inert Resources;
4. main/preload IPC tests;
5. renderer interaction/accessibility tests;
6. runtime lifecycle/capacity/process-ownership tests;
7. sanitized live provider qualification probes on pinned versions;
8. full `npm run typecheck`, `npm run lint`, `npm test`, and renderer build;
9. `npm run db:generate` after schema changes and generated migration verification;
10. packaging check only when main/preload/native assembly changes warrant it.

Real-provider fixtures emit only versions, booleans, counts, enums, and sanitized reason codes. Missing credentials/models/provider service produce an explicit skipped/unavailable qualification, never a pass. A reviewed fixture is tied to exact CLI, SDK, parser contract, platform assumptions, and source commit.

## 14. Implementation sequence after approval

Each implementation ticket uses its own branch and worktree and preserves the dirty main Worktree.

1. Central shared schemas and immutable Assignment/Activity domain reducers, test-first.
2. Drizzle Assignment/activity/session-route/coverage schema and generated migration, repository transactions, initial migration, and rollback fixtures.
3. Worktree Runtime manager topology, leases, capacity, process ownership, generation lineage, session routes, and quarantine.
4. Capability Host typed receipt/outcome/cancellation bridge and activity ingestion.
5. OpenCode isolated projection plus Capability/Skill evidence parsers at an exact qualified SDK/CLI version.
6. Codex exclusive Skill boundary and terminal Capability receipt integration only after #74/#75 qualification.
7. `WorktreeResourceAssignmentService`, participant ports, admission integration, attestations, rollback, recovery, and outbox.
8. Six IPC/preload channels and full projection events.
9. Composer Resources control and existing transcript activity wording.
10. Transactional cutover, live cross-provider matrix, security/privacy review, and release gate.

No implementation ticket may weaken a failed provider gate, introduce an OpenCode-only user release, or replace exact evidence with inference.

## 15. Out of scope

- npm distribution for Skills;
- multi-Resource package manifests;
- Project or Global Assignment scope;
- Capability Packs or recommendations;
- a general Pi-like Extension API;
- filesystem sandboxing/confidentiality as part of Managed Skill isolation;
- aggregated Worktree activity history, analytics, statistics, or administration UI;
- storing or displaying prompts, outputs, Skill bodies, credentials, private paths, provider session IDs, or raw provider evidence.

## 16. Final approval gate

Approval of this specification authorizes creation of separate implementation tickets/worktrees only. It does not waive #74/#75 or mark any provider path qualified.

The implementation may be called complete only when:

- every normative specification acceptance criterion passes;
- all required real-provider paths are qualified on pinned supported versions;
- Codex and OpenCode both satisfy Managed Skill isolation and explicit Resource-use evidence;
- migrations, rollback, recovery, cancellation, privacy, accessibility, and multi-window behavior pass;
- no provider failure is represented as success/Used/isolated;
- the unified feature can ship without provider-specific semantic dishonesty.
