# Primary Checkout Coding-Agent Sessions Design

## Goal

Allow users to start a coding-agent chat directly in a project's primary checkout without creating a separate Git worktree, while retaining the option to create and use linked worktrees for isolated work on the same project.

## Scope

This change extends the existing coding-agent workspace selection flow. It does not add a new project-management screen, change how linked worktrees are created, or automatically create a working checkout for repositories backed only by a bare clone.

## Product Behavior

- A repository's primary checkout is available to the coding agent only when `repository.localRootPath` points to an existing, non-bare Git working tree.
- The new-session dialog groups targets by project and lists the primary checkout before linked worktrees.
- The primary checkout is selected by default whenever it is available.
- The dialog identifies the primary checkout explicitly and explains that the agent will modify the shared checkout directly.
- Users can still select any linked worktree belonging to the project.
- Multiple chats may target the same primary checkout, matching the existing ability to create multiple chats for one linked worktree.
- Repositories with a missing path, an invalid Git directory, or a bare clone expose only their linked worktrees.

## Architecture

The primary checkout is represented internally by a persisted workspace row in the existing `worktrees` table. This row points to the repository's current working-tree directory but does not invoke `git worktree add`, create a branch, or create a directory.

The `worktrees` table gains a `kind` discriminator:

- `primary`: the repository's existing main working checkout.
- `linked`: a separate Git worktree created through the application's existing workflow.

Existing rows migrate to `linked`. A unique primary row is maintained per repository by application logic, while the existing unique path constraint prevents duplicate workspace paths.

This representation deliberately preserves the existing session, file, terminal, diff, Git-action, routing, and IPC flows that resolve a workspace through `worktreeId`. The identifier continues to mean the persisted coding workspace used by a run; the discriminator determines whether that workspace is the shared primary checkout or an isolated linked worktree.

## Primary Workspace Synchronization

The main process owns synchronization because it performs filesystem and Git access.

When coding-agent workspace contexts are listed, and immediately before a session is created for a primary workspace, the backend:

1. Resolves the repository's `localRootPath`.
2. Verifies that the path exists and is a Git working tree.
3. Verifies that the repository is not bare.
4. Reads the currently checked-out branch. Detached HEAD is represented with a stable user-facing fallback label while retaining the workspace.
5. Creates or updates the repository's single `primary` workspace row with the current path, branch label, and timestamps.

If validation fails, the primary workspace is omitted from new-session targets. A stale persisted primary row remains available only for historical lookup; attempts to open or use an unavailable path return the existing structured workspace-unavailable error. Synchronization must never delete a workspace row because runs may reference it.

The synchronization logic is encapsulated in a main-process service and is testable independently from IPC handlers. Renderer code receives validated workspace contexts and performs no filesystem or Git checks.

## Worktree Isolation

General worktree-management APIs continue to expose only rows with `kind = linked`. This prevents the primary checkout from appearing as a separately created worktree in the dashboard, conflict intelligence, and worktree-management flows.

Lookup by exact workspace ID continues to resolve both kinds. This lets existing coding-agent capabilities use the primary checkout without adding duplicate repository-path implementations to file, terminal, Git, or diff services.

Creation through the existing worktree service always writes `kind = linked`. No removal or lifecycle operation intended for linked worktrees may target a primary workspace.

## Shared Contracts and IPC

The shared `Worktree` model includes the new discriminator, and the coding-agent workspace-context contract continues to pair a workspace with its repository. Coding-agent session creation continues to accept a required `worktreeId`, now referring to either a `primary` or `linked` workspace row.

The existing coding-agent workspace-list channel returns synchronized primary workspaces together with linked worktrees. Channel names and request shapes remain unchanged, avoiding parallel contracts for repository and worktree targets.

All payload validation remains in the main process. Before creating a session, the service resolves the selected row, confirms that its path is available, and revalidates primary workspaces against the repository's current `localRootPath`.

## User Interface

The new-session dialog keeps the existing project grouping and agent/title fields. Within each project:

- `Main checkout · <branch>` appears first when available.
- Linked targets retain their worktree name and branch.
- The first available main checkout is the default selection unless navigation explicitly requested a linked worktree.
- Selecting the main checkout displays concise guidance that changes happen directly in the shared checkout and can affect other local work.

Session lists and cards use the workspace kind to label primary sessions as `Main checkout` instead of implying that the workspace is unavailable or separately created. Existing session URLs keep their current shape because every target has a persisted workspace ID.

The design preserves current visual density, keyboard navigation, focus behavior, loading states, and error presentation. It introduces no new navigation entry or management screen.

## Error Handling and Safety

- Missing or invalid `localRootPath`: omit the primary option.
- Bare repository: omit the primary option and require a linked worktree.
- Path changes between listing and creation: reject creation with a user-friendly workspace-unavailable error.
- Detached HEAD: allow direct work but label the branch as `Detached HEAD`; Git operations retain their existing eligibility checks.
- Existing uncommitted changes: do not block chat creation. The inline warning communicates that the checkout is shared, and existing Git status/diff views expose resulting changes.
- Historical primary session with unavailable checkout: keep session metadata and surface the existing load/action error instead of deleting data.

No automatic stash, checkout, branch creation, cleanup, or destructive Git operation is introduced.

## Database Migration

The Drizzle schema adds a non-null text `kind` column to `worktrees` with a default of `linked`. Generated migration artifacts are produced with `npm run db:generate` and are not edited manually. Existing worktree records therefore preserve their current behavior.

The application enforces at most one primary workspace per repository. If the installed SQLite/Drizzle version supports the required partial unique index cleanly, the generated schema also adds a unique index for primary rows; otherwise synchronization uses a transaction and deterministic lookup to maintain this invariant without hand-editing generated SQL.

## Testing Strategy

Backend tests cover:

- creating a primary workspace for a valid non-bare checkout;
- updating its path and branch without creating duplicates;
- omitting missing, invalid, and bare repositories;
- returning only linked rows from normal worktree lists;
- returning both primary and linked contexts to the coding agent;
- creating a coding-agent session against the primary path;
- rejecting a primary target that becomes unavailable before creation.

Shared-contract and preload tests cover the discriminator and ensure the existing typed coding-agent calls continue to validate and forward requests.

Renderer tests cover:

- primary checkout ordering and default selection;
- preserving an explicitly requested linked-worktree selection;
- the shared-checkout warning;
- the submitted primary workspace ID;
- primary labels in session navigation and cards.

Verification consists of focused Vitest runs during TDD, the complete test suite, `npm run typecheck`, `npm run lint`, and the renderer/frontend build required by the project scripts after UI changes.

## Non-Goals

- Automatically converting a bare repository into a non-bare checkout.
- Creating, switching, or deleting branches for direct sessions.
- Preventing concurrent chats from using the same checkout.
- Adding primary checkouts to conflict-intelligence or linked-worktree management views.
- Renaming all existing `worktreeId` contracts to a broader workspace terminology.
