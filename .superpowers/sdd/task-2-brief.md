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

