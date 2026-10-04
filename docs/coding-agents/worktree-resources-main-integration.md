# Worktree Resources integration into main

Integrates the merged [release PR](https://github.com/akij22/agentic-worktrees/pull/90) and its complete dependency history into main at `8513cbb`. The source is `feat/worktree-composer-resources` at `976af66`. A separate integration worktree preserves the release checkout and unrelated working directories.

## Resolutions

Preserve main’s landing-message submission/retry flow, navigation, compact toolbar, context row and nullable usage handling. Combine those with complete-set Resource admission, exact runtime ownership, verified activity and saved-chat availability. Resource controls replace legacy activation controls; the existing accessible session context disclosure moves to the chat row instead of returning to the header.

Main and the Resource stack independently created migration 13. Keep main’s deployed migration 13 and regenerate the combined final schema with `npm run db:generate` as migration 14. The Resource-only conflicting artifacts are omitted from this integration history. Fresh committed migrations and cutover pass. Main’s newer Worktree Capability selections join the initial exact Resource union, global preflight and source verification; both legacy tables are read-only after cutover, with parent-deletion cascades allowed. Existing verified releases also install the additional guard on startup.

## Verification

- Type checking passed.
- Full suite: 207 test files and 1,618 tests passed; one file and 14 provider gates skipped in the ordinary run.
- Lint: zero errors, 37 warnings.
- macOS arm64 package passed, including both native modules and production main/preload/renderer builds.
- Migration/cutover regressions: 14 passed; the new Worktree-only selection and write-guard checks failed before their fixes and passed afterwards.
- Pinned-provider recheck: 55 tests passed, with the mixed-provider scenario timing out in the combined run. Its focused rerun passed in 4.43 seconds; all 14 gates have passing results. The concurrent qualification timeout remains a documented reliability limitation.

No publishing is performed. OpenCode isolation remains enforced; Codex remains persistently disclosed as not enforced. Packaging is verified only on macOS arm64. Deployment recovery and persistent evidence-key requirements remain those in [the release report](worktree-resource-release.md).

## Files entering main

The table includes the approved dependency-stack files as well as integration resolutions. Earlier ticket reports explain each originating implementation in depth; this merge preserves their history.

| File | Purpose |
| --- | --- |
| `.env.example` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `docs/coding-agents/codex-worktree-resources.md` | Integrate the approved implementation from the Resource stack: Integrate owned Codex Worktree Runtime and exact Resource evidence. |
| `docs/coding-agents/composer-resources-activity-ui.md` | Integrate the approved implementation from the Resource stack: Implement Worktree Resources composer and exact session activity. |
| `docs/coding-agents/opencode-worktree-resources.md` | Integrate the approved implementation from the Resource stack: Implement qualified OpenCode Worktree Resource runtimes. |
| `docs/coding-agents/worktree-assignment-activity-ipc.md` | Integrate the approved implementation from the Resource stack: Implement narrow Assignment and activity IPC contracts. |
| `docs/coding-agents/worktree-resource-assignment-coordinator.md` | Integrate the approved implementation from the Resource stack: Implement transactional Worktree Resource Assignment coordination. |
| `docs/coding-agents/worktree-resource-release.md` | Integrate the approved implementation from the Resource stack: Preserve saved chat snapshots when managed runtime resume fails. |
| `docs/coding-agents/worktree-resources-main-integration.md` | Record integration intent, conflict resolutions, verification, limitations and every file entering main. |
| `docs/specifications/resource-activity-evidence-contract.md` | Integrate the approved implementation from the Resource stack: Allow explicit Codex Skills without Worktree isolation. |
| `docs/specifications/worktree-resource-assignment-coordinator.md` | Integrate the approved implementation from the Resource stack: Allow explicit Codex Skills without Worktree isolation. |
| `docs/specifications/worktree-resource-assignment-ipc-composer.md` | Integrate the approved implementation from the Resource stack: Allow explicit Codex Skills without Worktree isolation. |
| `docs/specifications/worktree-resource-assignment-persistence.md` | Integrate the approved implementation from the Resource stack: Allow explicit Codex Skills without Worktree isolation. |
| `docs/specifications/worktree-resource-assignment.md` | Integrate the approved implementation from the Resource stack: Allow explicit Codex Skills without Worktree isolation. |
| `drizzle.config.ts` | Integrate the approved implementation from the Resource stack: Implement Assignment and activity persistence. |
| `package-lock.json` | Integrate the approved implementation from the Resource stack: Implement qualified OpenCode Worktree Resource runtimes. |
| `package.json` | Integrate the approved implementation from the Resource stack: Integrate owned Codex Worktree Runtime and exact Resource evidence. |
| `scripts/capability-smoke/local-lifecycle.test.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `scripts/codex-runtime/qualify.mjs` | Integrate the approved implementation from the Resource stack: Integrate owned Codex Worktree Runtime and exact Resource evidence. |
| `scripts/opencode-runtime/qualify.mjs` | Integrate the approved implementation from the Resource stack: Implement qualified OpenCode Worktree Resource runtimes. |
| `src/main-lifecycle.test.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/application-bootstrap.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/application-resource-access.test.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/application-resource-access.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/application-resource-package.test.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/application-resource-qualification.test.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/application-resource-runtime.test.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/application-resource-runtime.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/application-resource-startup.test.ts` | Integrate the approved implementation from the Resource stack: Preserve saved chat snapshots when managed runtime resume fails. |
| `src/main/application-services.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/assignments/application-resource-catalog.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/assignments/assignment-coordinator-projection.ts` | Integrate the approved implementation from the Resource stack: Implement transactional Worktree Resource Assignment coordination. |
| `src/main/assignments/assignment-coordinator-store.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/assignments/assignment-migrator.test.ts` | Verify that session overlap is deduplicated while Worktree-only legacy selections are preserved. |
| `src/main/assignments/assignment-migrator.ts` | Include active Worktree-level legacy Capability selections in preflight, exact union, source fingerprint and transactional verification. |
| `src/main/assignments/assignment-repository.test.ts` | Integrate the approved implementation from the Resource stack: Implement Assignment and activity persistence. |
| `src/main/assignments/assignment-repository.ts` | Integrate the approved implementation from the Resource stack: Implement Assignment and activity persistence. |
| `src/main/assignments/assignment-resource-distribution.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/assignments/database-assignment-migration-catalog.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/assignments/resource-distribution-repository.test.ts` | Integrate the approved implementation from the Resource stack: Implement Assignment and activity persistence. |
| `src/main/assignments/resource-distribution-repository.ts` | Integrate the approved implementation from the Resource stack: Implement Assignment and activity persistence. |
| `src/main/assignments/worktree-resource-assignment-service.test.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/assignments/worktree-resource-assignment-service.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/capabilities/capability-distribution-service.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/capabilities/capability-host-manager.test.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/capabilities/capability-host-manager.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/capabilities/capability-host-server.test.ts` | Integrate the approved implementation from the Resource stack: Implement Capability receipt bridge and Resource activity evidence service. |
| `src/main/capabilities/capability-host-server.ts` | Integrate the approved implementation from the Resource stack: Implement Capability receipt bridge and Resource activity evidence service. |
| `src/main/capabilities/capability-package-installer.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/capabilities/capability-receipt.ts` | Integrate the approved implementation from the Resource stack: Implement Capability receipt bridge and Resource activity evidence service. |
| `src/main/capabilities/capability-removal-installer.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/capabilities/capability-removal-service.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/capabilities/capability-resource-owner.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/capabilities/capability-service.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/capabilities/catalog.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/capabilities/host-entry.ts` | Integrate the approved implementation from the Resource stack: Implement Capability receipt bridge and Resource activity evidence service. |
| `src/main/capabilities/host-protocol.ts` | Integrate the approved implementation from the Resource stack: Implement Capability receipt bridge and Resource activity evidence service. |
| `src/main/capabilities/package-verifier.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/capabilities/web-search-migration.test.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/coding-agents/codex-adapter.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/coding-agents/codex-app-server-client.ts` | Integrate the approved implementation from the Resource stack: Integrate owned Codex Worktree Runtime and exact Resource evidence. |
| `src/main/coding-agents/codex-resource-evidence.ts` | Integrate the approved implementation from the Resource stack: Integrate owned Codex Worktree Runtime and exact Resource evidence. |
| `src/main/coding-agents/codex-worktree-runtime-factory.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/coding-agents/codex-worktree-runtime.test.ts` | Integrate the approved implementation from the Resource stack: Integrate owned Codex Worktree Runtime and exact Resource evidence. |
| `src/main/coding-agents/codex-worktree-runtime.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/coding-agents/coding-agent-service.test.ts` | Preserve main’s Worktree inheritance coverage and remove an empty fixture callback lint error. |
| `src/main/coding-agents/coding-agent-service.ts` | Keep managed read/admission ownership and main’s nullable usage contract together. |
| `src/main/coding-agents/fixtures/OPENCODE-LICENSE.txt` | Integrate the approved implementation from the Resource stack: Implement qualified OpenCode Worktree Resource runtimes. |
| `src/main/coding-agents/fixtures/README.md` | Integrate the approved implementation from the Resource stack: Integrate owned Codex Worktree Runtime and exact Resource evidence. |
| `src/main/coding-agents/fixtures/codex-local-responses-fixture.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/coding-agents/fixtures/codex-runtime-evidence-fixture.ts` | Integrate the approved implementation from the Resource stack: Integrate owned Codex Worktree Runtime and exact Resource evidence. |
| `src/main/coding-agents/fixtures/codex-runtime-provider.mjs` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/coding-agents/fixtures/opencode-1.18.30-customize.txt` | Integrate the approved implementation from the Resource stack: Implement qualified OpenCode Worktree Resource runtimes. |
| `src/main/coding-agents/fixtures/opencode-1.18.30-initialize.txt` | Integrate the approved implementation from the Resource stack: Implement qualified OpenCode Worktree Resource runtimes. |
| `src/main/coding-agents/fixtures/opencode-1.18.30-review.txt` | Integrate the approved implementation from the Resource stack: Implement qualified OpenCode Worktree Resource runtimes. |
| `src/main/coding-agents/fixtures/opencode-runtime-provider.mjs` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/coding-agents/opencode-adapter.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/coding-agents/opencode-resource-evidence.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/coding-agents/opencode-worktree-runtime-factory.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/coding-agents/opencode-worktree-runtime.test.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/coding-agents/opencode-worktree-runtime.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/coding-agents/owned-worktree-runtime.ts` | Integrate the approved implementation from the Resource stack: Implement owned Worktree runtime lifecycle, routing, and capacity. |
| `src/main/coding-agents/primary-workspace-service.test.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/coding-agents/primary-workspace-service.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/coding-agents/types.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/coding-agents/worktree-runtime-attestation-verifier.test.ts` | Integrate the approved implementation from the Resource stack: Implement owned Worktree runtime lifecycle, routing, and capacity. |
| `src/main/coding-agents/worktree-runtime-attestation-verifier.ts` | Integrate the approved implementation from the Resource stack: Implement owned Worktree runtime lifecycle, routing, and capacity. |
| `src/main/coding-agents/worktree-runtime-manager.test.ts` | Integrate the approved implementation from the Resource stack: Implement owned Worktree runtime lifecycle, routing, and capacity. |
| `src/main/coding-agents/worktree-runtime-manager.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/config/env.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/database/assignment-activity-bootstrap.ts` | Integrate the approved implementation from the Resource stack: Implement transactional Worktree Resource Assignment coordination. |
| `src/main/database/bootstrap.ts` | Integrate the approved implementation from the Resource stack: Implement Assignment and activity persistence. |
| `src/main/database/index.test.ts` | Integrate the approved implementation from the Resource stack: Implement Assignment and activity persistence. |
| `src/main/database/index.ts` | Integrate the approved implementation from the Resource stack: Implement transactional Worktree Resource Assignment coordination. |
| `src/main/database/migrations/0000_initial.sql` | Keep main’s deployed migration lineage and regenerate the combined Resource schema after migration 13; do not reuse the conflicting Resource-branch journal. |
| `src/main/database/migrations/0014_unknown_firelord.sql` | Keep main’s deployed migration lineage and regenerate the combined Resource schema after migration 13; do not reuse the conflicting Resource-branch journal. |
| `src/main/database/migrations/meta/0014_snapshot.json` | Keep main’s deployed migration lineage and regenerate the combined Resource schema after migration 13; do not reuse the conflicting Resource-branch journal. |
| `src/main/database/migrations/meta/_journal.json` | Keep main’s deployed migration lineage and regenerate the combined Resource schema after migration 13; do not reuse the conflicting Resource-branch journal. |
| `src/main/database/resource-cutover.test.ts` | Reject new legacy Worktree Capability writes after cutover. |
| `src/main/database/resource-cutover.ts` | Guard the newer Worktree Capability table after cutover, including verified-marker restart, while allowing parent deletion cascades. |
| `src/main/ipc/github-auth-handlers.test.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/ipc/index.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/ipc/marketplace-handlers.test.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/ipc/resource-activity-handlers.test.ts` | Integrate the approved implementation from the Resource stack: Implement narrow Assignment and activity IPC contracts. |
| `src/main/ipc/resource-activity-handlers.ts` | Integrate the approved implementation from the Resource stack: Implement narrow Assignment and activity IPC contracts. |
| `src/main/ipc/resource-assignment-handlers.test.ts` | Integrate the approved implementation from the Resource stack: Implement narrow Assignment and activity IPC contracts. |
| `src/main/ipc/resource-assignment-handlers.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/ipc/resource-ipc-integration.test.ts` | Integrate the approved implementation from the Resource stack: Implement narrow Assignment and activity IPC contracts. |
| `src/main/ipc/resource-ipc.test.ts` | Integrate the approved implementation from the Resource stack: Implement narrow Assignment and activity IPC contracts. |
| `src/main/ipc/resource-ipc.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/packages/catalog/official-catalog.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/resource-activity/resource-activity-evidence-service.test.ts` | Integrate the approved implementation from the Resource stack: Implement qualified OpenCode Worktree Resource runtimes. |
| `src/main/resource-activity/resource-activity-evidence-service.ts` | Integrate the approved implementation from the Resource stack: Implement qualified OpenCode Worktree Resource runtimes. |
| `src/main/resource-activity/resource-activity-repository.test.ts` | Integrate the approved implementation from the Resource stack: Implement Assignment and activity persistence. |
| `src/main/resource-activity/resource-activity-repository.ts` | Integrate the approved implementation from the Resource stack: Implement Capability receipt bridge and Resource activity evidence service. |
| `src/main/skills/skill-service.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/skills/skill-validation.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/main/worktrees/worktree-service.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/preload-auth.test.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/preload-resources.test.ts` | Integrate the approved implementation from the Resource stack: Implement narrow Assignment and activity IPC contracts. |
| `src/preload-resources.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/preload.test.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/preload.ts` | Integrate the approved implementation from the Resource stack: Complete Worktree Resources cutover and cross-provider release qualification. |
| `src/renderer/components/ui/dialog.tsx` | Integrate the approved implementation from the Resource stack: Implement Worktree Resources composer and exact session activity. |
| `src/renderer/features/capabilities/components/CapabilitySetupDialog.tsx` | Integrate the approved implementation from the Resource stack: Implement Worktree Resources composer and exact session activity. |
| `src/renderer/features/coding-agent/components/SessionComposer.resources.test.tsx` | Use the merged discriminated session target in Resource interaction regressions. |
| `src/renderer/features/coding-agent/components/SessionComposer.test.tsx` | Keep main’s toolbar and detached composer expectations while awaiting verified Resource admission for sends and Skills. |
| `src/renderer/features/coding-agent/components/SessionComposer.tsx` | Preserve detached/session targets, landing controls and context/usage layout; add complete-set Resources admission and assigned-Skill gating without a legacy second activation control. |
| `src/renderer/features/coding-agent/components/SessionContextDetails.tsx` | Move the existing accessible workspace disclosure to the chat row, preserving main’s uncluttered header. |
| `src/renderer/features/coding-agent/components/SessionMessages.resources.test.tsx` | Integrate the approved implementation from the Resource stack: Implement Worktree Resources composer and exact session activity. |
| `src/renderer/features/coding-agent/components/SessionMessages.test.tsx` | Integrate the approved implementation from the Resource stack: Implement Worktree Resources composer and exact session activity. |
| `src/renderer/features/coding-agent/components/SessionMessages.tsx` | Integrate the approved implementation from the Resource stack: Implement Worktree Resources composer and exact session activity. |
| `src/renderer/features/coding-agent/components/SessionResourceActivity.tsx` | Integrate the approved implementation from the Resource stack: Implement Worktree Resources composer and exact session activity. |
| `src/renderer/features/coding-agent/hooks/useCodingAgentSession.test.tsx` | Integrate the approved implementation from the Resource stack: Implement Worktree Resources composer and exact session activity. |
| `src/renderer/features/coding-agent/hooks/useCodingAgentSession.ts` | Keep owned-session snapshots and unavailable-session behavior, replacing legacy activation subscriptions with Resource ownership. |
| `src/renderer/features/coding-agent/hooks/useSessionResourceActivity.test.tsx` | Integrate the approved implementation from the Resource stack: Implement narrow Assignment and activity IPC contracts. |
| `src/renderer/features/coding-agent/hooks/useSessionResourceActivity.ts` | Integrate the approved implementation from the Resource stack: Implement narrow Assignment and activity IPC contracts. |
| `src/renderer/features/coding-agent/views/CodingAgentSession.resources.test.tsx` | Integrate the approved implementation from the Resource stack: Preserve saved chat snapshots when managed runtime resume fails. |
| `src/renderer/features/coding-agent/views/CodingAgentSession.tsx` | Keep main’s chat layout and detached composer API; render the existing workspace disclosure on the chat row. |
| `src/renderer/features/coding-agent/views/NewThreadView.test.tsx` | Verify main’s landing flows with Resource admission readiness and one Resource selection control. |
| `src/renderer/features/coding-agent/views/NewThreadView.tsx` | Preserve first-message submission/retry behavior and workspace context; use the composer Resources control instead of the legacy Capability panel. |
| `src/renderer/features/resources/components/ResourceAssignmentRow.tsx` | Integrate the approved implementation from the Resource stack: Implement Worktree Resources composer and exact session activity. |
| `src/renderer/features/resources/components/WorktreeResourceMarketplace.test.tsx` | Integrate the approved implementation from the Resource stack: Implement Worktree Resources composer and exact session activity. |
| `src/renderer/features/resources/components/WorktreeResourcePicker.test.tsx` | Integrate the approved implementation from the Resource stack: Implement Worktree Resources composer and exact session activity. |
| `src/renderer/features/resources/components/WorktreeResourcePicker.tsx` | Integrate the approved implementation from the Resource stack: Implement Worktree Resources composer and exact session activity. |
| `src/renderer/features/resources/components/resource-ui-test-fixtures.ts` | Integrate the approved implementation from the Resource stack: Implement Worktree Resources composer and exact session activity. |
| `src/renderer/features/resources/hooks/useWorktreeResourceAssignment.test.tsx` | Integrate the approved implementation from the Resource stack: Implement narrow Assignment and activity IPC contracts. |
| `src/renderer/features/resources/hooks/useWorktreeResourceAssignment.ts` | Integrate the approved implementation from the Resource stack: Implement narrow Assignment and activity IPC contracts. |
| `src/renderer/pages/Marketplace.tsx` | Keep main’s installation/layout controls with Resource setup navigation hooks. |
| `src/shared/assignments/index.ts` | Integrate the approved implementation from the Resource stack: Implement shared Assignment and Resource activity contracts. |
| `src/shared/assignments/projection.test.ts` | Integrate the approved implementation from the Resource stack: Implement shared Assignment and Resource activity contracts. |
| `src/shared/assignments/projection.ts` | Integrate the approved implementation from the Resource stack: Implement shared Assignment and Resource activity contracts. |
| `src/shared/assignments/reducer.ts` | Integrate the approved implementation from the Resource stack: Implement shared Assignment and Resource activity contracts. |
| `src/shared/assignments/schemas.test.ts` | Integrate the approved implementation from the Resource stack: Implement shared Assignment and Resource activity contracts. |
| `src/shared/assignments/schemas.ts` | Integrate the approved implementation from the Resource stack: Implement shared Assignment and Resource activity contracts. |
| `src/shared/db/assignment-activity-schema.ts` | Integrate the approved implementation from the Resource stack: Implement transactional Worktree Resource Assignment coordination. |
| `src/shared/ipc/api.ts` | Integrate the approved implementation from the Resource stack: Implement narrow Assignment and activity IPC contracts. |
| `src/shared/ipc/channels.ts` | Integrate the approved implementation from the Resource stack: Implement narrow Assignment and activity IPC contracts. |
| `src/shared/ipc/resource-wire.ts` | Integrate the approved implementation from the Resource stack: Implement narrow Assignment and activity IPC contracts. |
| `src/shared/resource-activity/index.ts` | Integrate the approved implementation from the Resource stack: Implement shared Assignment and Resource activity contracts. |
| `src/shared/resource-activity/projection.test.ts` | Integrate the approved implementation from the Resource stack: Implement shared Assignment and Resource activity contracts. |
| `src/shared/resource-activity/projection.ts` | Integrate the approved implementation from the Resource stack: Implement shared Assignment and Resource activity contracts. |
| `src/shared/resource-activity/reducer.ts` | Integrate the approved implementation from the Resource stack: Implement shared Assignment and Resource activity contracts. |
| `src/shared/resource-activity/schemas.test.ts` | Integrate the approved implementation from the Resource stack: Implement shared Assignment and Resource activity contracts. |
| `src/shared/resource-activity/schemas.ts` | Integrate the approved implementation from the Resource stack: Implement shared Assignment and Resource activity contracts. |
