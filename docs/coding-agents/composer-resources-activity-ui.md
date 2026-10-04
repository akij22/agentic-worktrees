# Composer Resources and exact session activity

Implemented for [Implement composer Resources control and activity UI](https://github.com/akij22/agentic-worktrees/issues/85), on top of the Assignment/activity IPC implementation `e5e1eaf`.

The existing coding-agent composer now has one Worktree Resources control. It uses the shared Assignment hook and narrow preload API for complete-set, revisioned changes. Desired checkboxes, verified status, current-provider availability, and Send admission all come from the same projection. Marketplace retains configuration and consent; completing setup does not assign a Resource.

The existing transcript now consumes the exact application run's sanitized activity snapshot/deltas. Requested, confirmed Used, outcome, and qualified automatic Skill mode remain separate. Legacy “Loaded skill” and session Capability activation rows no longer supply activity. Activity displays immutable Resource ID/version from its DTO, without looking up current catalogs or inferring attribution from transcript/tool names.

## Interaction and accessibility

- Native checkboxes, semantic groups, labelled optional search (more than eight installed Resources), and the existing Base UI Popover preserve keyboard navigation and Escape focus return.
- Mutations submit the full desired set at the hook's current revision. No checkbox is optimistically checked and no target becomes Enabled locally.
- Waiting exposes exact local blocker Stop and server-advertised Cancel. Applying removes Cancel and labels later edits as queued.
- Failed verified rollback exposes Retry and Discard (the complete verified set); recovery exposes only advertised actions. Removing closes all mutation controls.
- A conflict replaces the safe projection without replay. Search survives; focus returns to the same unchanged Resource, or the group when its identity/version changes.
- Stale/gapped snapshots close mutation/Send until refetched. Initial errors leave Loading and offer Retry.
- Draft text stays editable during Assignment waiting/applying. Existing running-session Stop remains reachable. Explicit Skill suggestions require desired, verified, Enabled, exact-version membership and send admission. Invalidation removes the chip, retains arguments, focuses the editor and announces why.
- Rejected or pending sends retain draft/chip. They clear after the existing main API confirms acceptance. Rejection text does not expose raw provider errors.
- One composer progress live region announces steps; failure/recovery alerts remain visible with the picker closed. Error text uses the readable destructive foreground token.
- Codex always displays “Isolation not enforced” and “Codex may access other Skills outside this worktree Assignment.” Assigned Codex Skill rows repeat the disclosure.
- No route, dashboard, administration surface, dependency, database schema, or IPC channel was added.

## Confirmed test boundaries

The user agreed to rendered Resources controls, composer Send/Stop and draft/Skill interactions, and existing transcript activity UI, using narrow preload Assignment/activity APIs as external boundaries, including keyboard accessibility, focus, state transitions, and multi-window events.

Twenty new tests exercise these boundaries with real hooks/components and external preload fixtures. TDD red/green cycles covered selection, waiting, rollback/recovery, setup/unavailability, conflicts and multi-window convergence, stale/empty state, Send/draft admission, Skill invalidation, exact-run activity promotion/removal and wording, Marketplace configuration, complete session acceptance/rejection, live regions, version-change focus, and initial-load failure recovery.

## Files

| File | Purpose |
|---|---|
| `src/renderer/components/ui/dialog.tsx` | Adds an optional accessible dialog name for the reused setup surface. |
| `src/renderer/features/capabilities/components/CapabilitySetupDialog.tsx` | Names the existing configuration dialog for keyboard and assistive-technology users. |
| `src/renderer/features/coding-agent/components/CodingAgentSessionHeader.tsx` | Removes the divergent session Capability removal surface; preserves context, editor and layout controls. |
| `src/renderer/features/coding-agent/components/CodingAgentSessionHeader.test.tsx` | Updates context/focus coverage and removes obsolete session-activation tests. |
| `src/renderer/features/coding-agent/components/SessionComposer.tsx` | Uses one Worktree Assignment hook and Resources picker; gates click/Enter, filters exact assigned Skills, preserves arguments, announces invalidation/progress/recovery, and persists the Codex disclosure. |
| `src/renderer/features/coding-agent/components/SessionComposer.test.tsx` | Supplies the narrow Assignment boundary and waits for verified admission in existing keyboard/Skill interactions. |
| `src/renderer/features/coding-agent/components/SessionComposer.resources.test.tsx` | Tests draft/Stop preservation, admission, exact Skill selection/invalidation, closed recovery alerts and one progress live region. |
| `src/renderer/features/coding-agent/components/SessionMessages.tsx` | Replaces legacy activation/loaded rows with the exact-run activity component and readable error foreground. |
| `src/renderer/features/coding-agent/components/SessionMessages.test.tsx` | Removes obsolete legacy Loaded Skill assertions; preserves message/Markdown coverage. |
| `src/renderer/features/coding-agent/components/SessionMessages.resources.test.tsx` | Tests exact-run promotion/removal, foreign-run exclusion, independent outcomes, qualified automatic mode and legacy/incomplete evidence. |
| `src/renderer/features/coding-agent/components/SessionResourceActivity.tsx` | Renders ordered sanitized activity by immutable ID/version, with honest Requested/Used/outcome/mode labels and bounded refresh feedback. |
| `src/renderer/features/coding-agent/hooks/useCodingAgentSession.ts` | Removes legacy Capability catalog/subscription/mutation responsibilities and returns a safe rejected-send message. |
| `src/renderer/features/coding-agent/hooks/useCodingAgentSession.test.tsx` | Updates the rejected-send expectation to the safe draft-preserving message. |
| `src/renderer/features/coding-agent/views/CodingAgentSession.tsx` | Connects exact run activity, Resource setup navigation and exact blocker abort; removes legacy activation and reloading UI; shows pending resource preparation. |
| `src/renderer/features/coding-agent/views/CodingAgentSession.resources.test.tsx` | Tests the complete existing session through preload responses: rejection retains Skill/arguments, pending acceptance retains them, acceptance clears them, and legacy activation UI is absent. |
| `src/renderer/features/resources/components/ResourceAssignmentRow.tsx` | Keeps row presentation separate: desired checkbox, exact version/status/reason, setup action, and honest Codex isolation disclosure. |
| `src/renderer/features/resources/components/WorktreeResourcePicker.tsx` | Implements the accessible popover, groups/search, complete-set mutations, row pending state, sequence/conflict focus behavior, loading/stale/failure/recovery/removal actions and blockers. |
| `src/renderer/features/resources/components/WorktreeResourcePicker.test.tsx` | Tests nine public interactions covering keyboard focus, phase changes, setup/unavailable rows, exact revisions, multi-window convergence, gaps, conflicts/version changes, stale data and initial fetch recovery. |
| `src/renderer/features/resources/components/WorktreeResourceMarketplace.test.tsx` | Tests navigation from the Resources control through the real Marketplace and existing configuration dialog without automatic Assignment. |
| `src/renderer/features/resources/components/resource-ui-test-fixtures.ts` | Shares schema-valid literal Assignment fixtures across boundary tests. |
| `src/renderer/pages/Marketplace.tsx` | Selects the existing Resource detail from navigation state and reuses the configuration dialog with the existing typed configure API. |
| `docs/coding-agents/composer-resources-activity-ui.md` | Records each changed file, agreed test boundaries, verification, and release handoff. |

## Verification

- `npm ci` and `npm run build:capability-packages`: pass.
- `npm run typecheck`: pass.
- Focused ESLint covering every changed TypeScript/TSX file: pass, zero errors/warnings.
- All twenty new UI tests pass; existing affected interaction/hook tests pass.
- Final `npm test`: 1,494 passed, 13 skipped, one known baseline failure across 194 files. The unchanged failure is `src/main/capabilities/capability-block-policy.test.ts:80` (expected blocked, received installed).
- Final `npm run lint`: eight existing errors and forty existing warnings outside this change.
- Renderer build via `npm exec -- vite build --config vite.renderer.config.ts --outDir /tmp/composer-resources-renderer-final`: pass. Existing large-chunk advisory remains.
- `npm run package`: pass, including macOS arm64 native/main/preload/renderer assembly.
- `git diff --check`: pass.
- T3 collaborative browser walkthrough of the real session/composer/picker with external boundary fixtures at 1280×800 and 640×800: popover bounds, keyboard/Escape focus, Waiting Stop/Cancel, Applying draft retention and Send lock, Recovery controls, persistent disclosure, and readable error foreground verified.
- Initial full-suite Electron imports raced automatic binary installation. Serial installation completed and the final full suite has no install failures. Packaging rebuilds native modules for Electron; use a fresh `npm ci` before subsequent Node-native test execution.

## Release handoff

[Cut over and qualify Worktree Resources cross-provider release](https://github.com/akij22/agentic-worktrees/issues/86) remains the release gate. Default application construction and authoritative IPC access bindings, coordinator/provider runtime wiring, activity publication/startup replay, migration cutover, and live cross-provider acceptance are still required. Unconfigured Assignment IPC remains fail-closed, so this renderer work does not constitute production release qualification.

The existing session Send API currently confirms acceptance with its successful void response and uses a safe generic rejection on failure. The cutover must carry the coordinator's structured admission errors through create/resume/send, preserve draft/Skill state, and recheck admission in main. No renderer projection authorizes provider work.

The browser qualification used controlled external responses; live provider and restart/deletion/retention matrices remain part of the release ticket. Historical activity intentionally retains only the sanitized immutable Resource ID/version available in the shared activity DTO, including after uninstall.
