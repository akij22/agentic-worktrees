# Worktree Resources cross-provider release qualification

Implementation and qualification are complete for [Cut over and qualify Worktree Resources cross-provider release](https://github.com/akij22/agentic-worktrees/issues/86), the final ticket in the [implementation map](https://github.com/akij22/agentic-worktrees/issues/76). This report qualifies the review branch; it does not claim a merged or published release.

## Result and verification

Default UI and CLI application startup now own transactional Assignment cutover, provider routing, generation-scoped Capability Hosts, resource distribution and sanitized activity. Legacy writes are guarded after cutover. Resource and filesystem commits participate in all affected Assignment barriers, with verified rollback or fail-closed recovery. Send/compaction hold admission until terminal events; deletion and exit require exact owned cleanup.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npm test` | 199 files passed, one skipped; 1,517 tests passed, 14 provider gates skipped in the ordinary run. |
| Pinned-provider run below | Three files, 56 tests passed, zero skipped; exercises all 14 provider gates. |
| `npm run lint` | Zero errors, 35 nonfatal warnings. |
| `npm run package` | Passed on macOS arm64, including both native dependencies and production main/preload/renderer builds. |
| Real committed migrations | Fresh SQLite migration through Drizzle plus release cutover passed in the full suite. |

The real-provider command used temporary, exact pinned installations outside the repository:

```sh
AW_CODEX_QUALIFICATION_BINARY=/tmp/aw-resource-release-providers.vCRCOX/node_modules/.bin/codex AW_OPENCODE_QUALIFICATION_BINARY=/tmp/aw-resource-release-providers.vCRCOX/node_modules/.bin/opencode npm test -- src/main/application-resource-qualification.test.ts src/main/coding-agents/codex-worktree-runtime.test.ts src/main/coding-agents/opencode-worktree-runtime.test.ts
```

Codex is pinned to **0.154.0**, OpenCode to **1.18.30**. The fixture supplies inert local model protocol responses; the provider executables, runtime ownership, Capability Host, evidence service and durable database are real. This qualifies protocol and evidence behavior, not model answer quality. Qualification artifacts do not retain prompts, outputs, Skill bodies, credentials, private paths or raw provider receipts/events.

No schema definitions changed. A known initial generated SQL defect prevented the actual Drizzle migrator from executing multiple statements; the only migration artifact repair adds statement separators, with unchanged SQL. The fresh-database test proves the repaired committed migration chain works.

## Acceptance matrix

The normative source is [the approved specification](../specifications/worktree-resource-assignment.md), especially its complete acceptance matrix and release requirements. The following groups cover that matrix through the previously approved public test boundaries.

| Acceptance group | Evidence |
| --- | --- |
| Complete-set Assignment, ordering, admission, stale revisions/proofs, no-op generations, recovery, capacity, global barriers and restart/outbox behavior | `assignment-repository.test.ts`, `resource-distribution-repository.test.ts`, `worktree-resource-assignment-service.test.ts`, `worktree-runtime-manager.test.ts`, `worktree-runtime-attestation-verifier.test.ts`, and application runtime/startup/package tests. |
| Global preflight, orphan references, actual resource identities, verified source/count fingerprint, transactional cutover/rollback and read-only legacy authority | `assignment-migrator.test.ts` and `database/resource-cutover.test.ts`, including committed generated migrations. Legacy activity imports remain unconfirmed; no Used backfill. |
| Exact process ownership, startup failure, terminal cancellation, compaction, teardown and unavailable/unknown cleanup | Runtime-manager, Capability Host manager/server and both adapter suites; application runtime/startup/package tests verify held admission and exact Host shutdown. Failed startup ownership remains tracked until exit proof. |
| OpenCode isolated Skill catalog and native Capability/Skill evidence | All 26 OpenCode tests, including four real-provider scenarios. Explicit arguments match native append/trim behavior. Automatic Skill loading is only qualified through exact native history; unsupported expansions remain Unknown. |
| Codex assigned explicit Skills, terminal MCP/history evidence and persistent isolation disclosure | All 29 Codex tests, including nine real-provider scenarios. Codex remains `skillIsolation = not_enforced`; optional filesystem hardening is outside this release. |
| Mixed-provider application authority | Real default-owner qualification test exercises assigned Skills and a shared Capability with both pinned providers, positive activity, restart/resume without replay promotion, key rotation and Worktree deletion. |
| Exact-session pairing, replay/conflict/spoof handling, cancellation, bounded retention and sanitized snapshots | Shared activity reducer/schema tests and `resource-activity-evidence-service.test.ts` / repository tests; application qualification verifies retained privacy and route restoration. Retired runtime contracts keep digests/identities, not full Skill bodies, with bounded lifetime/capacity. |
| Managed Capability install/update/remove, configuration and Skill distribution across affected Worktrees | Application package/startup tests exercise the actual acquirer, inspector, disposable verifier and default installers, held-turn barriers, owner rollback, prior-pointer journal recovery, quarantine and removal. |
| Authorized narrow IPC/preload, trusted documents, exact run ownership and multi-window ordered publication | Resource IPC handler/integration tests, preload suites, application access/startup tests; model mutation and permission responses also pass through owner admission authorization. |
| Composer Resources, drafts, Send/Stop, explicit Skills, keyboard/focus/accessibility and activity UI | Existing renderer Resources/composer/transcript suites pass in the full run; no new management screen or interaction redesign. Production renderer build passes. |
| Worktree deletion and application exit | Coordinator tests cover busy, waiting, applying and recovery states, retained run/activity cascades and actual external deletion ordering. Failed Git deletion keeps facts and closes Send until removal retry; mixed-provider qualification verifies exact Hosts stop and records cascade. |
| Native/package/privacy and rollback | macOS arm64 package passes; key-loss/rotation and transactional recovery cases pass; procedures below cover offline operational rollback. |

Durable **activity storage and Resource IPC** exclude raw provider IDs/events, bodies, prompts, outputs, credentials and private paths. Existing private coding-session metadata needed for verified routing remains confined to the main-process domain; this is not a claim that every application database table contains only activity DTOs.

## Operational recovery and rollback

Before cutover, stop the application and verify owned children have exited. Keep a consistent SQLite backup (including WAL state through the SQLite backup mechanism), matching managed package/Skill files and configuration, the evidence key/version history, and the matching application build outside Git. A failed preflight or transactional cutover leaves the legacy source unchanged and no verified release marker; a bounded failed audit record may remain. Correct the source/configuration/key problem and retry the complete cutover.

After cutover, retain legacy write guards. Missing keys, invalid resource identities and unverified process cleanup close admission as Unknown/Unavailable or `recovery_required`. Use the public expected-revision recovery operations (`retry_recovery` or `rollback_then_retry`) and startup journal reconciliation. Restore a prior resource pointer only after proving the complete prior owner state; uncertain compensation stays quarantined. Restart never promotes a request into Used, and supported key rotation retains canonical facts using configured previous keys.

If full operational rollback is necessary, stop the application and verify owned processes, then restore the **whole compatible database, resource files, configuration, evidence keys and application build as one offline unit**. Do not reverse individual activity rows, remove guards, hot-swap partial state or run an older legacy writer against the cut-over database. No user-data rollback was performed during qualification.

If external Git deletion fails, the Worktree remains in removing state with durable facts intact and Send closed. Correct the external failure and retry removal; exact owned runtime/Host cleanup precedes transactional record deletion. A missing cancellation terminal event is never reported as verified cancellation.

## Limits

The provider pins are strict; a different installed version requires renewed qualification. OpenCode isolation is `enforced`; Codex isolation is persistently disclosed as `not_enforced`, and access outside assigned Skill exposure is not guaranteed blocked. Packaging was verified on the current macOS arm64 platform; Windows/Linux installers, publishing and merging are not part of this qualification. Lint retains 35 nonfatal warnings. Provider history remains private inside owned provider namespaces; activity snapshots retain only qualified sanitized facts.

## Changed files

| File | Purpose |
| --- | --- |
| `.env.example` | Document persistent evidence HMAC configuration and rotation inputs. |
| `docs/coding-agents/worktree-resource-release.md` | Record complete release verification, acceptance coverage, operational rollback, limitations and every changed file. |
| `scripts/capability-smoke/local-lifecycle.test.ts` | Replace an empty fixture callback to clear a baseline lint error. |
| `src/main-lifecycle.test.ts` | Keep the Electron lifecycle boundary fixture compatible with window ownership cleanup. |
| `src/main/application-bootstrap.ts` | Register trusted renderer windows and retain service ownership safely across CLI/UI lifecycle callbacks. |
| `src/main/application-resource-access.test.ts` | Verify main-created renderer and exact run/Worktree authorization. |
| `src/main/application-resource-access.ts` | Track trusted renderer documents and enforce persisted run ownership. |
| `src/main/application-resource-package.test.ts` | Exercise actual package acquisition, verification, installation, global updates, rollback, quarantine, unexpected exits and removal. |
| `src/main/application-resource-qualification.test.ts` | Launch both pinned providers through default owners; qualify explicit Skills/Capabilities, key rotation, restart/resume, privacy and deletion. |
| `src/main/application-resource-runtime.test.ts` | Exercise real database, launched adapters, admission, isolation, restart, replacement and drain behavior. |
| `src/main/application-resource-runtime.ts` | Own runtimes, generation-scoped Hosts, durable routes, terminal admission leases and global resource owners; quarantine uncertain cleanup and bound retained digest contracts. |
| `src/main/application-resource-startup.test.ts` | Exercise application startup, trusted IPC, compiled Host workers, live turns/Skills/compaction, global barriers, failure cleanup and verified teardown. |
| `src/main/application-services.ts` | Bind cutover, Assignment, evidence, provider and Capability Host owners at application startup; connect Skill and Capability configuration distribution; drain on exit. |
| `src/main/assignments/application-resource-catalog.ts` | Resolve exact installed resources and stage validated Skill/configuration identities for replacement before owner commit. |
| `src/main/assignments/assignment-coordinator-store.ts` | Compose immediate transactions; delete retained runs, activity lineage and dependent Worktree records atomically after owned shutdown. |
| `src/main/assignments/assignment-migrator.test.ts` | Verify global orphan-reference preflight rolls back migration. |
| `src/main/assignments/assignment-migrator.ts` | Reject orphan legacy resource references and run release verification inside migration transaction. |
| `src/main/assignments/assignment-resource-distribution.ts` | Stage, commit and compensate resource owners inside the global Assignment barrier; publish projections after the owner commit. |
| `src/main/assignments/database-assignment-migration-catalog.ts` | Resolve exact reviewed installed resources, actual bundle digests and canonical configuration/Skill identities. |
| `src/main/assignments/worktree-resource-assignment-service.test.ts` | Cover stale admission proofs, retained-run cascades and busy/waiting/applying/recovery deletion barriers. |
| `src/main/assignments/worktree-resource-assignment-service.ts` | Reject stale Skill proofs across asynchronous admission; preserve unchanged generations and library availability; hold Worktree removal through external deletion and durable cleanup. |
| `src/main/capabilities/capability-distribution-service.ts` | Bind actual package operations and active-run checks to Assignment ownership; prove restored prior pointers before clearing a failed package journal. |
| `src/main/capabilities/capability-host-manager.test.ts` | Verify shutdown waits for the exact owned child exit. |
| `src/main/capabilities/capability-host-manager.ts` | Stop exact generation-owned Hosts and launch with centrally filtered environment and trusted bundle path. |
| `src/main/capabilities/capability-package-installer.ts` | Stage managed package files and commit resource metadata through the global Assignment transaction. |
| `src/main/capabilities/capability-removal-installer.ts` | Stage removal and compensate filesystem changes through the global owner barrier. |
| `src/main/capabilities/capability-removal-service.ts` | Use owned admission/run checks and transactional removal instead of legacy resource writers. |
| `src/main/capabilities/capability-resource-owner.ts` | Define the narrow staged package owner transaction and reviewed active-run boundary. |
| `src/main/capabilities/capability-service.ts` | Commit configuration through the application Assignment distribution owner and compensate newly stored secrets on failure. |
| `src/main/capabilities/catalog.ts` | Preserve signed blocking for a bundled entry when the installed blocked version matches it. |
| `src/main/capabilities/package-verifier.ts` | Make the verifier timeout handle constant to clear a baseline lint error. |
| `src/main/capabilities/web-search-migration.test.ts` | Replace an empty verifier fixture callback to clear a baseline lint error. |
| `src/main/coding-agents/codex-adapter.ts` | Read owned history after compaction acknowledgement to identify the turn required for Stop. |
| `src/main/coding-agents/codex-worktree-runtime-factory.ts` | Retain evidence ownership until attested retirement and preserve exact startup cleanup outcomes. |
| `src/main/coding-agents/codex-worktree-runtime.ts` | Retain Skill identity/body digests rather than cloned bodies in evidence contracts. |
| `src/main/coding-agents/coding-agent-service.ts` | Route create/resume/send/Skill/compaction/cancel through application Resource owners and close legacy fallbacks after cutover. |
| `src/main/coding-agents/fixtures/codex-local-responses-fixture.ts` | Provide inert local Responses and Chat Completions streams for native provider qualification without retaining requests. |
| `src/main/coding-agents/fixtures/codex-runtime-provider.mjs` | Model durable synthetic thread history, interrupted turns, model catalog and compaction over the launched protocol. |
| `src/main/coding-agents/fixtures/opencode-runtime-provider.mjs` | Model native explicit Skill argument append/trim behavior. |
| `src/main/coding-agents/opencode-adapter.ts` | Pass explicit Skill arguments into exact context qualification. |
| `src/main/coding-agents/opencode-resource-evidence.ts` | Match the exact native expanded Skill context and retain body digests rather than full bodies. |
| `src/main/coding-agents/opencode-worktree-runtime-factory.ts` | Drain generation-owned Hosts on unexpected provider exit; quarantine uncertain cleanup and avoid retiring unattested candidates. |
| `src/main/coding-agents/opencode-worktree-runtime.test.ts` | Qualify explicit Skill arguments and actual native Capability terminal outcomes through local model protocols. |
| `src/main/coding-agents/opencode-worktree-runtime.ts` | Verify effective state and trusted local qualification model configuration against the launched provider. |
| `src/main/coding-agents/primary-workspace-service.test.ts` | Supply the real SQLite boundary for transactional Worktree persistence. |
| `src/main/coding-agents/primary-workspace-service.ts` | Persist primary Worktree and its initial Assignment atomically. |
| `src/main/coding-agents/types.ts` | Carry exact Skill version for managed explicit invocation. |
| `src/main/coding-agents/worktree-runtime-manager.ts` | Permit resume routing only from main-process verified durable session ownership. |
| `src/main/config/env.ts` | Centralize provider environment filtering and evidence-key parsing, versions and previous keys. |
| `src/main/database/migrations/0000_initial.sql` | Repair a known generated-artifact formatting defect by adding Drizzle statement separators; SQL and schema stay identical. |
| `src/main/database/resource-cutover.test.ts` | Verify transactional migration, legacy keyed facts, source/count fingerprints, write guards, rollback and actual committed Drizzle migrations. |
| `src/main/database/resource-cutover.ts` | Switch authority transactionally, import legacy requests as unconfirmed keyed facts and guard legacy writes; initialize new Worktree Assignments atomically. |
| `src/main/ipc/github-auth-handlers.test.ts` | Verify bounded admission errors while preserving authenticated application operations. |
| `src/main/ipc/index.ts` | Authorize Resource-owned session, turn, compaction, model and permission operations through bounded admission results. |
| `src/main/ipc/marketplace-handlers.test.ts` | Remove a redundant regex escape to clear a baseline lint error. |
| `src/main/ipc/resource-assignment-handlers.ts` | Narrow structured failure typing for generic admission responses. |
| `src/main/ipc/resource-ipc.ts` | Validate payload size/schema, renderer ownership and exact run/Worktree access around admission. |
| `src/main/packages/catalog/official-catalog.ts` | Use an unconditional for-loop to clear a baseline constant-condition lint error. |
| `src/main/skills/skill-service.ts` | Distribute install/update/removal through Assignment owner callbacks, preserving reversible filesystem staging. |
| `src/main/skills/skill-validation.ts` | Validate canonical immutable version directories against the expected Skill ID. |
| `src/main/worktrees/worktree-service.ts` | Persist linked Worktree and its empty initial Assignment in one transaction. |
| `src/preload-auth.test.ts` | Verify DTO sanitization through the typed admission envelope. |
| `src/preload-resources.ts` | Decode bounded admission results and raise typed ResourceAdmissionError. |
| `src/preload.test.ts` | Verify rejected Send and successful void admission responses. |
| `src/preload.ts` | Decode create/read/send/abort/compact results while preserving the renderer-facing API. |
| `src/renderer/pages/Dashboard.tsx` | Correct mixed indentation only; preserve existing UI behavior. |
