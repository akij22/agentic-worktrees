# Codex Slash Commands and File Mentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Codex sessions the existing `/status`, `/compact`, `/model`, and `/stop` workflow, and let both Codex and OpenCode users insert searchable worktree-relative `@file` references.

**Architecture:** The existing workspace file service performs bounded Git-aware path search behind validated IPC, while a focused renderer helper and hook detect the mention at the textarea caret and load suggestions. Slash commands become agent-neutral; the Codex adapter implements app-server compaction and caches protocol token-usage notifications so the shared status popup can omit cost entirely when the provider does not supply it.

**Tech Stack:** Electron 43, React 19, TypeScript 5 strict mode, Zod 4, Node `child_process`, Codex app-server protocol, Tailwind CSS 4, Vitest, Testing Library.

## Global Constraints

- Use `npm` for all project commands.
- Keep Git, filesystem discovery, Codex protocol operations, and validation in the Electron main process.
- Keep shared IPC schemas and API contracts centralized.
- Preserve the existing OpenCode slash-command behavior.
- File mentions are plain-text worktree-relative references; never copy file contents into the message.
- Exclude `.git` and Git-ignored files from mention search.
- Codex status must contain no cost label, placeholder, or availability message.
- Do not use `any`.
- Do not change the database schema or generated migrations.
- Do not spawn subagents.

---

## File Structure

### Shared IPC contracts

- Modify `src/shared/ipc/channels.ts` — add the workspace file-search channel.
- Modify `src/shared/ipc/schemas.ts` — validate bounded search requests/results and make session cost optional.
- Modify `src/shared/ipc/schemas.test.ts` — cover search bounds and optional cost.
- Modify `src/shared/ipc/api.ts` — expose `workspace.files.search`.

### Main process and preload

- Modify `src/main/workspace/workspace-file-service.ts` — list Git-visible paths and rank bounded matches.
- Modify `src/main/workspace/workspace-file-service.test.ts` — cover matching, ordering, ignored candidates, limits, and failures.
- Modify `src/main/ipc/index.ts` — register a thin validated search handler.
- Modify `src/preload.ts` — invoke the search channel and parse results.
- Modify `src/preload-auth.test.ts` — prove the search request uses the dedicated channel.

### Codex backend

- Modify `src/main/coding-agents/codex-protocol.ts` — parse token-usage notifications.
- Modify `src/main/coding-agents/codex-protocol.test.ts` — verify strict token-usage parsing.
- Modify `src/main/coding-agents/codex-adapter.ts` — compact Codex threads and retain per-thread usage.
- Modify `src/main/coding-agents/codex-adapter.test.ts` — cover compaction, usage caching, unavailable usage, and cache cleanup.
- Modify `src/main/coding-agents/coding-agent-service.ts` — allow adapter-backed usage and compaction for both agent kinds.
- Modify `src/main/coding-agents/coding-agent-service.test.ts` — verify Codex requests reach its adapter.

### Renderer

- Modify `src/renderer/features/coding-agent/lib/slash-commands.ts` — make the command catalog agent-neutral.
- Modify `src/renderer/features/coding-agent/lib/slash-commands.test.ts` — preserve filtering behavior under neutral names.
- Create `src/renderer/features/coding-agent/lib/file-mentions.ts` — pure caret detection, quoting, and draft replacement.
- Create `src/renderer/features/coding-agent/lib/file-mentions.test.ts` — cover mention parsing and insertion.
- Create `src/renderer/features/coding-agent/hooks/useFileMentionSuggestions.ts` — debounced, stale-safe file lookup state.
- Create `src/renderer/features/coding-agent/hooks/useFileMentionSuggestions.test.tsx` — cover loading, results, stale responses, and errors.
- Modify `src/renderer/features/coding-agent/components/SessionComposer.tsx` — render and operate the shared command/file palette.
- Modify `src/renderer/features/coding-agent/components/SessionComposer.test.tsx` — cover Codex commands and mention interactions.
- Modify `src/renderer/features/coding-agent/components/SessionStatusPopup.tsx` — use agent-neutral labels and conditionally render cost.
- Modify `src/renderer/features/coding-agent/views/CodingAgentSession.tsx` — use the neutral command type; existing callbacks continue dispatching commands.

---

### Task 1: Add validated worktree file search

**Files:**
- Modify: `src/shared/ipc/channels.ts`
- Modify: `src/shared/ipc/schemas.ts`
- Modify: `src/shared/ipc/schemas.test.ts`
- Modify: `src/shared/ipc/api.ts`
- Modify: `src/main/workspace/workspace-file-service.ts`
- Modify: `src/main/workspace/workspace-file-service.test.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/preload.ts`
- Modify: `src/preload-auth.test.ts`

**Interfaces:**
- Produces: `workspaceFileSearchRequestSchema` with `{ worktreeId: string; query: string; limit: number }`.
- Produces: `workspaceFileSearchResponseSchema` and `WorkspaceFileSearchResultDto` as safe relative path strings.
- Produces: `WorkspaceFileService.searchFiles(worktreeId, query, limit): Promise<string[]>`.
- Produces: `Api.workspace.files.search(request): Promise<string[]>`.

- [ ] **Step 1: Write failing shared-schema tests**

Add literal tests to `src/shared/ipc/schemas.test.ts`:

```ts
expect(
  workspaceFileSearchRequestSchema.parse({
    worktreeId: 'worktree-1',
    query: 'composer',
    limit: 20,
  }),
).toEqual({ worktreeId: 'worktree-1', query: 'composer', limit: 20 });

expect(() =>
  workspaceFileSearchRequestSchema.parse({
    worktreeId: 'worktree-1',
    query: 'x'.repeat(513),
    limit: 20,
  }),
).toThrow();

expect(() =>
  workspaceFileSearchRequestSchema.parse({
    worktreeId: 'worktree-1',
    query: '',
    limit: 101,
  }),
).toThrow();

expect(
  workspaceFileSearchResponseSchema.parse([
    'src/renderer/App.tsx',
    'README.md',
  ]),
).toEqual(['src/renderer/App.tsx', 'README.md']);
```

- [ ] **Step 2: Run schema tests and verify RED**

Run:

```bash
npm test -- src/shared/ipc/schemas.test.ts
```

Expected: FAIL because the file-search schemas are not exported.

- [ ] **Step 3: Implement the shared contract**

Add `WORKSPACE_FILE_SEARCH: 'workspace:file-search'`. Define:

```ts
export const workspaceFileSearchRequestSchema = z.object({
  worktreeId: workspaceIdSchema,
  query: z.string().max(512),
  limit: z.number().int().min(1).max(100).default(20),
});

export const workspaceFileSearchResponseSchema = z.array(
  workspaceRelativePathSchema.min(1),
);

export type WorkspaceFileSearchResultDto = z.infer<
  typeof workspaceFileSearchResponseSchema
>;
```

Extend `Api.workspace.files` with:

```ts
search: (request: {
  worktreeId: string;
  query: string;
  limit?: number;
}) => Promise<WorkspaceFileSearchResultDto>;
```

- [ ] **Step 4: Run schema tests and verify GREEN**

Run `npm test -- src/shared/ipc/schemas.test.ts`.

Expected: PASS.

- [ ] **Step 5: Write failing workspace-service tests**

Inject a `listFiles` dependency so tests do not shell out. Cover these exact candidates:

```ts
const listedFiles = [
  'README.md',
  'src/renderer/App.tsx',
  'src/renderer/features/coding-agent/components/SessionComposer.tsx',
  'docs/Session Composer notes.md',
];
```

Assert:

```ts
await expect(service.searchFiles('worktree-1', 'session', 20)).resolves.toEqual([
  'src/renderer/features/coding-agent/components/SessionComposer.tsx',
  'docs/Session Composer notes.md',
]);

await expect(service.searchFiles('worktree-1', 'app', 1)).resolves.toEqual([
  'src/renderer/App.tsx',
]);

await expect(service.searchFiles('worktree-1', '', 2)).resolves.toHaveLength(2);
```

Use these explicit failure assertions:

```ts
await expect(
  service.searchFiles('missing-worktree', '', 20),
).rejects.toThrow('Worktree not found.');

const gitFailure = new Error('git failed');
const failingService = createWorkspaceFileService({
  getWorktree: () => ({ id: 'worktree-1', path: fixtureRoot }),
  listFiles: async () => Promise.reject(gitFailure),
});
const failure = await failingService
  .searchFiles('worktree-1', '', 20)
  .catch((cause: unknown) => cause);
expect(failure).toMatchObject({
  message: 'File search is unavailable.',
  cause: gitFailure,
});
```

- [ ] **Step 6: Run the workspace-service test and verify RED**

Run:

```bash
npm test -- src/main/workspace/workspace-file-service.test.ts
```

Expected: FAIL because `searchFiles` and the injectable `listFiles` dependency do not exist.

- [ ] **Step 7: Implement Git-visible file discovery and deterministic ranking**

Add an injectable default that runs:

```ts
execFile('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: worktreePath,
  maxBuffer: 10 * 1024 * 1024,
});
```

Resolve `relativePath: ''` through the existing `resolveWorkspacePath` helper and use its canonical `targetPath` as `cwd`. Split NUL-delimited output, discard empty paths, absolute paths, and paths with `..` segments, and deduplicate. Rank case-insensitive matches in this order:

```ts
basename === query       // 0
basename.startsWith(query) // 1
path segment startsWith(query) // 2
basename.includes(query) // 3
fullPath.includes(query) // 4
```

Sort ties with `localeCompare` using base sensitivity, then return `slice(0, limit)`. For an empty query, sort all candidates by relative path and apply the limit. Resolve the worktree through the existing workspace dependency before invoking Git. Log the original failure and throw `new Error('File search is unavailable.', { cause })`.

- [ ] **Step 8: Run the workspace-service test and verify GREEN**

Run `npm test -- src/main/workspace/workspace-file-service.test.ts`.

Expected: PASS.

- [ ] **Step 9: Write failing preload forwarding coverage**

In `src/preload-auth.test.ts`, invoke:

```ts
await api.workspace.files.search({
  worktreeId: 'worktree-1',
  query: 'composer',
  limit: 20,
});
```

Expect `ipcRenderer.invoke` to receive `IPC_CHANNELS.WORKSPACE_FILE_SEARCH` and that request.

- [ ] **Step 10: Run the preload test and verify RED**

Run `npm test -- src/preload-auth.test.ts`.

Expected: FAIL because `Api.workspace.files.search` is not wired.

- [ ] **Step 11: Wire the thin IPC handler and preload parser**

The handler must do only:

```ts
const request = workspaceFileSearchRequestSchema.parse(rawRequest);
return workspaceFileService.searchFiles(
  request.worktreeId,
  request.query,
  request.limit,
);
```

Register it through `requireAuthenticated`. In preload, invoke the new channel and parse with `workspaceFileSearchResponseSchema`.

- [ ] **Step 12: Run focused contract tests and verify GREEN**

Run:

```bash
npm test -- src/shared/ipc/schemas.test.ts src/main/workspace/workspace-file-service.test.ts src/preload-auth.test.ts src/main/ipc/github-auth-handlers.test.ts
```

Expected: PASS.

- [ ] **Step 13: Commit the backend search slice**

```bash
git add src/shared/ipc/channels.ts src/shared/ipc/schemas.ts src/shared/ipc/schemas.test.ts src/shared/ipc/api.ts src/main/workspace/workspace-file-service.ts src/main/workspace/workspace-file-service.test.ts src/main/ipc/index.ts src/preload.ts src/preload-auth.test.ts
git commit -m "feat(workspace): add file mention search" -m "- Add validated IPC contracts for bounded worktree file lookup.\n- Search tracked and non-ignored files in the main process.\n- Rank relative paths deterministically without exposing file contents."
```

---

### Task 2: Build pure file-mention parsing and insertion

**Files:**
- Create: `src/renderer/features/coding-agent/lib/file-mentions.ts`
- Create: `src/renderer/features/coding-agent/lib/file-mentions.test.ts`

**Interfaces:**
- Produces: `ActiveFileMention { start: number; end: number; query: string }`.
- Produces: `findActiveFileMention(draft: string, caret: number): ActiveFileMention | undefined`.
- Produces: `insertFileMention(draft: string, mention: ActiveFileMention, path: string): { draft: string; caret: number }`.

- [ ] **Step 1: Write failing mention-detection tests**

Cover start-of-draft, whitespace boundaries, mid-draft editing, and false positives:

```ts
expect(findActiveFileMention('@src/app', 8)).toEqual({
  start: 0,
  end: 8,
  query: 'src/app',
});

expect(findActiveFileMention('Review @Session before send', 15)).toEqual({
  start: 7,
  end: 15,
  query: 'Session',
});

expect(findActiveFileMention('mail aki@example.com', 20)).toBeUndefined();
expect(findActiveFileMention('prefix@src/App.tsx', 18)).toBeUndefined();
```

- [ ] **Step 2: Write failing insertion tests**

```ts
expect(
  insertFileMention(
    'Review @Ses please',
    { start: 7, end: 11, query: 'Ses' },
    'src/Session.tsx',
  ),
).toEqual({
  draft: 'Review @src/Session.tsx  please',
  caret: 24,
});

expect(
  insertFileMention(
    '@notes',
    { start: 0, end: 6, query: 'notes' },
    'docs/Session Notes.md',
  ),
).toEqual({
  draft: '@"docs/Session Notes.md" ',
  caret: 25,
});
```

Add this escaping assertion:

```ts
expect(
  insertFileMention(
    '@odd',
    { start: 0, end: 4, query: 'odd' },
    'docs/a "quoted" \\ path.md',
  ).draft,
).toBe('@"docs/a \\"quoted\\" \\\\ path.md" ');
```

- [ ] **Step 3: Run mention tests and verify RED**

Run:

```bash
npm test -- src/renderer/features/coding-agent/lib/file-mentions.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Implement the minimal pure helpers**

Clamp the caret to `0..draft.length`. Inspect only `draft.slice(0, caret)`, locate the last `@` that is either index `0` or preceded by whitespace, and return the span through the caret. Reject candidates containing a newline after `@`. Quote a selected path only when it contains whitespace, `"`, or `\\`; escape backslashes first and quotes second. Replace only `[start, end)` and append exactly one space.

- [ ] **Step 5: Run mention tests and verify GREEN**

Run `npm test -- src/renderer/features/coding-agent/lib/file-mentions.test.ts`.

Expected: PASS.

- [ ] **Step 6: Commit the pure mention behavior**

```bash
git add src/renderer/features/coding-agent/lib/file-mentions.ts src/renderer/features/coding-agent/lib/file-mentions.test.ts
git commit -m "feat(chat): parse and insert file mentions" -m "- Detect active at-mentions at the textarea caret.\n- Preserve surrounding draft text during insertion.\n- Quote and escape relative paths that contain whitespace."
```

---

### Task 3: Add the shared `@` suggestion experience and Codex slash palette

**Files:**
- Modify: `src/renderer/features/coding-agent/lib/slash-commands.ts`
- Modify: `src/renderer/features/coding-agent/lib/slash-commands.test.ts`
- Create: `src/renderer/features/coding-agent/hooks/useFileMentionSuggestions.ts`
- Create: `src/renderer/features/coding-agent/hooks/useFileMentionSuggestions.test.tsx`
- Modify: `src/renderer/features/coding-agent/components/SessionComposer.tsx`
- Modify: `src/renderer/features/coding-agent/components/SessionComposer.test.tsx`
- Modify: `src/renderer/features/coding-agent/views/CodingAgentSession.tsx`

**Interfaces:**
- Renames: `OpenCodeSlashCommandId` to `SlashCommandId`.
- Renames: `OPEN_CODE_SLASH_COMMANDS` to `SLASH_COMMANDS`.
- Renames: `filterOpenCodeSlashCommands` to `filterSlashCommands`.
- Produces: `useFileMentionSuggestions({ worktreeId, mention })` returning `{ paths, loading, error }`.
- Consumes: `Api.workspace.files.search` and the Task 2 mention helpers.

- [ ] **Step 1: Change slash-command tests first**

Update imports to the neutral names and add an assertion that the catalog descriptions do not contain `OpenCode`. Keep the existing `/`, `/co`, embedded slash, and argument cases unchanged.

- [ ] **Step 2: Add failing Codex composer visibility coverage**

Change the existing component expectation so both agent kinds contain:

```html
aria-label="Session slash commands"
```

and `/status`, `/compact`, `/model`, `/stop`. The current Codex-negative test must be replaced, not retained.

- [ ] **Step 3: Run focused slash/composer tests and verify RED**

Run:

```bash
npm test -- src/renderer/features/coding-agent/lib/slash-commands.test.ts src/renderer/features/coding-agent/components/SessionComposer.test.tsx
```

Expected: FAIL because slash commands are still OpenCode-only.

- [ ] **Step 4: Generalize the slash-command catalog and composer gate**

Rename the types/functions/constants, remove `OpenCode` from descriptions and ARIA labels, and compute suggestions with `filterSlashCommands(draft)` for every session kind. Update `CodingAgentSession.tsx` and the composer callback prop to use `SlashCommandId`. Do not change command dispatch behavior yet.

- [ ] **Step 5: Run slash/composer tests and verify GREEN**

Run the same focused command as Step 3.

Expected: PASS.

- [ ] **Step 6: Write failing hook tests**

Use fake timers and a deferred promise. Assert that an active mention triggers after a 100 ms debounce:

```ts
expect(window.api.workspace.files.search).toHaveBeenCalledWith({
  worktreeId: 'worktree-1',
  query: 'sess',
  limit: 20,
});
```

Assert loading begins before resolution, the newest query wins when an older promise resolves later, errors become a string, and `mention: undefined` clears results without making a request.

- [ ] **Step 7: Run hook tests and verify RED**

Run:

```bash
npm test -- src/renderer/features/coding-agent/hooks/useFileMentionSuggestions.test.tsx
```

Expected: FAIL because the hook does not exist.

- [ ] **Step 8: Implement the stale-safe suggestion hook**

Use a 100 ms `window.setTimeout`, a monotonically increasing request ID in a ref, and cleanup that invalidates the request. Return at most the 20 paths already bounded by the backend. Convert caught values with `cause instanceof Error ? cause.message : String(cause)`; never ignore a rejection.

- [ ] **Step 9: Run hook tests and verify GREEN**

Run the hook test from Step 7.

Expected: PASS.

- [ ] **Step 10: Write failing composer mention interaction tests**

Under the jsdom environment, mock `window.api.workspace.files.search`, render a Codex composer, place the caret after `Fix @Ses`, and assert:

- a listbox labeled `Worktree files` appears after the debounce;
- Arrow Down changes the selected result;
- Enter replaces only `@Ses` and calls `onDraftChange('Fix @src/Session.tsx ')`;
- the textarea selection is restored after render to the returned caret;
- mouse selection works;
- Escape closes the mention palette without clearing `Fix @Ses`;
- `No matching files` and `Could not search worktree files` render for empty and rejected searches;
- Shift+Enter does not select a mention;
- a slash query takes precedence over an `@` elsewhere in the same draft.

- [ ] **Step 11: Run the composer test and verify RED**

Run `npm test -- src/renderer/features/coding-agent/components/SessionComposer.test.tsx`.

Expected: FAIL because the mention palette is absent.

- [ ] **Step 12: Implement the composer mention palette**

Add a textarea ref and caret state updated by `onChange`, `onSelect`, `onClick`, and `onKeyUp`. Feed the active mention into the hook. Keep one `selectedSuggestionIndex`, reset it when the suggestion identity changes, and give slash suggestions precedence. Reuse one palette shell but give command and file results separate labels/content.

When a file is chosen:

```ts
const next = insertFileMention(draft, activeMention, path);
onDraftChange(next.draft);
pendingCaretRef.current = next.caret;
```

Restore `selectionStart` and `selectionEnd` in an effect after the controlled draft updates. Escape records the current mention identity as dismissed; clear that dismissal only when draft, caret, or session changes. Loading, empty, and error rows must not be selectable. Do not call `readFile` and do not alter `onSend`.

- [ ] **Step 13: Run all focused renderer tests and verify GREEN**

Run:

```bash
npm test -- src/renderer/features/coding-agent/lib/slash-commands.test.ts src/renderer/features/coding-agent/lib/file-mentions.test.ts src/renderer/features/coding-agent/hooks/useFileMentionSuggestions.test.tsx src/renderer/features/coding-agent/components/SessionComposer.test.tsx
```

Expected: PASS.

- [ ] **Step 14: Commit the renderer interaction slice**

```bash
git add src/renderer/features/coding-agent/lib/slash-commands.ts src/renderer/features/coding-agent/lib/slash-commands.test.ts src/renderer/features/coding-agent/lib/file-mentions.ts src/renderer/features/coding-agent/lib/file-mentions.test.ts src/renderer/features/coding-agent/hooks/useFileMentionSuggestions.ts src/renderer/features/coding-agent/hooks/useFileMentionSuggestions.test.tsx src/renderer/features/coding-agent/components/SessionComposer.tsx src/renderer/features/coding-agent/components/SessionComposer.test.tsx src/renderer/features/coding-agent/views/CodingAgentSession.tsx
git commit -m "feat(chat): add shared file mention palette" -m "- Expose slash commands in both Codex and OpenCode sessions.\n- Search worktree paths from active at-mentions at the caret.\n- Add accessible keyboard and mouse selection without changing message payloads."
```

---

### Task 4: Implement Codex compaction and token usage

**Files:**
- Modify: `src/main/coding-agents/codex-protocol.ts`
- Modify: `src/main/coding-agents/codex-protocol.test.ts`
- Modify: `src/main/coding-agents/codex-adapter.ts`
- Modify: `src/main/coding-agents/codex-adapter.test.ts`
- Modify: `src/main/coding-agents/coding-agent-service.ts`
- Modify: `src/main/coding-agents/coding-agent-service.test.ts`

**Interfaces:**
- Extends: `CodexNotification` with `tokenUsage`.
- Produces: `readCodexNotification('thread/tokenUsage/updated', params)`.
- Implements: `CodexAdapter.compact(directory, sessionId, input): Promise<void>`.
- Implements: `CodexAdapter.getUsage(directory, sessionId, input): Promise<CodingAgentSessionUsage>`.
- Changes: `getAgentSessionUsage` and `compactAgentSession` delegate to either installed adapter.

- [ ] **Step 1: Write failing protocol tests for token usage**

Parse this notification:

```ts
const notification = readCodexNotification('thread/tokenUsage/updated', {
  threadId: 'thread-1',
  turnId: 'turn-1',
  tokenUsage: {
    total: {
      totalTokens: 60_000,
      inputTokens: 50_000,
      cachedInputTokens: 10_000,
      cacheWriteInputTokens: 0,
      outputTokens: 10_000,
      reasoningOutputTokens: 2_000,
    },
    last: {
      totalTokens: 40_000,
      inputTokens: 35_000,
      cachedInputTokens: 8_000,
      cacheWriteInputTokens: 0,
      outputTokens: 5_000,
      reasoningOutputTokens: 1_000,
    },
    modelContextWindow: 200_000,
  },
});
```

Expect `notification.type === 'tokenUsage'`, and assert malformed negative counts or a missing `threadId` throw rather than being silently ignored.

- [ ] **Step 2: Run protocol tests and verify RED**

Run `npm test -- src/main/coding-agents/codex-protocol.test.ts`.

Expected: FAIL because token usage is not recognized.

- [ ] **Step 3: Implement strict token-usage schemas and projection**

Create private Zod schemas for nonnegative integer token breakdowns and:

```ts
{
  threadId: z.string(),
  turnId: z.string(),
  tokenUsage: {
    total: tokenBreakdownSchema,
    last: tokenBreakdownSchema,
    modelContextWindow: z.number().int().positive().nullable(),
  },
}
```

Return `{ type: 'tokenUsage', params }` for exactly `thread/tokenUsage/updated`.

- [ ] **Step 4: Run protocol tests and verify GREEN**

Run `npm test -- src/main/coding-agents/codex-protocol.test.ts`.

Expected: PASS.

- [ ] **Step 5: Write failing Codex adapter tests**

Add this local test helper:

```ts
const emitTokenUsage = (
  client: FakeCodexClient,
  threadId: string,
  modelContextWindow: number | null = 200_000,
) =>
  client.emit({
    method: 'thread/tokenUsage/updated',
    params: {
      threadId,
      turnId: 'turn-1',
      tokenUsage: {
        total: {
          totalTokens: 60_000,
          inputTokens: 50_000,
          cachedInputTokens: 10_000,
          cacheWriteInputTokens: 0,
          outputTokens: 10_000,
          reasoningOutputTokens: 2_000,
        },
        last: {
          totalTokens: 40_000,
          inputTokens: 35_000,
          cachedInputTokens: 8_000,
          cacheWriteInputTokens: 0,
          outputTokens: 5_000,
          reasoningOutputTokens: 1_000,
        },
        modelContextWindow,
      },
    },
  });
```

Assert compaction sends:

```ts
await adapter.compact('/repo', 'thread-1', {
  providerId: 'openai',
  modelId: 'gpt-5.4',
});
expect(client.requestFor('thread/compact/start').params).toEqual({
  threadId: 'thread-1',
});
```

Emit the notification from Step 1 and expect:

```ts
emitTokenUsage(client, 'thread-1');
await expect(
  adapter.getUsage('/repo', 'thread-1', {
    providerId: 'openai',
    modelId: 'gpt-5.4',
  }),
).resolves.toEqual({
  contextTokens: 40_000,
  contextWindow: 200_000,
  contextPercentage: 20,
  providerId: 'openai',
  modelId: 'gpt-5.4',
});
```

Add these explicit cases:

```ts
await expect(
  adapter.getUsage('/repo', 'thread-1', {
    providerId: 'openai',
    modelId: 'gpt-5.4',
  }),
).rejects.toThrow('Codex token usage is not available yet.');

emitTokenUsage(client, 'thread-1', null);
await expect(
  adapter.getUsage('/repo', 'thread-1', {
    providerId: 'openai',
    modelId: 'gpt-5.4',
  }),
).rejects.toThrow('Codex context window is not available yet.');

await expect(
  adapter.getUsage('/repo', 'thread-2', {
    providerId: 'openai',
    modelId: 'gpt-5.4',
  }),
).rejects.toThrow('Codex token usage is not available yet.');

await adapter.stop();
await expect(
  adapter.getUsage('/repo', 'thread-1', {
    providerId: 'openai',
    modelId: 'gpt-5.4',
  }),
).rejects.toThrow('Codex token usage is not available yet.');
```

- [ ] **Step 6: Run adapter tests and verify RED**

Run `npm test -- src/main/coding-agents/codex-adapter.test.ts`.

Expected: FAIL because Codex compact/usage throw OpenCode-only errors.

- [ ] **Step 7: Implement Codex compact and usage caching**

Add `usageByThread` beside existing adapter maps. Handle `tokenUsage` before the terminal-turn branch in `handleIncomingMessage`, cache `notification.params.tokenUsage` by `threadId`, and return without emitting a renderer event. Clear it in `stop()`.

Implement compaction by recording the directory and requesting `thread/compact/start`. Implement usage with `last.totalTokens` as current context consumption and `modelContextWindow` as the denominator. Clamp the percentage to `0..100`; do not add `totalCost`. Continue validating `providerId === 'openai'` consistently with `sendPrompt`.

- [ ] **Step 8: Run adapter tests and verify GREEN**

Run `npm test -- src/main/coding-agents/codex-adapter.test.ts`.

Expected: PASS.

- [ ] **Step 9: Write failing service delegation tests**

Extend the fake Codex adapter in `coding-agent-service.test.ts` to record `compact` and return a cost-free usage object. Seed a Codex run and assert `compactAgentSession(runId)` calls the Codex adapter and `getAgentSessionUsage(runId)` returns its usage. These tests must currently fail on the service's explicit OpenCode guards.

- [ ] **Step 10: Run service tests and verify RED**

Run `npm test -- src/main/coding-agents/coding-agent-service.test.ts`.

Expected: FAIL with the current “only available for OpenCode” errors.

- [ ] **Step 11: Remove agent-kind guards and delegate through the common adapter**

Delete only the `installation.kind !== 'opencode'` early errors from `getAgentSessionUsage` and `compactAgentSession`. Retain existing worktree lookup, startup, status transitions, adapter arguments, error propagation, and reconciliation scheduling.

- [ ] **Step 12: Run all Codex backend tests and verify GREEN**

Run:

```bash
npm test -- src/main/coding-agents/codex-protocol.test.ts src/main/coding-agents/codex-adapter.test.ts src/main/coding-agents/coding-agent-service.test.ts
```

Expected: PASS.

- [ ] **Step 13: Commit the Codex backend slice**

```bash
git add src/main/coding-agents/codex-protocol.ts src/main/coding-agents/codex-protocol.test.ts src/main/coding-agents/codex-adapter.ts src/main/coding-agents/codex-adapter.test.ts src/main/coding-agents/coding-agent-service.ts src/main/coding-agents/coding-agent-service.test.ts
git commit -m "feat(codex): support compact and session usage" -m "- Parse and cache Codex thread token-usage notifications.\n- Dispatch manual thread compaction through the app-server protocol.\n- Delegate shared status and compact operations through either coding-agent adapter."
```

---

### Task 5: Make status presentation provider-neutral and omit Codex cost

**Files:**
- Modify: `src/shared/ipc/schemas.ts`
- Modify: `src/shared/ipc/schemas.test.ts`
- Modify: `src/main/coding-agents/types.ts`
- Modify: `src/renderer/features/coding-agent/components/SessionStatusPopup.tsx`
- Modify: `src/renderer/features/coding-agent/components/SessionComposer.test.tsx`

**Interfaces:**
- Changes: `CodingAgentSessionUsage.totalCost?: number`.
- Changes: `codingAgentSessionUsageSchema.totalCost` to optional.
- Consumes: `session.agentName` for status labels.

- [ ] **Step 1: Write failing optional-cost schema and popup tests**

Add this schema case:

```ts
expect(
  codingAgentSessionUsageSchema.parse({
    contextTokens: 40_000,
    contextWindow: 200_000,
    contextPercentage: 20,
    providerId: 'openai',
    modelId: 'gpt-5.4',
  }),
).not.toHaveProperty('totalCost');
```

Add popup markup coverage for a Codex session asserting it contains `Codex status`, `20.0%`, and `openai/gpt-5.4`, while all of the following are absent:

```ts
expect(markup).not.toContain('Spent');
expect(markup).not.toContain('$');
expect(markup.toLocaleLowerCase()).not.toContain('unavailable');
expect(markup.toLocaleLowerCase()).not.toContain('not available');
```

Keep the OpenCode test asserting `$1.2345` and `Spent`.

- [ ] **Step 2: Run schema and popup tests and verify RED**

Run:

```bash
npm test -- src/shared/ipc/schemas.test.ts src/renderer/features/coding-agent/components/SessionComposer.test.tsx
```

Expected: FAIL because cost is required and labels are hard-coded to OpenCode.

- [ ] **Step 3: Make cost optional across backend and IPC types**

Change only:

```ts
totalCost?: number;
```

and:

```ts
totalCost: z.number().nonnegative().optional(),
```

OpenCode continues returning its numeric cost without adapter changes.

- [ ] **Step 4: Render provider-neutral status and conditional cost**

Use `${session.agentName} session status` for ARIA and `${session.agentName} status` for the heading. Render the `Spent` detail only when `usage?.totalCost !== undefined`. Adjust the `dl` grid so a cost-free Codex response renders only the current model without an empty grid cell. Do not render substitute copy for absent cost.

- [ ] **Step 5: Run schema and popup tests and verify GREEN**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 6: Run all focused feature tests**

Run:

```bash
npm test -- src/shared/ipc/schemas.test.ts src/main/workspace/workspace-file-service.test.ts src/preload-auth.test.ts src/main/ipc/github-auth-handlers.test.ts src/main/coding-agents/codex-protocol.test.ts src/main/coding-agents/codex-adapter.test.ts src/main/coding-agents/coding-agent-service.test.ts src/renderer/features/coding-agent/lib/slash-commands.test.ts src/renderer/features/coding-agent/lib/file-mentions.test.ts src/renderer/features/coding-agent/hooks/useFileMentionSuggestions.test.tsx src/renderer/features/coding-agent/components/SessionComposer.test.tsx
```

Expected: PASS with no unhandled rejection or React warning.

- [ ] **Step 7: Commit the status presentation slice**

```bash
git add src/shared/ipc/schemas.ts src/shared/ipc/schemas.test.ts src/main/coding-agents/types.ts src/renderer/features/coding-agent/components/SessionStatusPopup.tsx src/renderer/features/coding-agent/components/SessionComposer.test.tsx
git commit -m "feat(chat): show provider-aware session status" -m "- Generalize session status labels for Codex and OpenCode.\n- Make provider cost data optional across strict shared contracts.\n- Omit the complete cost UI when Codex does not supply it."
```

---

### Task 6: Full verification and requirement audit

**Files:**
- Review all files modified by Tasks 1–5.
- Do not create generated database, coverage, or packaged application artifacts.

**Interfaces:**
- Verifies all interfaces produced by the previous tasks.

- [ ] **Step 1: Run the complete test suite**

```bash
npm test
```

Expected: all Vitest suites pass with zero failures.

- [ ] **Step 2: Run strict TypeScript checking**

```bash
npm run typecheck
```

Expected: exit code 0 with no diagnostics.

- [ ] **Step 3: Build the renderer**

```bash
npm exec vite -- build --config vite.renderer.config.ts
```

Expected: exit code 0. Do not stage generated build output.

- [ ] **Step 4: Audit the final diff against the approved design**

Confirm all items explicitly:

- Codex and OpenCode both show the four slash commands.
- OpenCode command behavior remains unchanged.
- Codex `/compact` sends `thread/compact/start`.
- Codex `/status` uses real cached usage and includes no cost-related UI or copy.
- `@` search works at the caret for both agent kinds.
- Selected paths are relative plain text; content is never attached.
- Ignored files and `.git` are absent from results.
- Renderer code performs no direct Git or filesystem operation.
- IPC input is validated and errors are visible to users.

- [ ] **Step 5: Inspect repository state and diff hygiene**

```bash
git status --short
git diff --check
git log --oneline -6
```

Expected: no whitespace errors, no secret/generated artifact, and only scoped feature changes.
