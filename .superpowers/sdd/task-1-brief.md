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

