# Dashboard Main Workspace Redesign

## Goal

Implement the approved branches-first dashboard concept in the renderer while preserving the existing repository sidebar, backend behavior, IPC contracts, and chat-status mapping.

## Scope

### In scope

- Redesign the selected repository's main dashboard workspace.
- Keep repository identity and metadata prominent.
- Present compact summary cards for the default branch, branch count, and worktree count.
- Display the selected repository's already-loaded branches in the main workspace.
- Let a branch-row action open the existing worktree dialog with that branch preselected.
- Restyle the worktree list and details while preserving selection, chat context, and Coding Agent navigation.
- Add renderer tests for the new presentation and interactions exposed through component callbacks.

### Out of scope

- Any change to `RepositorySidebar`.
- Backend, database, IPC, preload, shared schema, or Git/GitHub service changes.
- Changes to `getDashboardChatStatus` or the ready/running/completed/error mapping.
- New branch synchronization calculations, timestamps, filters, sorting systems, or GitHub actions not supported by current renderer data.
- New routes, dialogs, or user workflows.

## Visual Direction

Use the supplied `design-concepts/dashboard-modern-concept.png` as the visual target. The style remains a dense, operational dark developer tool with restrained red accents, quiet bordered surfaces, compact typography, and clear information hierarchy. Existing theme tokens and reusable UI primitives remain the source of colors and interaction states so light mode and accessibility continue to work.

The redesign applies only to the main workspace to the right of the unchanged repository sidebar.

## Information Architecture

### Repository header

The header contains:

- Repository label from `getRepositoryLabel`.
- Local or Remote badge.
- Existing Private and Archived badges where applicable.
- Local path or repository URL.
- Existing primary “New worktree” action.

No unsupported “Open in GitHub” behavior will be introduced.

### Summary cards

Three compact cards appear below the header:

1. **Default branch** — `repository.defaultBranch`, or “Not set”.
2. **Branches** — branch count when branch loading succeeds; otherwise the current loading/error state.
3. **Worktrees** — current `worktrees.length`.

These cards summarize existing renderer data only.

### Branches section

The main branch table consumes the selected repository's existing `RepositoryBranchListState` from `Dashboard`. It supports:

- Loading skeletons.
- Error message and retry action using the existing `loadRepositoryBranches` callback.
- An empty branch state.
- Ready rows showing branch name, default/protected metadata, associated worktree information, current chat status when a worktree exists, and a worktree action.

A branch is associated with the first worktree whose `branchName` equals the branch name. If an associated worktree exists, its row can select that worktree and expose the existing Coding Agent workflow. If none exists, “Create worktree” calls the existing dialog callback with the branch name.

The branch table does not invent sync state or last-activity data because those values are not available in current contracts.

### Worktrees section

The worktree section remains the authoritative list of created worktrees and preserves:

- Worktree and branch names.
- Base branch.
- Worktree selection.
- Existing chat-status display.
- Selected worktree details: status, path, latest Coding Agent message, and changed files.
- Existing “Open Coding Agent” action.

When no worktrees exist, a compact full-width empty state replaces the oversized centered panel and retains the existing create action.

On narrower layouts, selected details stack below the worktree list. On wider layouts, they may use a two-column arrangement if space allows. All internal lists remain scrollable within the dashboard viewport.

## Status Mapping Constraint

`getDashboardChatStatus` in `src/renderer/features/dashboard/dashboard-state.ts` remains untouched.

The existing presentation remains exactly:

- `ready` → Ready
- `running` → Running
- `completed` → Completed
- `error` → Error

The redesign may change container styling and placement, but it will not change the mapping, labels, or status derivation.

## Component and Data Flow

### `Dashboard`

`Dashboard` continues owning repository, branch, worktree, dialog, and session state. It passes the selected repository's branch-list state and retry callback into `RepositoryWorkspace`.

`openCreateDialog` accepts an optional preferred base branch. The initial dialog state uses that preferred branch when provided. After the asynchronous branch list loads, it preserves the preferred branch if present in the returned list; otherwise it falls back to the repository default branch or first returned branch.

No data fetching moves into the workspace component.

### `RepositoryWorkspace`

`RepositoryWorkspace` remains presentational. New props provide:

- The selected repository branch-list state.
- A callback to request/retry branches.
- A create-worktree callback accepting an optional preferred base branch.

The component derives summary counts and branch/worktree associations from props. It continues calling existing selection and Coding Agent callbacks rather than performing navigation or backend work itself.

## Error and Empty States

- Repository-unselected state remains available.
- Branch loading uses skeleton rows and does not block worktree content.
- Branch loading failure shows a user-friendly inline error and retry button.
- Empty branches and empty worktrees use distinct messages.
- Archived repositories keep worktree creation disabled.
- Existing chat-summary loading and error messages remain visible for a selected worktree.

## Accessibility

- Preserve semantic headings and button elements.
- Keep explicit labels for status indicators so color is not the only signal.
- Maintain visible focus rings through existing button and utility patterns.
- Use `aria-current` for selected worktrees.
- Ensure branch action labels include the branch name.
- Keep controls keyboard accessible and avoid hover-only actions.

## Testing

Renderer tests will verify:

1. Repository header and summary information render from existing data.
2. Branch loading, error, empty, and ready states render correctly.
3. A branch without a worktree calls create with that branch as the preferred base.
4. Existing worktree selection and Coding Agent action remain available.
5. Ready, Running, Completed, and Error labels continue rendering through the unchanged status mapping.
6. Chat summary and changed-file information remain visible for the selected worktree.
7. The sidebar component and its tests require no implementation changes.

## Files Expected to Change

- `src/renderer/features/dashboard/components/RepositoryWorkspace.tsx`
- `src/renderer/features/dashboard/components/dashboard-components.test.tsx`
- `src/renderer/pages/Dashboard.tsx`

No production file outside renderer UI components will change.
