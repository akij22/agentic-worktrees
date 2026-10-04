# Worktree Resource Assignment coordinator implementation

Implements [Implement Worktree Resource Assignment coordinator](https://github.com/akij22/agentic-worktrees/issues/83) from the [Assignment implementation map](https://github.com/akij22/agentic-worktrees/issues/76). The normative contracts remain in `docs/specifications/worktree-resource-assignment-coordinator.md` and `docs/specifications/worktree-resource-assignment-persistence.md`.

## Behavior and integration contract

`WorktreeResourceAssignmentService` is the sole Assignment writer. Complete-set mutations check the caller's revision, resolve immutable Resource identities through their owners, and create an immutable target attempt. Waiting edits coalesce; applying edits become a later target. Static verification permits a commit with no running providers. Ordinary session and turn admission requires exact, durable runtime attestation; a successful static commit alone never authorizes an unattested process.

The runtime manager supplies writer-preferring Worktree admission, stable-idle inspection, control leases, and exact routing. Provider ports prepare frozen plans, stage all participants, activate and verify each, and roll back touched participants in reverse order on failure. Unknown ownership, unverifiable rollback, and post-commit cleanup failure enter Recovery required and close ordinary admission. The committed target survives cleanup failure. Finalization runs only after the durable commit.

A provider plan exposes both target and prior attestations, plus their catalog projection digests. Catalog metadata digests are distinct from effective-state digests. `stage`, `activate`, `verify`, `rollback`, `discard`, and `finalize` remain owner-controlled operations. A replacement plan reserves a fresh generation through `reserveAssignmentReplacement`; the old generation remains owned until commit. Verified startup cleanup must be reported through `WorktreeRuntimeStartupError`. Unverified startup failures remain ambiguous and require recovery. A control lease does not bypass ordinary session attestation.

Global update and uninstall operations establish a Resource barrier, acquire Worktree writers in stable ID order, refresh provisional membership, and freeze immutable targets before effects. Provisional removals remain possible. Freeze holds mutations and removal until the operation resolves. All affected desired sets, verified sets, revisions, attestations, parent disposition, and safe publication outbox rows commit in one SQLite transaction. Pre-effect cancellation or supersession changes no Assignment revision. Failed effects restore the prior global state or identify the Worktrees requiring recovery.

Session and turn callbacks hold the admission lease until the observable operation and its cancellation/drain finish. The lease includes the assignment generation, catalog generation, and revision for backend orchestration. These identifiers and provider plans must not be exposed directly to the renderer. Publication uses sanitized projections; failed deliveries stay in the durable outbox for retry and startup replay.

## Modified files

| File | Purpose |
| --- | --- |
| `src/main/assignments/worktree-resource-assignment-service.ts` | Public mutation, projection, recovery, admission, distribution, subscription, publication, and removal facade; local reconciliation and owner ports. |
| `src/main/assignments/assignment-coordinator-store.ts` | Transactional normalized persistence, immutable catalogs/attempts, CAS writes, participant journals, global parent decisions, and durable outbox. |
| `src/main/assignments/assignment-coordinator-projection.ts` | Sanitized Resource status, progress, failure, compatibility, and isolation projections. |
| `src/main/assignments/assignment-resource-distribution.ts` | Global barrier, stable lock ordering, refresh/freeze, atomic commit, reverse rollback, cancellation, supersession, and recovery. |
| `src/main/assignments/worktree-resource-assignment-service.test.ts` | 51 public-boundary integration tests using real SQLite, the runtime manager/verifier, and explicit observable provider ports. |
| `src/main/coding-agents/worktree-runtime-manager.ts` | Lifecycle inspection, exact retirement, bounded replacement reservation, rollback/finalization, and ownership-aware recovery/removal/shutdown. |
| `src/main/coding-agents/codex-worktree-runtime-factory.ts` | Reports verified cleanup after activation startup failure through the structured startup error. |
| `src/main/coding-agents/opencode-worktree-runtime-factory.ts` | The equivalent verified-cleanup startup contract for OpenCode. |
| `src/shared/db/assignment-activity-schema.ts` | Adds nullable `priorRuntimeGeneration` to the existing attempt participant journal. |
| `src/main/database/assignment-activity-bootstrap.ts` | Includes that column in fresh database bootstrap. |
| `src/main/database/index.ts` | Idempotent upgrade of an existing participant table; guards absent tables. |
| `src/main/database/migrations/0018_faithful_stone_men.sql` | Drizzle-generated migration for the prior runtime generation. |
| `src/main/database/migrations/meta/0018_snapshot.json` | Drizzle-generated schema snapshot. |
| `src/main/database/migrations/meta/_journal.json` | Drizzle-generated migration registration. |
| `docs/coding-agents/worktree-resource-assignment-coordinator.md` | This integration and verification handoff. |

The prior runtime generation is separate from the target generation so a replacement can recover its exact rollback participant. The column is nullable for historical records; recovery must not invent ownership from a missing journal value. Generated artifacts were produced with `npm run db:generate`.

## Verification

The 51 coordinator tests cover zero/one/two providers, exact attestation drift, stage/activation/verification faults, reverse rollback, unknown ownership, retry and revisioned cancellation, applying-target coalescing, busy admission, lazy verification, control-lane access, live exit invalidation, projection ordering, global atomic success/failure, provisional removal, uninstall, idempotency, cancellation/supersession, crash recovery, commit faults, durable outbox replay, and replacement success/failure at full ordinary capacity. Replacement cases include verified and unverified startup cleanup and finalization failure after commit.

`npm run typecheck`, focused ESLint across all eleven changed TypeScript files, and `git diff --check` pass. `npm test` reports 1,459 passing tests, 13 optional provider checks skipped, and the previously reproduced failure in `capability-block-policy.test.ts`: the existing signed block projection returns `installed` where the test expects `blocked`. Full lint retains eight existing errors and forty warnings outside the changed files. `npm run package` passes for macOS arm64, including production main, preload, renderer bundles, and native dependencies. No renderer component changed; packaging validates its build.

## Remaining map work

The coordinator is a backend module, with explicit Resource and provider ports. This ticket does not install a default application binding or add renderer flows. The next ticket adds thin typed IPC/preload access; subsequent tickets cover the requested UI and final bindings/release qualification. Real launched-provider qualification of the coordinator's replacement/distribution plans belongs to that final binding ticket; deterministic ports prove the coordinator protocol without claiming deployed provider support.

Keep Codex Skill isolation reported as `not_enforced`; the coordinator does not upgrade the provider's actual isolation posture. Capability Host, Skill, configuration, evidence, and provider owners retain their respective policies and side effects.
