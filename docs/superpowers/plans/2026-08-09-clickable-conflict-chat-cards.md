# Clickable Conflict Chat Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove standalone Open Chat actions and make real worktree cards the accessible chat-navigation controls.

**Architecture:** Extend the existing private `WorktreeCard` in `ConflictActions.tsx` with an optional `onOpenChat` callback. Render a semantic button when a run ID and callback exist, otherwise retain an article; use the same component for involved and independent worktrees.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Lucide React, Vitest, Testing Library.

## Global Constraints

- Modify only `ConflictActions.tsx` and `conflict-workspace.test.tsx`.
- Use existing real `worktreeId` and `runId`; do not add IPC or mock production data.
- Apply card navigation to involved and independent worktrees.
- Keep Compare Diffs unchanged.
- Do not use subagents or Ralph loop.

---

### Task 1: Clickable worktree cards

**Files:**
- Modify: `src/renderer/features/intelligence/components/ConflictActions.tsx`
- Modify: `src/renderer/features/intelligence/components/conflict-workspace.test.tsx`

**Interfaces:**
- Consumes: `IntelligenceWorktreeDto.runId`, existing `onOpenChat(worktreeId, runId)`, and `onCompare(overlapId)`.
- Produces: semantic chat-card buttons for worktrees with run IDs and article fallbacks otherwise.

- [ ] **Step 1: Update the test to require card navigation**

```tsx
fireEvent.click(screen.getByRole('button', { name: 'Open Home screen chat' }));
expect(onOpenChat).toHaveBeenCalledWith('left', 'left-run');
expect(screen.queryByText('Open Home screen chat', { selector: '.standalone-action' })).toBeNull();

fireEvent.click(screen.getByRole('button', { name: 'Open Settings cleanup chat' }));
expect(onOpenChat).toHaveBeenCalledWith('safe', 'safe-run');
```

Add a null-run worktree and assert `queryByRole('button', { name: 'Open Offline task chat' })` returns null.

- [ ] **Step 2: Run the test and verify RED**

```bash
npx vitest run src/renderer/features/intelligence/components/conflict-workspace.test.tsx
```

Expected: FAIL because independent cards are not clickable and standalone red chat buttons still exist.

- [ ] **Step 3: Implement semantic card behavior**

Extract card contents into a local `content` value. When `worktree.runId` and `onOpenChat` exist, return:

```tsx
<button
  type="button"
  aria-label={`Open ${worktree.task} chat`}
  onClick={() => onOpenChat(worktree.worktreeId, worktree.runId!)}
  className="group w-full rounded-lg border ... hover:border-primary/50 focus-visible:ring-2"
>
  {content}
</button>
```

Otherwise return the same content in an `<article>`. Add a compact visible `Open chat` affordance to interactive cards. Remove `MessageCircle` and both standalone Open Chat buttons. Pass `onOpenChat` to involved and independent `WorktreeCard` instances. Keep Compare Diffs as the only button in the actions block.

- [ ] **Step 4: Run focused verification**

```bash
npx vitest run src/renderer/features/intelligence/components/conflict-workspace.test.tsx
npm run typecheck
npx eslint src/renderer/features/intelligence/components/ConflictActions.tsx src/renderer/features/intelligence/components/conflict-workspace.test.tsx
```

Expected: test passes and diagnostics report zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/intelligence/components/ConflictActions.tsx src/renderer/features/intelligence/components/conflict-workspace.test.tsx
git commit -m "feat(intelligence): open chats from worktree cards"
```
