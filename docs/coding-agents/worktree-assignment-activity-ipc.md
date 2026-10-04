# Assignment and activity IPC implementation

Implements [Implement Assignment and activity IPC/preload contracts](https://github.com/akij22/agentic-worktrees/issues/84) from the approved Assignment IPC/composer and Resource activity evidence specifications. Builds on the completed Assignment coordinator without changing its persistence or provider lifecycle.

## Behavior

Exactly eight centralized channel constants: five Assignment invokes and one full-projection changed event, plus one activity snapshot invoke and one activity delta event. Existing shared Zod schemas remain the only wire definitions. Every new invoke returns a structured success/error result; unknown payload fields are rejected. Requests are limited to 64 KiB, with bounded traversal depth/node count and cycle rejection. Preload responses/events and backend publications have a 2 MiB guard in addition to schema limits.

Main validates Worktree authorization, exact local-run ownership, current revision, and advertised retry/cancel/recovery actions. Dispatch accepts only a trusted top-level renderer, checks authorization again after awaiting work, and rejects responses from replaced bindings. Domain error messages and nested Assignment failure/admission explanations use stable sentences. Provider causes, paths, receipts, runtime identities and process primitives are not returned. Backend failures are recorded using bounded reason codes.

Assignment publication subscribes to the coordinator's committed outbox. Every trusted, authorized live window receives the full projection. A failed window send does not prevent other windows receiving it; the publisher throws after delivery so the coordinator retains the record for replay. An invalid Assignment publication also remains failed. Activity publication validates sanitized deltas and independently checks each recipient's exact run and Worktree access. Malformed activity publications are logged and discarded before delivery.

Renderer hooks own loading, stale/error state, subscription cleanup, ordering and refetch. Assignment complete-set mutations use the current revision; conflicts replace the projection without automatically replaying the change. Mutation responses and their identical subsequent events are idempotent. Full-projection gaps can display the newer state while refetching; older fetch results cannot overwrite it. A committed event for a different provider projection causes a read for the selected provider, preserving honest availability/isolation. Activity upserts replace one item, removal deltas remove it, and gaps/conflicts trigger an authoritative snapshot. Initial-load deltas are buffered with a bounded queue. A retention-limit overflow refetches instead of throwing. Focus/online reconnect and Assignment installation changes trigger reads; healthy event streams have no polling timer.

## Application cutover ownership

The channels register through `registerIpcHandlers()` and the typed preload API is available as `window.api.resourceAssignment` and `window.api.resourceActivity`. Until the default backend owners are supplied, invokes fail closed with a safe unavailable result.

[Cut over and qualify Worktree Resources cross-provider release](https://github.com/akij22/agentic-worktrees/issues/86) must call `configureResourceIpc({ assignment, activity, access })` with the application-owned service instances and authoritative authorization policy. `isTrustedSender` must recognize application-created windows at the expected renderer URL, excluding navigated/external/destroyed windows. `canAccessWorktree` must check current Worktree existence/application authorization. `getRunWorktree` resolves the persisted local run, and `canAccessRun` checks current application window/run access independently of the Worktree check. These policies are backend inputs; no renderer request grants ownership.

Bind `ResourceActivityEvidenceService.onChanged` to `publishResourceActivity` after the evidence transaction commits. At startup/reconnect, use the activity owner's durable sanitized outbox for replay and retain its acknowledgement ownership there. Register the coordinator subscriber before draining its outbox. Call `configureResourceIpc(null)` during service teardown/replacement to remove the old subscriber. Default provider/coordinator construction and application startup wiring remain with the final cutover ticket.

[Implement composer Resources control and activity UI](https://github.com/akij22/agentic-worktrees/issues/85) consumes `useWorktreeResourceAssignment(worktreeId, agentKind)` and `useSessionResourceActivity(runId)` in the existing composer/transcript. Assignment controls must respect `loading`, `stale`, `pending`, server actions and admission. The current ticket adds no screen, picker, navigation or default application cutover.

## Modified files

| File | Purpose |
| --- | --- |
| `src/shared/ipc/channels.ts` | Defines all eight exact channel constants once. |
| `src/shared/ipc/api.ts` | Adds narrow typed Assignment/activity namespaces using inferred shared contracts. |
| `src/shared/ipc/resource-wire.ts` | Bounds unknown payload traversal, UTF-8 byte size, depth and node count before parsing. |
| `src/main/ipc/resource-assignment-handlers.ts` | Parses requests, checks authorization/revisions/actions, delegates coordinator mutations and maps safe results. |
| `src/main/ipc/resource-assignment-handlers.test.ts` | Exercises real SQLite/coordinator reads, malformed/oversized/unauthorized requests, stale mutations and safe failures. |
| `src/main/ipc/resource-activity-handlers.ts` | Authorizes exact run and Worktree, delegates sanitized snapshot reads and validates result lineage. |
| `src/main/ipc/resource-activity-handlers.test.ts` | Covers payload rejection, independent Worktree authorization and exact-run sanitized persisted history. |
| `src/main/ipc/resource-ipc.ts` | Registers six invokes, provides fail-closed service bindings, checks top-level sender identity and publishes authorized events. |
| `src/main/ipc/resource-ipc.test.ts` | Covers multi-window/run recipients, privacy rejection and delivery failure/replay behavior. |
| `src/main/ipc/resource-ipc-integration.test.ts` | Exercises channel registration and committed outbox broadcasts with the real coordinator and SQLite. |
| `src/main/ipc/index.ts` | Registers the focused module and exports its backend configuration/publication functions. |
| `src/preload-resources.ts` | Implements parsed narrow invokes, safe transport failures and validated event listeners with exact unsubscribe. |
| `src/preload-resources.test.ts` | Tests the actual exposed preload API, every invoke channel, size/error handling and activity event privacy/unsubscribe. |
| `src/preload.ts` | Adds the two focused API namespaces to the existing context bridge. |
| `src/renderer/features/resources/hooks/useWorktreeResourceAssignment.ts` | Owns Assignment snapshot/event ordering, revisioned mutations, conflict and stale-state handling. |
| `src/renderer/features/resources/hooks/useWorktreeResourceAssignment.test.tsx` | Covers ordered/foreign events, gaps/conflicts, stale replies, focus, revision conflicts, response/event replay and provider projection refresh. |
| `src/renderer/features/coding-agent/hooks/useSessionResourceActivity.ts` | Owns exact-run snapshots/deltas, initial buffering, retention boundaries and safe refetch/cleanup. |
| `src/renderer/features/coding-agent/hooks/useSessionResourceActivity.test.tsx` | Covers upsert/removal/replay, gaps, initial-load events, run navigation and a full retained-history boundary. |
| `docs/coding-agents/worktree-assignment-activity-ipc.md` | Records behavior, every changed file, validation and remaining owner bindings. |

## Verification

TDD boundaries were explicitly approved by the user: shared wire schemas, main invoke/event boundaries, narrow preload API and renderer subscription hooks. Red/green runs cover new handlers, safe input failures, revisioned actions, preload, authorized broadcasts, renderer ordering/refetch, independent Worktree authorization, failed invalid publication and retention overflow.

- `npm ci` and `npm run build:capability-packages`: exact dependencies and workspace builds.
- `npm run typecheck`: passes.
- Focused ESLint over all changed TypeScript: passes without warnings.
- New contract/integration tests: 20 pass, including real coordinator and persisted activity history.
- Full suite: 1,479 pass, 13 optional provider checks skipped; one established baseline failure in `src/main/capabilities/capability-block-policy.test.ts:80` remains (`installed` versus expected `blocked`).
- Full repository lint retains eight existing errors and 40 existing warnings outside these changes.
- Renderer production build: passes, with the existing large-chunk advisory.
- `npm run package`: macOS arm64 Electron packaging passes.
- Privacy scan confirms channel literals occur only in `src/shared/ipc/channels.ts` and new preload/renderer modules expose no backend primitives or raw evidence. `git diff --check` passes.

No schema, generated migrations, dependency declarations, build artifacts, private data or provider binaries are changed. Composer UI and default bindings remain in their named tickets; real-provider release qualification remains a final release gate.
