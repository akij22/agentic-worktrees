# Workspace Side Panel Design

## Summary

Replace the coding-agent session's inspection-only sidebar with a generic,
resizable workspace side panel. The panel provides three folder-scoped modes:

- `Revisione`: inspect the current session diff and run the Git publishing
  workflow.
- `Terminale`: use an interactive terminal rooted in the current worktree.
- `File`: browse the worktree recursively and preview text files read-only.

The renderer remains presentation-only. Filesystem access, terminal process
management, Git operations, and GitHub API access remain in the Electron main
process behind centralized, validated IPC contracts.

## Goals

- Preserve the dense, operational visual language of the existing coding-agent
  screen.
- Keep the existing resizable side-panel behavior.
- Allow users to switch between review, terminal, and file exploration without
  leaving the coding-agent session.
- Keep an integrated terminal process alive while users switch panel modes.
- Make `Commit`, `Push`, and `Open PR` real operations available only from the
  diff view.
- Create pull requests only for repositories linked to a GitHub remote.
- Keep file access read-only in this phase.

## Non-goals

- Editing, creating, renaming, moving, or deleting files from the file browser.
- Multiple terminal tabs, split terminals, terminal profiles, or shell
  configuration UI.
- Partial staging, per-file staging, commit amend, force push, branch creation,
  branch switching, or history browsing.
- Pull-request review, merge, draft conversion, labels, reviewers, assignees,
  milestones, or issue linking.
- A new dashboard, route, or standalone repository-management screen.

## User Interface

### Panel shell

`WorkspacePanel` replaces `InspectionPanel` in the existing session layout and
retains the current resize separator and width constraints.

The panel header contains a compact mode selector with three entries in this
order:

1. `Revisione`
2. `Terminale`
3. `File`

The active mode uses the application's existing red accent. Inactive modes use
the current neutral dark treatment. At narrow panel widths, labels may collapse
to icons with accessible names and tooltips. A compact, truncated worktree path
appears below the selector.

The default mode is `Revisione`, preserving the screen's current behavior.
Switching modes does not navigate away from the active coding-agent session.

### Review mode

The existing file-level session diff remains the main content. A sticky action
row sits below the review header and above the scrollable diff:

- `Commit` is the primary action and opens a commit dialog.
- `Push` is a secondary action.
- `Open PR` is a secondary action and is rendered only when the current
  repository is linked to GitHub.

The commit dialog requires a non-empty commit message. Confirming the dialog
stages all changes with `git add -A`, including untracked and deleted files,
then creates one commit.

The pull-request dialog is prefilled with:

- the current branch as the head branch;
- `worktree.baseBranchName` as the base branch;
- a title derived from the latest commit subject when available;
- an editable description.

The pull request is created as a normal, non-draft PR. After successful
creation, its GitHub URL opens in the system browser.

Availability rules:

- `Commit` is enabled only when the worktree has changes and no workspace Git
  operation is running.
- `Push` is enabled only when `origin` is usable, the branch has commits to
  publish, and no workspace Git operation is running.
- `Open PR` is visible only when the repository is linked to GitHub. It is
  enabled only after the current branch is published, differs from the base
  branch, and no workspace Git operation is running.
- Starting any Git operation temporarily disables all three actions.

The action row belongs to the entire session diff, not to an individual file.
No duplicate Git actions appear in the worktree toolbar or other panel modes.

### Terminal mode

The terminal view contains a minimal toolbar, an xterm-compatible interactive
surface, connection state, and a `Riavvia` action when the shell exits.

The shell starts with the current worktree path as its working directory. It
supports:

- typed input;
- streaming output;
- terminal resizing;
- normal shell exit;
- explicit restart after exit.

One terminal process belongs to the mounted coding-agent session view. The
process and terminal buffer remain alive while the user switches panel modes.
The process is disposed when that session view is unmounted or the Electron
window closes.

The renderer uses `@xterm/xterm` and `@xterm/addon-fit`. The main process uses
`node-pty` so the terminal behaves like a real interactive shell rather than a
plain spawned command.

### File mode

The file view is split vertically:

- a scrollable recursive tree in the upper region;
- a read-only preview in the lower region.

Directory contents load lazily when a folder expands. Entries sort directories
before files, then alphabetically using a case-insensitive comparison. The tree
shows hidden project files but omits the worktree's internal `.git` entry.

Selecting a text file loads its content into a read-only monospace preview. The
preview header shows the relative path and file size. The preview distinguishes:

- loading;
- empty file;
- text content;
- binary file;
- file larger than the preview limit;
- file that disappeared or became unavailable.

The preview limit is 1 MiB. File mode does not expose mutation controls.

## Renderer Architecture

The renderer is split by responsibility:

- `WorkspacePanel` owns mode selection, shared header state, and terminal
  lifecycle coordination.
- `ReviewPanel` owns diff expansion, focus requests, Git action state, and
  action dialogs.
- `WorkspaceGitActions` renders the sticky action row and delegates actions.
- `CommitDialog` owns commit-message input and commit submission state.
- `PullRequestDialog` owns editable PR title/body and submission state.
- `TerminalPanel` owns the xterm surface and forwards input/resize events.
- `FileBrowserPanel` owns expanded directory state and the selected file.
- `FileTree` renders lazy directory nodes.
- `FilePreview` renders read-only content and non-previewable states.

No renderer component imports Node filesystem, child-process, Git, database, or
GitHub modules.

## Shared IPC Contracts

All requests identify a worktree by `worktreeId`. File requests accept only a
relative path. The main process resolves the stored worktree path itself.

New typed IPC operations cover:

- listing a directory;
- reading a previewable file;
- creating, writing to, resizing, restarting, and disposing a terminal;
- receiving terminal output and exit events;
- reading Git action availability;
- committing all changes;
- pushing the current branch;
- creating a pull request.

Zod schemas validate every renderer request and every structured response.
Terminal event payloads are parsed before being exposed to renderer listeners.

## Main-process Services

### Workspace file service

The file service resolves the worktree from persistence, obtains its canonical
root with `realpath`, and resolves requested relative paths beneath that root.
It rejects:

- absolute paths;
- `..` traversal outside the worktree;
- symlinks whose canonical targets leave the worktree;
- paths that are not the requested type.

Directory listing returns only metadata needed by the tree. File reads are
read-only, capped at 1 MiB, and classified as text, empty, binary, too large, or
unavailable.

### Workspace terminal service

The terminal service owns PTY processes in a registry keyed by an opaque
terminal ID. Creation validates the worktree and starts the platform's default
shell in the canonical worktree directory.

The service validates terminal ownership using both terminal ID and worktree
ID before accepting input, resize, restart, or dispose requests. Output and exit
events contain no environment variables or credentials beyond what the shell
itself prints in response to user commands.

The service cleans up terminals on explicit disposal and application shutdown.
Original PTY errors are logged in the main process; renderer responses use safe
messages.

### Workspace Git service

The Git service resolves and validates the worktree before creating a
`simple-git` client.

Git status reports:

- whether changes exist;
- whether `origin` is available;
- whether the current branch has an upstream;
- ahead/behind counts when available;
- whether commits need publishing;
- whether the repository is linked to GitHub;
- the current and base branch names.

Commit performs `git add -A`, rejects an empty staged result, and creates a
commit with the validated message.

Push publishes the current branch to `origin` and sets upstream when absent.
Credential prompting is disabled so Electron requests cannot hang. GitHub-linked
repositories use the existing authenticated Git transport without exposing a
token to the renderer or command-line arguments.

Pull-request creation requires:

- a GitHub-linked repository;
- a published current branch;
- a non-empty base branch different from the current branch;
- non-empty title;
- authenticated GitHub access.

The service uses the repository's stored owner/name with Octokit, creates a
non-draft PR, and returns its public URL. The IPC handler opens only that returned
GitHub URL through Electron's `shell.openExternal`.

## Error Handling

Operational errors appear inline within the active panel mode.

- Commit and PR dialogs remain open with their entered values after failure.
- A failed push leaves the review state intact and can be retried.
- A terminal exit shows its exit code and a restart action.
- File-list and file-preview errors are distinct, local states.

The main process logs original errors with worktree and operation context.
Renderer-facing errors avoid credentials, environment contents, raw
authentication headers, and unvalidated filesystem paths.

Successful Git operations refresh Git status and the session snapshot so the
diff and action availability reflect the new repository state.

## Testing

Implementation follows red-green-refactor.

Main-process unit tests cover:

- directory listing and sorting;
- text, empty, binary, too-large, and missing-file previews;
- traversal and symlink escape rejection;
- PTY create/input/resize/exit/restart/dispose lifecycle;
- Git availability derivation;
- `git add -A` commit behavior;
- push with and without an existing upstream;
- PR eligibility and Octokit request construction;
- safe error propagation.

IPC tests cover:

- channel registration;
- Zod request rejection;
- worktree-ID-based resolution;
- terminal event forwarding and cleanup;
- GitHub authentication enforcement for PR creation.

Renderer tests cover:

- default and switched panel modes;
- active mode accessibility state;
- lazy file-tree expansion and preview states;
- terminal lifecycle delegation;
- Git action visibility and enabled states;
- commit and PR dialog validation;
- loading and inline error states;
- continued rendering and expansion of existing diff content.

Completion requires:

- targeted tests passing;
- the full Vitest suite passing;
- `npm run typecheck` passing;
- the renderer/frontend build passing.

