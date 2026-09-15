# Worktree Resource Assignment IPC and composer behavior

Status: approved by HITL for #68; consolidated and cross-document aligned under #57  
Parent: #57  
Depends on: #66 coordinator and #67 persistence

## Product boundary

The existing coding-agent composer is the primary Assignment control. Marketplace remains the installation, update, removal, configuration, consent, and inspection surface. This feature adds no route, dashboard, administration page, statistics, or background polling.

Assignment is Worktree-scoped. Every session/window for one Worktree observes the same desired and verified Resource set. Provider availability and activity remain session-specific projections.

## Shared module

Create `src/shared/assignments/schemas.ts` as the only definition site for Assignment request, response, projection, event, state, action, and error contracts. Session activity uses the separate sole definition site `src/shared/resource-activity/schemas.ts` from the normative activity evidence specification; it must not duplicate Assignment or activity types. `src/shared/ipc/channels.ts` contains channel constants only. Main, preload, and renderer import inferred types from the shared schema module; they do not duplicate string unions or interfaces.

All IDs are trimmed/bounded Zod strings. Revisions cross IPC as canonical non-negative decimal strings because JavaScript cannot safely represent every SQLite 64-bit integer. Date/times cross as ISO strings. The renderer never submits generation IDs, digests, qualification state, provider paths, runtime generations, effective-state digests, or internal attempt IDs.

## IPC result envelope

Every Assignment invoke returns a parsed discriminated result rather than throwing implementation exceptions across IPC:

```ts
type AssignmentIpcResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: {
        code: AssignmentErrorCode;
        message: string;
        retryable: boolean;
        current?: AssignmentProjectionDto;
      };
    };
```

Allowed error codes:

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
- `internal_error`

`resource_update_pending` means a Marketplace update/uninstall owns the Resource-level mutation barrier; complete-set writes that newly add or re-pin that Resource fail with the current projection, while removals remain allowed before the participant freezes. `message` is a stable safe user-facing sentence selected by the main process. It never contains raw provider errors, prompts, output, settings, Skill content, credentials, authorization material, private paths, process commands, or provider session identifiers. Internal causes are logged separately with existing redaction policy.

## Channels

Add exactly these six Assignment channels. The separate session activity contract adds only `RESOURCE_ACTIVITY_LIST` and `RESOURCE_ACTIVITY_CHANGED`; those are not Assignment mutation channels and are specified in the activity evidence document:

| Constant | Wire name | Direction | Purpose |
|---|---|---|---|
| `RESOURCE_ASSIGNMENT_GET` | `resource-assignment:get` | renderer invoke → main | Full current projection for one Worktree/current agent kind |
| `RESOURCE_ASSIGNMENT_SET` | `resource-assignment:set` | renderer invoke → main | Replace complete desired Resource set with optimistic revision |
| `RESOURCE_ASSIGNMENT_RETRY` | `resource-assignment:retry` | renderer invoke → main | Retry failed desired generation |
| `RESOURCE_ASSIGNMENT_CANCEL_PENDING` | `resource-assignment:cancel-pending` | renderer invoke → main | Revisioned reversion before side effects |
| `RESOURCE_ASSIGNMENT_RECOVER` | `resource-assignment:recover` | renderer invoke → main | Invoke one server-advertised recovery capability |
| `RESOURCE_ASSIGNMENT_CHANGED` | `resource-assignment:changed` | main event → renderer | Revisioned full projection update |

Do not add generic command, arbitrary provider configuration, patch-by-path, toggle, or event-stream channels.

## Requests

### Get

```ts
{
  worktreeId: string;
  agentKind: "codex" | "opencode";
}
```

`agentKind` selects the session-facing availability projection; it does not change Assignment ownership.

### Set desired complete set

```ts
{
  worktreeId: string;
  expectedRevision: string;
  resources: Array<{
    kind: "capability" | "skill";
    id: string;
    version: string;
  }>;
}
```

The list is bounded, sorted/canonicalized by main, and rejects duplicate `(kind,id)`. Main resolves every item against installed immutable identities and ignores no unknown field. Renderer-supplied version is an optimistic identity check, not authorization to select an unavailable artifact.

There is no `enable(id)`/`disable(id)` IPC. The complete set is necessary for deterministic optimistic concurrency and coalescing.

### Retry

```ts
{ worktreeId: string; expectedRevision: string }
```

Creates a new attempt for the unchanged desired generation. Valid only when advertised by `allowedActions`.

### Cancel pending

```ts
{ worktreeId: string; expectedRevision: string }
```

Creates a new revision restoring the verified complete set. Valid only before provider side effects begin. It never deletes or rewinds a revision.

### Recover

```ts
{
  worktreeId: string;
  expectedRevision: string;
  action: "retry_recovery" | "recreate_affected_runtimes" | "revert_desired";
}
```

Main checks that the current projection advertises the exact action. The renderer cannot request PIDs, paths, arbitrary process termination, or provider commands.

## Projection

```ts
type AssignmentProjectionDto = {
  worktreeId: string;
  revision: string;            // optimistic desired-set token
  projectionSequence: string;  // orders every renderer-visible transition
  phase:
    | "reconciling"
    | "stable"
    | "waiting_for_idle"
    | "applying"
    | "rolling_back"
    | "failed_rolled_back"
    | "recovery_required"
    | "removing";
  currentAgentKind: "codex" | "opencode";
  resources: ResourceAssignmentItemDto[];
  blockers: AssignmentBlockerDto[];
  progress: AssignmentProgressDto | null;
  admission: AssignmentAdmissionDto;
  allowedActions: AssignmentAction[];
  failure: { code: AssignmentErrorCode; message: string } | null;
  updatedAt: string;
};
```

### Resource item

```ts
type ResourceAssignmentItemDto = {
  kind: "capability" | "skill";
  id: string;
  name: string;
  version: string;
  description: string;
  desired: boolean;
  verified: boolean;
  operation: "adding" | "removing" | null;
  status:
    | "installed"
    | "applying"
    | "enabled"
    | "unavailable"
    | "failed"
    | "recovery_required";
  assignable: boolean;
  unavailableReason:
    | "setup_required"
    | "provider_incompatible"
    | "provider_unqualified"
    | "installation_invalid"
    | "consent_required"
    | null;
  automaticUsageReporting: "supported" | "unknown" | "not_applicable";
  skillIsolation: "enforced" | "not_enforced" | "not_applicable";
};
```

Projection includes all installed Resources relevant to composer assignment, not only assigned ones. Main derives status for `currentAgentKind`:

- `installed`: valid installation, unassigned, available to select;
- `applying`: desired/verified membership differs or current attempt touches it;
- `enabled`: desired and verified membership agree and provider is compatible/qualified; a newly launched runtime still needs its own attestation before prompt admission;
- `unavailable`: assigned Worktree Resource cannot be used by the current provider/version;
- `failed`: desired change failed but prior generation was restored;
- `recovery_required`: effective state cannot be proven.

`setup_required`, invalid installation, missing consent, and provider unqualification set `assignable=false`. Setup is not a seventh displayed Assignment status: the row remains Installed with an explanatory action/reason until configuration/consent completes in Marketplace. Assigned provider-unavailable Resources remain visibly assigned and Unavailable; they are not silently unchecked.

`automaticUsageReporting` is informational only and never predicts use. It supports copy such as “Automatic use cannot be confirmed for this provider.”

For Codex Skills, `skillIsolation = not_enforced` does not make the row unavailable: app-issued `/skill:` selection remains restricted to assigned Skills, but the row and stable banner must state “Codex may access other Skills outside this worktree Assignment.” Do not say isolated, exclusive, allowlisted provider catalog, or protected. OpenCode uses `enforced` only after its production isolation fixture passes.

### Blocker

```ts
type AssignmentBlockerDto = {
  kind:
    | "active_turn"
    | "provider_pending"
    | "permission_waiting"
    | "aborting"
    | "queued_follow_up"
    | "runtime_transition"
    | "event_drain";
  sessionRunId: string | null;
  sessionTitle: string | null;
  canStop: boolean;
};
```

Only an existing local application run ID may be exposed for exact navigation/abort. No external provider session ID is returned. Titles are already user-visible application metadata and are bounded/redacted by their existing contract.

### Progress

```ts
type AssignmentProgressDto = {
  step: "preparing" | "waiting_for_idle" | "staging" | "activating" | "verifying" | "rolling_back" | "recovering";
  completed: number;
  total: number;
  waitingSince: string | null;
};
```

No fake percentage is shown. `completed/total` is used only where participants/tasks are countable.

### Admission

```ts
type AssignmentAdmissionDto = {
  canCreateSession: boolean;
  canResumeSession: boolean;
  canSend: boolean;
  reason: "assignment_busy" | "recovery_required" | "runtime_verification" | "worktree_removing" | null;
  message: string | null;
};
```

The projection is advisory UX. Main rechecks the gate for every operation; renderer state never authorizes provider work.

## Changed event

```ts
{
  eventId: string;
  worktreeId: string;
  revision: string;
  projectionSequence: string;
  projection: AssignmentProjectionDto;
}
```

Main broadcasts only after the database/outbox commit to every live `webContents`, not only the initiating window or current session. `revision` remains the mutation concurrency token; `projectionSequence` orders phase, progress, blockers, admission, failure, and Resource status changes at that revision. Delivery rules:

- lower projection sequence than local: ignore;
- equal projection sequence and same event ID/projection: idempotent ignore;
- equal projection sequence with a different event ID or projection: refetch and report sanitized consistency failure;
- higher projection sequence: replace the entire local projection;
- projection-sequence gap: replace because the event contains a full projection, then refetch in the background for defense in depth;
- a higher Assignment revision with non-increasing projection sequence is invalid and forces refetch;
- window mount/focus/reconnect: one `get`, no polling.

Events for another Worktree do not update local state. Event handlers are removed on unmount and preload returns an unsubscribe function.

## Main-process handlers

Each handler is thin:

1. parse the unknown request with its shared Zod schema;
2. verify Worktree existence and current application authorization;
3. call one coordinator method;
4. map known domain errors to the result envelope;
5. redact/log unexpected causes and return `internal_error`;
6. parse the response projection before returning.

The main process ignores sender claims about current generations, provider qualification, blocker ownership, runtime identity, installation configuration, or allowed actions. It derives all of them.

Assignment handlers live in a focused `resource-assignment-handlers.ts` module rather than extending the already broad `ipc/index.ts` with business logic. `registerIpcHandlers()` registers their exact channels and injects the service.

## Preload API

Expose a narrow API:

```ts
resourceAssignments: {
  get(request): Promise<AssignmentIpcResult<AssignmentProjectionDto>>;
  setDesired(request): Promise<AssignmentIpcResult<AssignmentProjectionDto>>;
  retry(request): Promise<AssignmentIpcResult<AssignmentProjectionDto>>;
  cancelPending(request): Promise<AssignmentIpcResult<AssignmentProjectionDto>>;
  recover(request): Promise<AssignmentIpcResult<AssignmentProjectionDto>>;
  onChanged(listener: (event: AssignmentChangedEventDto) => void): () => void;
}
```

Preload parses outbound arguments and inbound invoke/event payloads. Invalid main responses/events are discarded and logged through a fixed safe diagnostic; raw IPC data is never forwarded. It does not expose `ipcRenderer`, filesystem functions, environment state, credentials, provider APIs, or generic invocation.

Update the global `Window.api` declaration from inferred shared types.

## Composer information architecture

Replace the session-scoped **Capabilities** picker with one compact **Resources** control in the existing composer settings row. Do not add a second Skill management control. Explicit Skill invocation remains the existing `/skill:` selection/chip workflow, filtered by the Worktree Assignment and current provider availability.

The trigger displays:

- label `Resources`;
- verified assigned count, for example `3 enabled`;
- textual state when nonstable: `Applying…`, `Waiting…`, `Failed`, or `Recovery required`;
- `aria-expanded`, `aria-controls`, and an accessible name containing the state.

Opening the control shows one focus-managed popover with:

1. heading “Resources for this worktree”;
2. helper text “Changes apply to every session in this worktree.”;
3. optional search input when the installed list exceeds the existing compact-list threshold;
4. status/recovery banner;
5. Assigned and Available groups, each containing Capabilities and Skills without separate management tabs;
6. footer actions appropriate to the current phase.

Use existing Popover, Button, checkbox/menu/list primitives and project tokens. Keep the interface dense and operational. No cards, charts, dashboards, recommendations, packs, or decorative animations.

## Resource row behavior

Each row contains:

- checkbox with Resource name as label;
- compact `Capability` or `Skill` type text;
- exact version;
- one textual state badge;
- concise unavailable/setup reason when applicable;
- for a Codex Skill, persistent `Isolation not enforced` text and the bounded explanation above;
- setup/consent link only when required.

Checkbox meaning is desired membership, not current provider state.

- Checking/unchecking constructs the full desired set from the latest projection and sends `setDesired` with its revision.
- Do not optimistically change the checkbox. Show row-local pending state until the main response/event arrives.
- Disable only the row whose mutation request is in flight; other valid changes may be submitted after the new revision arrives.
- During coordinator `applying`, controls may remain available for a subsequent coalesced target, but each mutation waits for the latest revision response. Label it “Queued after current change.”
- Assigned but provider-unavailable rows remain checked; explicit use controls are disabled for the current session.
- Assigned Codex Skills may be Enabled with `Isolation not enforced`; only the application's explicit invocation picker is filtered. The renderer never implies that provider-native mention, ambient discovery, or automatic access is restricted.
- `assignable=false` unassigned rows cannot be checked. Show the exact reason and `Configure in Marketplace`/`Review consent` action when available.
- Removal preserves history and any visible past activity.

The renderer never locally converts Installed to Enabled. Only a committed projection does.

## Phase-specific UX

### Stable

- Resources trigger shows enabled count.
- Send is available only when `admission.canSend` and runtime attestation/lazy verification succeeds in main.
- Unassigned valid rows show Installed.

### Waiting for idle

- Inline status: “Waiting for active sessions before applying resource changes.”
- Show blocker count and safe session titles when available.
- `Cancel change` invokes `cancelPending` with current revision.
- Exact local blocker offers `Stop agent` through the existing coding-agent abort capability after confirmation where existing UX requires it.
- Do not count down or imply timeout.
- Composer draft remains editable, but Send is disabled because a writer is queued.

### Applying / rolling back

- Announce step changes in one polite live region.
- Do not show Enabled for target-only Resources.
- Do not offer cancel once side effects began.
- Stop/permission controls for existing activity remain in their existing control lane.
- Draft remains intact.

### Failed with verified rollback

Banner: “Resource changes failed. Your previous verified setup is still active.”

- Send remains available on the prior verified generation.
- Desired-only Resources show Failed; prior-only Resources show removal Failed/current prior availability clearly.
- Offer `Retry changes` and `Discard changes`; Discard submits the complete verified Resource set through `setDesired` with the current revision.
- Never auto-revert or hide the failed desired target.

### Recovery required

Banner with `role="alert"`: “Resource state could not be verified. Agent actions are paused for this worktree.”

- Disable create/resume/send and Assignment checkboxes.
- Show only server-advertised recovery actions: `Retry recovery`, `Recreate affected runtime`, `Revert desired changes`.
- Explain that conversation/history is preserved.
- Never expose process IDs, provider errors, paths, or “force continue.”

### Removing

Disable all controls and state that the Worktree is being removed. No retry is offered from composer.

## Setup before Assignment

A Resource requiring configuration or consent cannot enter desired state.

- Main returns `assignment_setup_required` if a stale renderer submits it.
- Composer row remains Installed/unassigned with reason.
- `Configure in Marketplace` navigates to the existing Marketplace detail/configuration surface; it does not create a new page or IPC command.
- After Marketplace emits its existing changed event, refetch Assignment projection.
- Completing setup does not auto-assign the Resource; the user returns and explicitly checks it.

## Skill explicit invocation

`/skill:` suggestions and the Skill chip contain only Resources where:

- kind is Skill;
- desired and verified are true;
- current provider status is Enabled;
- exact selected version matches the projection;
- admission permits send.

Selecting a Skill does not alter Assignment. If an Assignment event disables/unavailable-marks the selected Skill before send, remove the chip, preserve argument text, move focus to the composer, and announce: “Selected Skill is no longer available in this worktree.”

Failed or incompatible explicit invocation is rejected by main before provider submission. There is no fallback to a plain prompt. The draft/chip remain recoverable according to the error.

Capabilities have no fake explicit chat syntax; their tools become available only through verified runtime configuration.

## Prompt/session admission feedback

Main session create/resume/send methods all use the coordinator gate even though their existing IPC channels remain unchanged.

- If a queued Assignment writer already blocks admission, return immediately with the safe `assignment_waiting_for_idle` result rather than leaving an uncancellable renderer invoke pending indefinitely.
- If lazy runtime verification starts after Send, show “Preparing worktree resources…” and retain draft/chip until main accepts the turn.
- On `runtime_unavailable`, retain draft/chip and offer the existing/manual runtime retry path.
- On `resource_unavailable`, retain arguments and identify the safe Resource name/version from current projection.
- On `assignment_recovery_required`, retain draft and focus the recovery banner action.
- Clear draft/chip only after main confirms provider turn acceptance, not on click.

Existing session IPC methods must adopt or wrap the same structured admission errors so the renderer does not parse exception strings.

## Optimistic conflict behavior

On `assignment_conflict`:

1. replace local state with `error.current` after schema validation, or refetch if absent;
2. do not replay the user's stale checkbox change automatically;
3. announce with `role="alert"`: “Resources changed in another window. Review the latest selection and try again.”;
4. preserve search/filter and popover focus where the Resource still exists;
5. if removed/updated, focus the group heading and explain the item changed.

This prevents a stale complete-set request from erasing another window's changes.

## Multi-window and session synchronization

Use one renderer hook keyed by `(worktreeId, currentAgentKind)` to own snapshot loading, invoke state, optimistic revision, projection-sequence ordering, and subscription. Session views consume it; they do not each implement event reconciliation.

A successful mutation response and its later event are idempotent. Every open window receives the full update. Current Skill chip validity, send admission, header Resource summary, and composer popover derive from the same projection in one render commit.

No timer or continuous polling is introduced. Refetch only on initial mount, focus/reconnect, schema/event inconsistency, Marketplace installation change, or explicit retry.

## Accessibility requirements

- Trigger is a real button with visible focus and state in its accessible name.
- Popover has labelled heading/description and returns focus to trigger on Escape/close.
- Search is labelled, not placeholder-only.
- Groups use semantic headings; checkboxes use full Resource names and `aria-describedby` for version/state/reason.
- Space toggles focused checkbox; Tab follows DOM order; Escape closes; no custom arrow-key model unless an existing project listbox primitive supplies it correctly.
- Loading uses `aria-busy`; one `role="status" aria-live="polite"` announces queued/apply progress without repeating every render.
- Conflicts, failed apply, and recovery use `role="alert"` once per new revision.
- Spinner/icon/color is never the only status signal.
- Disabled rows expose reason text; disabled controls are not the only route to setup actions.
- Cancel/retry/recovery buttons have action-specific names, visible focus, and no icon-only ambiguity.
- Draft text and focus are preserved across Assignment updates unless the selected Skill becomes invalid, in which case focus returns to the editor with an announcement.

## Loading, empty, and error states

- Initial load: skeleton/compact busy text in Resources control; composer may render but send waits for admission snapshot.
- No installed Resources: “No resources installed. Install resources in Marketplace.” with existing navigation action.
- Installed but none assigned: `0 enabled`; Available group remains usable.
- Projection fetch failure: keep last schema-valid snapshot visibly stale, disable mutation/send authorization based on it, and show Retry. Never fail open.
- Subscription loss: mark stale and refetch on reconnect/focus.
- Marketplace unavailable: setup link reports a bounded error without changing Assignment.

## Existing UI migration

- Remove session-scoped activation/deactivation callbacks from `SessionComposer` and `CapabilityPicker` usage.
- Replace with a focused `WorktreeResourcePicker` component and assignment hook.
- Existing session header may show a read-only summary of verified Resources but must not retain a second divergent removal implementation. If removal remains available there, it calls the same complete-set Assignment mutation/hook.
- Existing Marketplace Capability configure/install controls remain.
- Existing Skill command/chip components are reused after filtering by Assignment projection.
- Activity components remain separate and consume #65 evidence; Assignment status does not imply Used.

## File-level implementation map

Expected production touch points:

- `src/shared/assignments/schemas.ts` — all Assignment contracts and inferred types;
- `src/shared/resource-activity/schemas.ts` — all session activity snapshot/delta/result contracts;
- `src/shared/ipc/channels.ts` — six exact Assignment channels plus two exact activity channels;
- `src/main/ipc/resource-assignment-handlers.ts` — Assignment parsing/error mapping/delegation;
- `src/main/ipc/resource-activity-handlers.ts` — exact-run authorization, snapshot parsing, and activity delegation;
- `src/main/ipc/index.ts` — registration only;
- `src/preload.ts` and global API declaration — narrow parsed API;
- `src/renderer/features/resources/hooks/useWorktreeResourceAssignment.ts` — Assignment snapshot/event/mutation state;
- `src/renderer/features/coding-agent/hooks/useSessionResourceActivity.ts` — activity snapshot/delta sequence, gap refetch, and subscription cleanup;
- `src/renderer/features/resources/components/WorktreeResourcePicker.tsx` — accessible popover;
- `SessionComposer.tsx` — one Resources control and admission projection;
- `useCodingAgentSession.ts` / session creation flows — gate errors and draft preservation;
- existing header/Capability picker call sites — remove session-scoped behavior;
- focused shared/main/preload/renderer tests.

Names may adapt to established folder conventions, but contracts and ownership may not be duplicated.

## Test matrix

### Shared and main

- every request/response/event schema boundary and size limit;
- duplicate Resource rejection and version mismatch;
- unknown fields stripped/rejected according to strict schema policy;
- expected revision conflict includes current safe projection;
- setup/unavailable/recovery error mapping without raw cause leakage;
- server-side allowed-action validation;
- sender cannot inject generation/digest/path/provider/runtime state;
- one ordered broadcast per renderer-visible durable transition after its outbox commit to all windows.

### Preload

- outbound and inbound parsing;
- malformed event discarded safely;
- unsubscribe removes exact listener;
- no raw `ipcRenderer` exposure;
- invoke errors become safe result envelope.

### Activity IPC

- list validates exact run existence, Worktree ownership, result envelope, and sanitized snapshot;
- changed event validates schema and recipient ownership before preload delivery;
- duplicate/lower activity sequence is ignored, next sequence applies, gap/equal conflict refetches;
- late attribution upserts one item and attribution conflict removes it;
- mount/focus/reconnect lists once without polling;
- unsubscribe removes the exact activity listener;
- renderer cannot submit activity, evidence, sequence, receipt, provider identity, or cancellation invocation ID.

### Renderer interaction

- Installed → Applying → Enabled;
- uncheck/removal and history preservation copy;
- Waiting blockers, Cancel change, and Stop agent;
- no cancel during provider side effects;
- failed rollback permits send on prior generation and offers Retry/Discard;
- Recovery required disables send and exposes only allowed recovery actions;
- setup-required navigation without auto-assignment;
- provider-unavailable remains checked but cannot be explicitly invoked;
- Codex assigned Skill remains invocable with persistent `Isolation not enforced` warning; unassigned app explicit selection remains absent/denied;
- stale conflict replaces snapshot and does not replay toggle;
- two windows converge under out-of-order/duplicate events;
- selected Skill invalidation preserves arguments and announces;
- lazy verification retains draft until accepted;
- empty/loading/stale/reconnect states;
- keyboard-only operation, Escape focus restoration, accessible names, live-region deduplication, and non-color status.

### End-to-end

- two sessions in one Worktree update simultaneously;
- unrelated Worktree remains unchanged;
- busy session blocks mutation while control-lane abort drains it;
- app restart during applying/rollback/recovery projects the reconciled state;
- Codex/OpenCode incompatibility and qualification fixtures project honest Unavailable states;
- no prompt reaches provider while Assignment admission is closed.

## Acceptance criteria

- One composer control manages complete Worktree Assignment; no new screen exists.
- Renderer cannot claim Enabled, authorize a Resource, or bypass revision checks.
- Every mutation is complete-set, revisioned, validated in main, and synchronized to all windows.
- Installed, Applying, Enabled, Unavailable, Failed, and Recovery required have distinct text and behavior.
- Long waits are visible and cancellable before side effects without destructive timeout.
- Failed verified rollback keeps prior prompts usable; recovery ambiguity closes admission.
- Setup occurs before Assignment and never auto-assigns afterward.
- Explicit Skill use is limited to verified current-provider Assignment and never falls back to prompt text.
- Accessibility, loading, empty, stale, success, conflict, failure, and recovery states are covered by focused tests.
