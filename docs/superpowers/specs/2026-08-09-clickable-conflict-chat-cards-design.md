# Clickable Conflict Chat Cards Design

## Objective

Remove the standalone Open Chat buttons from the Intelligence conflict action panel and make each worktree context card the direct chat-navigation control.

## Scope

Modify only `src/renderer/features/intelligence/components/ConflictActions.tsx` and its focused renderer test. Do not change other screens, routes, IPC contracts, snapshot data, or diff comparison behavior.

## Interaction

- A worktree card with a non-null `runId` renders as a semantic button.
- Clicking or keyboard-activating the card calls `onOpenChat(worktreeId, runId)`.
- This applies consistently to involved and independent worktree cards.
- A worktree card without a `runId` renders as a non-interactive article and does not claim button semantics.
- Remove the two red standalone Open Chat buttons.
- Keep Compare Diffs as the only standalone action.

## Visual and Accessibility Behavior

Clickable cards preserve all real task, agent, branch, file, addition, deletion, and path data. They gain restrained hover background/border feedback, a visible keyboard focus ring, and a compact “Open chat” affordance. The accessible button name includes the worktree task, for example `Open Home screen chat`.

Non-interactive cards retain their existing appearance without hover or focus treatment.

## Testing

Update `conflict-workspace.test.tsx` to verify:

- standalone Open Chat buttons are absent;
- clicking an involved worktree card passes its real worktree and run IDs;
- clicking an independent worktree card passes its real worktree and run IDs;
- Compare Diffs still uses the selected overlap ID;
- a null-run card is not exposed as a chat button.
