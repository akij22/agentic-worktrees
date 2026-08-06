# Codex Slash Commands and File Mentions Design

## Goal

Add the existing slash-command experience to Codex sessions and add file
mentions to both Codex and OpenCode sessions. File mentions remain plain-text
worktree-relative references; file contents are not copied into chat messages.

## Scope

- Preserve the existing OpenCode slash-command behavior.
- Expose `/status`, `/compact`, `/model`, and `/stop` in Codex sessions.
- Support `@` file search and insertion in both Codex and OpenCode composers.
- Keep filesystem discovery and Codex protocol operations in the Electron main
  process.
- Reuse the existing compact composer palette instead of introducing a new
  screen or workflow.

The feature does not attach file contents, index file contents, expose ignored
files, or add commands beyond the four listed above.

## Slash Commands

The slash-command catalog becomes agent-neutral. Both agent kinds show the
same four commands when the draft starts with `/` and contains no arguments:

- `/status` opens the session status popup.
- `/compact` compacts an idle session.
- `/model` focuses and opens the existing model selector.
- `/stop` interrupts the active turn when one exists.

OpenCode continues using its current adapter operations. Codex compaction uses
the app-server `thread/compact/start` request. Codex interruption and model
selection continue using the existing adapter paths.

Codex token usage is collected from `thread/tokenUsage/updated` notifications
and retained per thread by the Codex adapter. The status popup shows context
tokens, context-window percentage, and the current model. Cost UI is rendered
only when the selected agent supplies cost information; the Codex status view
contains no cost label, placeholder, or availability message.

If Codex has not emitted token usage for the thread yet, `/status` returns a
meaningful error and the popup presents it through the existing error area. It
must not synthesize zero usage.

## File Search

The existing workspace file service gains a focused search operation. The main
process obtains candidate paths from Git so results include tracked files and
non-ignored untracked files while excluding `.git` and ignored files. The
operation validates the worktree identifier through the existing workspace
path boundary before running Git in that worktree.

The request contains the worktree identifier, search query, and a bounded
result limit. Results are worktree-relative file paths sorted by match quality,
then deterministically by path. Matching is case-insensitive and considers both
the basename and complete relative path. Empty queries return the first bounded
set of candidates so typing `@` immediately opens a useful palette.

Backend failures retain their original context in main-process logs and cross
IPC as a user-safe search error. Stale asynchronous search responses are
discarded by the renderer when the draft, caret, or session changes.

## Mention Parsing and Insertion

An active mention begins with `@` at the start of the draft or immediately
after whitespace. Its query extends from `@` to the caret. An `@` embedded in a
word or email address does not open the palette. Mention detection is based on
the textarea selection, not only the end of the draft, so editing earlier text
works correctly.

Selecting a result replaces only the active mention span:

- A path without whitespace becomes `@relative/path `.
- A path containing whitespace becomes `@"relative/path with spaces" `.

Text before and after the active span is preserved and the caret moves after
the inserted trailing space. Multiple file mentions are supported in one
message. The outgoing content stays plain text and follows the existing
`sendMessage` IPC path unchanged for both agents.

## Composer Interaction

The composer uses one suggestion surface at a time:

1. A valid slash query at the start of the draft has precedence.
2. Otherwise, an active file mention opens the file palette.
3. Otherwise, no palette is rendered.

Both palettes support mouse selection and the existing keyboard behavior:

- Arrow Up and Arrow Down cycle through results.
- Enter or Tab selects the highlighted item.
- Escape dismisses the active palette without clearing unrelated draft text.
- Shift+Enter continues to insert a newline.

File search shows a compact loading row, an empty-result message, and a
user-friendly error. The textarea remains usable if search fails.

## Boundaries

- The renderer performs presentation, caret tracking, and draft replacement.
- Shared IPC schemas define and validate file-search requests and results.
- Thin IPC handlers delegate file search to the existing workspace file
  service.
- The main process performs Git/file discovery and Codex app-server operations.
- No secrets, absolute worktree paths, or file contents are exposed through the
  mention API.

## Testing

Unit and component tests cover:

- agent-neutral slash-command filtering and Codex palette visibility;
- slash command keyboard execution and preservation of OpenCode behavior;
- active mention detection at the caret, including emails and mid-draft edits;
- quoting paths with spaces and preserving surrounding draft text;
- loading, empty, error, mouse, and keyboard states for file suggestions;
- workspace-bound file search, ignored-file exclusion, result limits, matching,
  ranking, and safe error propagation;
- Codex `thread/compact/start` requests;
- Codex token-usage notification parsing, per-thread caching, and errors before
  usage is available;
- provider-neutral status rendering and complete omission of cost UI for Codex.

Before completion, run the relevant Vitest suites, the full TypeScript type
check, and the renderer build required by the project instructions.
