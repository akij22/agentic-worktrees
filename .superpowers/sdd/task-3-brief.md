### Task 3: Render the session dropdown

**Files:**

- Create: `src/renderer/components/ui/dropdown-menu.tsx`
- Modify: `src/renderer/features/coding-agent/views/CodingAgentSession.tsx`

**Interfaces:**

- Consumes the two `window.api.editors` methods and `context.worktree.path`.
- Produces an `Open in editor` menu that does not render when no editor is available.

- [ ] **Step 1: Write the failing component test**

```tsx
it('opens the selected worktree in an installed editor', async () => {
  window.api.editors.listAvailable = vi.fn().mockResolvedValue([
    { id: 'vscode', name: 'Visual Studio Code' },
  ]);
  window.api.editors.open = vi.fn().mockResolvedValue(undefined);
  render(<CodingAgentSession runId="run_1" />);
  await userEvent.click(await screen.findByRole('button', { name: /open in editor/i }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Visual Studio Code' }));
  expect(window.api.editors.open).toHaveBeenCalledWith({
    editorId: 'vscode', worktreePath: '/tmp/worktree',
  });
});
```

- [ ] **Step 2: Run the component test to confirm it fails**

Run: `npm test -- src/renderer/features/coding-agent/views/CodingAgentSession.test.tsx`

Expected: FAIL because the API and control do not exist.

- [ ] **Step 3: Implement the UI**

Create a small accessible menu component with a trigger button, `aria-expanded`, `role="menu"`, `role="menuitem"`, and Escape-to-close behavior. In `CodingAgentSession`, load available editors after a snapshot exists. Add the trigger beside the worktree metadata only for a non-empty list. When selected, clear `editorError`, call `window.api.editors.open({ editorId: editor.id, worktreePath: context.worktree.path })`, and render a concise `text-destructive` error under the header if the call fails.

- [ ] **Step 4: Run the component test**

Run: `npm test -- src/renderer/features/coding-agent/views/CodingAgentSession.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the renderer feature**

Run: `git add src/renderer/components/ui/dropdown-menu.tsx src/renderer/features/coding-agent/views/CodingAgentSession.tsx src/renderer/features/coding-agent/views/CodingAgentSession.test.tsx && git commit -m "feat(coding-agent): open worktrees in installed editors"`

