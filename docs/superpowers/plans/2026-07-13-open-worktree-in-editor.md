# Open Worktree in Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a coding-agent session open its worktree in any supported editor installed on the host machine.

**Architecture:** A main-process editor service owns a fixed cross-platform catalog, detects applications, and launches a validated directory. Typed shared IPC contracts expose discovery and opening; the preload forwards them. `CodingAgentSession` renders an accessible dropdown only when the backend reports an available editor.

**Tech Stack:** Electron 43, React 19, TypeScript 5, Zod 4, Vitest 4, Tailwind CSS.

## Global Constraints

- Support Visual Studio Code, Cursor, Zed, WebStorm, IntelliJ IDEA, Sublime Text, and Android Studio.
- Show only locally detected applications.
- Renderer uses typed IPC only; filesystem and process operations stay in the main process.
- Validate renderer input at IPC boundaries, use `npm`, then run `npm run typecheck` and `npm run package`.

---

### Task 1: Implement a testable editor launcher

**Files:**

- Create: `src/main/editors/editor-service.ts`
- Create: `src/main/editors/editor-service.test.ts`

**Interfaces:**

- Produces `EditorId`, `AvailableEditor`, `listAvailableEditors(): Promise<AvailableEditor[]>`, and `openEditor(editorId: EditorId, worktreePath: string): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
it('lists only installed macOS applications and opens a worktree', async () => {
  const spawn = vi.fn();
  const service = createEditorService({
    platform: 'darwin',
    exists: (file) => file === '/Applications/Cursor.app' || file === '/tmp/worktree',
    spawn,
  });
  await expect(service.listAvailableEditors()).resolves.toEqual([
    { id: 'cursor', name: 'Cursor' },
  ]);
  await service.openEditor('cursor', '/tmp/worktree');
  expect(spawn).toHaveBeenCalledWith('open', ['-a', 'Cursor', '/tmp/worktree'], {
    detached: true, stdio: 'ignore',
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- src/main/editors/editor-service.test.ts`

Expected: FAIL because `editor-service.ts` does not exist.

- [ ] **Step 3: Implement the catalog and launcher**

Define this immutable catalog:

```ts
export const EDITOR_CATALOG = [
  { id: 'vscode', name: 'Visual Studio Code', macApp: 'Visual Studio Code' },
  { id: 'cursor', name: 'Cursor', macApp: 'Cursor' },
  { id: 'zed', name: 'Zed', macApp: 'Zed' },
  { id: 'webstorm', name: 'WebStorm', macApp: 'WebStorm' },
  { id: 'intellij-idea', name: 'IntelliJ IDEA', macApp: 'IntelliJ IDEA' },
  { id: 'sublime-text', name: 'Sublime Text', macApp: 'Sublime Text' },
  { id: 'android-studio', name: 'Android Studio', macApp: 'Android Studio' },
] as const;
```

Use `existsSync`, `spawn`, and `process.platform` behind `createEditorService` dependency injection. On macOS test `/Applications/${macApp}.app` and launch `open -a <macApp> <worktreePath>` detached with ignored stdio, then `unref()` the child. Give the same IDs Windows and Linux command mappings. Reject a non-existent worktree and IDs absent from the catalog. Export production wrappers backed by actual Node dependencies.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- src/main/editors/editor-service.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the service**

Run: `git add src/main/editors/editor-service.ts src/main/editors/editor-service.test.ts && git commit -m "feat(editors): detect and open installed editors"`

### Task 2: Add typed, validated IPC actions

**Files:**

- Modify: `src/shared/ipc/channels.ts`
- Modify: `src/shared/ipc/schemas.ts`
- Create: `src/shared/ipc/schemas.test.ts`
- Modify: `src/shared/ipc/api.ts`
- Modify: `src/preload.ts`
- Modify: `src/main/ipc/index.ts`

**Interfaces:**

- Produces `window.api.editors.listAvailable(): Promise<AvailableEditorDto[]>` and `window.api.editors.open(request: { editorId: EditorId; worktreePath: string }): Promise<void>`.

- [ ] **Step 1: Write failing schema tests**

```ts
it('accepts known editor IDs and a worktree path', () => {
  expect(editorOpenRequestSchema.parse({ editorId: 'vscode', worktreePath: '/tmp/w' }))
    .toEqual({ editorId: 'vscode', worktreePath: '/tmp/w' });
});

it('rejects unknown editor IDs', () => {
  expect(() => editorOpenRequestSchema.parse({ editorId: 'unknown', worktreePath: '/tmp/w' }))
    .toThrow();
});
```

- [ ] **Step 2: Run the schema test to confirm it fails**

Run: `npm test -- src/shared/ipc/schemas.test.ts`

Expected: FAIL because `editorOpenRequestSchema` is not exported.

- [ ] **Step 3: Implement shared contracts and handlers**

Add `EDITOR_LIST_AVAILABLE: 'editor:list-available'` and `EDITOR_OPEN: 'editor:open'`. Add `editorIdSchema` as a Zod enum of the seven catalog IDs, `availableEditorSchema`, and `editorOpenRequestSchema` with a trimmed non-empty `worktreePath`. Infer and export DTO types.

Add the `editors` API group to `Api` and wire it in preload. In `src/main/ipc/index.ts`, import the service; list through `listAvailableEditors`, parse `editorOpenRequestSchema` before calling `openEditor`, and register both handlers in `registerIpcHandlers`.

- [ ] **Step 4: Run relevant tests**

Run: `npm test -- src/shared/ipc/schemas.test.ts src/main/editors/editor-service.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the IPC boundary**

Run: `git add src/shared/ipc src/preload.ts src/main/ipc/index.ts && git commit -m "feat(ipc): expose installed editor actions"`

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

### Task 4: Verify the feature

**Files:**

- No source changes expected.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Run static and production verification**

Run: `npm run typecheck && npm run package`

Expected: both commands exit with status 0.

- [ ] **Step 3: Review the diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors or unintentional files.
