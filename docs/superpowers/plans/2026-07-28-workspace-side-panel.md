# Workspace Side Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inspection-only sidebar with a modern workspace panel that provides a read-only file explorer, an integrated interactive terminal, and the existing diff view with operational Commit, Push, and GitHub PR actions.

**Architecture:** The renderer owns only panel state and presentation. Typed Zod IPC contracts route worktree IDs and relative paths to focused main-process services for filesystem reads, PTY lifecycle, Git commands, and GitHub PR creation. The existing cumulative session diff remains intact after commits; Git action availability refreshes independently from repository status.

**Tech Stack:** Electron 43, React 19, TypeScript 5 strict mode, Tailwind CSS 4, Lucide React, Zod 4, simple-git, Octokit, node-pty, @xterm/xterm, @xterm/addon-fit, Vitest.

## Global Constraints

- Use `npm` for every project and dependency command.
- Keep filesystem, PTY, Git, GitHub, and database access in the Electron main process.
- Accept `worktreeId` and relative paths over IPC; never accept an arbitrary absolute workspace root from the renderer.
- Validate renderer inputs with centralized Zod schemas.
- Preserve the existing cumulative coding-agent session diff after commit.
- `Commit` stages all changes with `git add -A`.
- `Open PR` creates a normal, non-draft PR toward `worktree.baseBranchName`.
- Render `Open PR` only for repositories linked to GitHub.
- Keep the UI dense, modern, and consistent with the existing dark/light theme tokens.
- Do not add file mutation, partial staging, force push, multiple terminals, or PR-management features.
- Do not use `any`.
- Do not modify database schema or generated migrations.
- Do not spawn subagents.

---

## File Structure

### Shared contracts

- Modify `src/shared/ipc/channels.ts` — declare workspace file, terminal, and Git channels.
- Modify `src/shared/ipc/schemas.ts` — define request, response, status, and terminal event schemas.
- Modify `src/shared/ipc/schemas.test.ts` — prove path, terminal, commit, and PR validation.
- Modify `src/shared/ipc/api.ts` — expose typed workspace API groups.

### Main process

- Create `src/main/workspace/workspace-path.ts` — canonical worktree-root resolution and containment checks.
- Create `src/main/workspace/workspace-file-service.ts` — lazy directory listing and safe read-only previews.
- Create `src/main/workspace/workspace-file-service.test.ts` — filesystem behavior and security tests.
- Create `src/main/workspace/workspace-terminal-service.ts` — PTY registry and lifecycle.
- Create `src/main/workspace/workspace-terminal-service.test.ts` — PTY lifecycle tests with an injected adapter.
- Create `src/main/workspace/workspace-git-service.ts` — Git status, commit, push, and PR orchestration.
- Create `src/main/workspace/workspace-git-service.test.ts` — Git workflow tests with injected Git/Octokit adapters.
- Modify `src/main/ipc/index.ts` — thin validated handlers and terminal event broadcast.
- Modify `src/main/ipc/github-auth-handlers.test.ts` — channel registration/authentication coverage.
- Modify `src/main.ts` — dispose terminal processes during application shutdown.
- Modify `vite.main.config.ts` — externalize `node-pty` as a native runtime module.

### Preload

- Modify `src/preload.ts` — invoke workspace operations and parse terminal events.
- Modify `src/preload-auth.test.ts` — prove invocation and exact listener cleanup.

### Renderer

- Create `src/renderer/features/coding-agent/components/WorkspacePanel.tsx` — panel shell and mode selection.
- Create `src/renderer/features/coding-agent/components/workspace-panel-state.ts` — pure mode and Git-availability helpers.
- Create `src/renderer/features/coding-agent/components/workspace-panel-state.test.ts` — helper tests.
- Rename `src/renderer/features/coding-agent/components/InspectionPanel.tsx` to `src/renderer/features/coding-agent/components/ReviewPanel.tsx` — preserve diff UI and host Git actions.
- Create `src/renderer/features/coding-agent/components/WorkspaceGitActions.tsx` — status/action row.
- Create `src/renderer/features/coding-agent/components/CommitDialog.tsx` — validated commit flow.
- Create `src/renderer/features/coding-agent/components/PullRequestDialog.tsx` — editable PR flow.
- Create `src/renderer/features/coding-agent/components/FileBrowserPanel.tsx` — lazy tree and selection orchestration.
- Create `src/renderer/features/coding-agent/components/FileTree.tsx` — accessible recursive tree.
- Create `src/renderer/features/coding-agent/components/FilePreview.tsx` — read-only preview states.
- Create `src/renderer/features/coding-agent/components/TerminalPanel.tsx` — xterm surface and lifecycle.
- Create `src/renderer/features/coding-agent/components/TerminalPanel.css` — scoped xterm theme/size integration.
- Create `src/renderer/features/coding-agent/components/WorkspacePanel.test.tsx` — interaction and rendering tests.
- Modify `src/renderer/features/coding-agent/components/coding-agent-layout.test.tsx` — review regression imports/assertions.
- Modify `src/renderer/features/coding-agent/views/CodingAgentSession.tsx` — render `WorkspacePanel`.

### Dependency metadata

- Modify `package.json` — add terminal/runtime and DOM-test dependencies; include `node-pty` in native rebuild.
- Modify `package-lock.json` — npm-generated dependency lock changes.

---

### Task 1: Install dependencies and define IPC contracts

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/shared/ipc/channels.ts`
- Modify: `src/shared/ipc/schemas.ts`
- Modify: `src/shared/ipc/schemas.test.ts`
- Modify: `src/shared/ipc/api.ts`

**Interfaces:**
- Produces:
  - `WorkspaceEntryDto`
  - `WorkspaceFilePreviewDto`
  - `WorkspaceTerminalEventDto`
  - `WorkspaceGitStatusDto`
  - `WorkspacePullRequestResultDto`
  - `Api.workspace.files`
  - `Api.workspace.terminal`
  - `Api.workspace.git`

- [ ] **Step 1: Install runtime and renderer test dependencies**

Run:

```bash
npm install @xterm/xterm @xterm/addon-fit node-pty
npm install --save-dev @testing-library/react @testing-library/user-event jsdom
```

Update `package.json`'s rebuild script to:

```json
"rebuild": "electron-rebuild -f -w better-sqlite3 -w node-pty"
```

- [ ] **Step 2: Write failing shared-schema tests**

Add tests that require:

```ts
expect(
  workspaceDirectoryRequestSchema.parse({
    worktreeId: "worktree-1",
    relativePath: "src/renderer",
  }),
).toEqual({
  worktreeId: "worktree-1",
  relativePath: "src/renderer",
});

expect(() =>
  workspaceDirectoryRequestSchema.parse({
    worktreeId: "worktree-1",
    relativePath: "../outside",
  }),
).toThrow();

expect(() =>
  workspaceTerminalResizeRequestSchema.parse({
    worktreeId: "worktree-1",
    terminalId: "terminal-1",
    cols: 0,
    rows: 24,
  }),
).toThrow();

expect(() =>
  workspaceCommitRequestSchema.parse({
    worktreeId: "worktree-1",
    message: "   ",
  }),
).toThrow();

expect(
  workspacePullRequestRequestSchema.parse({
    worktreeId: "worktree-1",
    title: "Add workspace panel",
    body: "Implements integrated workspace tools.",
    baseBranch: "main",
  }),
).toMatchObject({
  title: "Add workspace panel",
  baseBranch: "main",
});
```

- [ ] **Step 3: Run schema tests and verify RED**

Run:

```bash
npm test -- src/shared/ipc/schemas.test.ts
```

Expected: FAIL because the workspace schemas are not exported.

- [ ] **Step 4: Add channels and schemas**

Add these channel families:

```ts
WORKSPACE_DIRECTORY_LIST: "workspace:directory-list",
WORKSPACE_FILE_READ: "workspace:file-read",
WORKSPACE_TERMINAL_CREATE: "workspace:terminal-create",
WORKSPACE_TERMINAL_WRITE: "workspace:terminal-write",
WORKSPACE_TERMINAL_RESIZE: "workspace:terminal-resize",
WORKSPACE_TERMINAL_RESTART: "workspace:terminal-restart",
WORKSPACE_TERMINAL_DISPOSE: "workspace:terminal-dispose",
WORKSPACE_TERMINAL_EVENT: "workspace:terminal-event",
WORKSPACE_GIT_STATUS: "workspace:git-status",
WORKSPACE_GIT_COMMIT: "workspace:git-commit",
WORKSPACE_GIT_PUSH: "workspace:git-push",
WORKSPACE_GIT_OPEN_PR: "workspace:git-open-pr",
```

Implement shared contracts with these exact shapes:

```ts
const workspaceRelativePathSchema = z
  .string()
  .max(4096)
  .refine((value) => !/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/.test(value))
  .refine((value) => !value.split(/[\\/]+/).includes(".."));

export const workspaceEntrySchema = z.object({
  name: z.string(),
  relativePath: z.string(),
  kind: z.enum(["file", "directory"]),
  size: z.number().int().nonnegative().nullable(),
  hidden: z.boolean(),
});

export const workspaceFilePreviewSchema = z.object({
  relativePath: z.string(),
  size: z.number().int().nonnegative(),
  kind: z.enum(["text", "empty", "binary", "too_large"]),
  content: z.string().optional(),
});

export const workspaceTerminalEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("data"),
    worktreeId: z.string().min(1),
    terminalId: z.string().min(1),
    data: z.string(),
  }),
  z.object({
    type: z.literal("exit"),
    worktreeId: z.string().min(1),
    terminalId: z.string().min(1),
    exitCode: z.number().int(),
  }),
  z.object({
    type: z.literal("error"),
    worktreeId: z.string().min(1),
    terminalId: z.string().min(1),
    message: z.string(),
  }),
]);

export const workspaceGitStatusSchema = z.object({
  hasChanges: z.boolean(),
  hasOrigin: z.boolean(),
  hasUpstream: z.boolean(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  hasUnpushedCommits: z.boolean(),
  currentBranch: z.string(),
  baseBranch: z.string().nullable(),
  githubLinked: z.boolean(),
  pullRequestEligible: z.boolean(),
  suggestedPullRequestTitle: z.string(),
});
```

Use request schemas with trimmed non-empty `worktreeId`, bounded terminal input
of 65,536 characters, `cols` in `1..500`, `rows` in `1..300`, commit message in
`1..10_000`, PR title in `1..256`, body in `0..65_536`, and non-empty base
branch.

- [ ] **Step 5: Extend the typed API**

Add:

```ts
workspace: {
  files: {
    listDirectory(request): Promise<WorkspaceEntryDto[]>;
    readFile(request): Promise<WorkspaceFilePreviewDto>;
  };
  terminal: {
    create(request): Promise<{ terminalId: string }>;
    write(request): Promise<void>;
    resize(request): Promise<void>;
    restart(request): Promise<void>;
    dispose(request): Promise<void>;
    onEvent(listener): () => void;
  };
  git: {
    getStatus(request): Promise<WorkspaceGitStatusDto>;
    commit(request): Promise<WorkspaceGitStatusDto>;
    push(request): Promise<WorkspaceGitStatusDto>;
    openPullRequest(request): Promise<WorkspacePullRequestResultDto>;
  };
};
```

- [ ] **Step 6: Run schema tests and verify GREEN**

Run:

```bash
npm test -- src/shared/ipc/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/shared/ipc/channels.ts src/shared/ipc/schemas.ts src/shared/ipc/schemas.test.ts src/shared/ipc/api.ts
git commit -m "feat: define workspace panel contracts" -m "- Add xterm, PTY, and renderer interaction dependencies.\n- Define validated file, terminal, Git, and pull-request IPC payloads.\n- Extend the shared renderer API without exposing filesystem paths or credentials."
```

---

### Task 2: Implement safe file browsing services

**Files:**
- Create: `src/main/workspace/workspace-path.ts`
- Create: `src/main/workspace/workspace-file-service.ts`
- Create: `src/main/workspace/workspace-file-service.test.ts`

**Interfaces:**
- Consumes: `getWorktreeById(worktreeId)`
- Produces:

```ts
export interface WorkspaceFileService {
  listDirectory(
    worktreeId: string,
    relativePath: string,
  ): Promise<WorkspaceEntryDto[]>;
  readFile(
    worktreeId: string,
    relativePath: string,
  ): Promise<WorkspaceFilePreviewDto>;
}
```

- [ ] **Step 1: Write failing path-containment and listing tests**

Use a temporary fixture with `src/`, `.env.example`, `.git/`, a symlink to a
directory outside the fixture, and mixed-case entries. Assert:

```ts
await expect(service.listDirectory("wt-1", "../outside")).rejects.toThrow(
  "Path must stay inside the worktree.",
);
await expect(service.listDirectory("wt-1", "escape-link")).rejects.toThrow(
  "Path must stay inside the worktree.",
);
await expect(service.listDirectory("wt-1", "")).resolves.toEqual([
  expect.objectContaining({ name: "src", kind: "directory" }),
  expect.objectContaining({ name: ".env.example", kind: "file", hidden: true }),
]);
expect(entries.map((entry) => entry.name)).not.toContain(".git");
```

- [ ] **Step 2: Write failing preview classification tests**

Assert text, empty, binary, too-large, and missing cases:

```ts
await expect(service.readFile("wt-1", "src/index.ts")).resolves.toMatchObject({
  kind: "text",
  content: "export const value = 1;\n",
});
await expect(service.readFile("wt-1", "empty.txt")).resolves.toMatchObject({
  kind: "empty",
  size: 0,
});
await expect(service.readFile("wt-1", "image.bin")).resolves.toMatchObject({
  kind: "binary",
});
await expect(service.readFile("wt-1", "large.log")).resolves.toMatchObject({
  kind: "too_large",
});
```

- [ ] **Step 3: Run file-service tests and verify RED**

Run:

```bash
npm test -- src/main/workspace/workspace-file-service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 4: Implement canonical path resolution**

Implement:

```ts
export const resolveWorkspacePath = async ({
  worktreeId,
  relativePath,
  getWorktree = getWorktreeById,
}: ResolveWorkspacePathOptions): Promise<{
  worktree: Worktree;
  rootPath: string;
  targetPath: string;
}> => {
  const worktree = getWorktree(worktreeId);
  if (!worktree) throw new Error("Worktree not found.");
  const rootPath = await realpath(worktree.path);
  const candidate = resolve(rootPath, relativePath || ".");
  const targetPath = await realpath(candidate);
  if (targetPath !== rootPath && !targetPath.startsWith(`${rootPath}${sep}`)) {
    throw new Error("Path must stay inside the worktree.");
  }
  return { worktree, rootPath, targetPath };
};
```

Reject absolute input before `resolve`. Preserve original errors in main-process
logs while throwing safe service messages.

- [ ] **Step 5: Implement lazy listing and previews**

Use `readdir(..., { withFileTypes: true })`, `stat`, and a 1 MiB constant. Sort
directories first and names with:

```ts
left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
```

Detect binary content by scanning the first 8 KiB for a NUL byte. Decode text as
UTF-8 only after classification.

- [ ] **Step 6: Run file-service tests and verify GREEN**

Run:

```bash
npm test -- src/main/workspace/workspace-file-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/workspace/workspace-path.ts src/main/workspace/workspace-file-service.ts src/main/workspace/workspace-file-service.test.ts
git commit -m "feat: add secure workspace file browsing" -m "- Resolve every requested path beneath the canonical worktree root.\n- Reject traversal and symlink escapes while omitting internal Git metadata.\n- Provide lazy directory metadata and bounded read-only file previews."
```

---

### Task 3: Implement integrated terminal backend

**Files:**
- Create: `src/main/workspace/workspace-terminal-service.ts`
- Create: `src/main/workspace/workspace-terminal-service.test.ts`
- Modify: `vite.main.config.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces:

```ts
export interface WorkspaceTerminalService {
  create(input: TerminalCreateInput): Promise<{ terminalId: string }>;
  write(input: TerminalWriteInput): void;
  resize(input: TerminalResizeInput): void;
  restart(input: TerminalIdentity & { cols: number; rows: number }): void;
  dispose(input: TerminalIdentity): void;
  disposeAll(): void;
  subscribe(listener: (event: WorkspaceTerminalEventDto) => void): () => void;
}
```

- [ ] **Step 1: Write failing PTY lifecycle tests**

Inject a fake `spawnPty` and assert:

```ts
const created = await service.create({
  worktreeId: "wt-1",
  cols: 100,
  rows: 30,
});
expect(spawnPty).toHaveBeenCalledWith(
  "/bin/zsh",
  [],
  expect.objectContaining({ cwd: "/workspace/wt-1", cols: 100, rows: 30 }),
);

service.write({ worktreeId: "wt-1", terminalId: created.terminalId, data: "pwd\r" });
expect(fakePty.write).toHaveBeenCalledWith("pwd\r");

service.resize({ worktreeId: "wt-1", terminalId: created.terminalId, cols: 120, rows: 40 });
expect(fakePty.resize).toHaveBeenCalledWith(120, 40);
```

Also assert ownership mismatch rejection, output event forwarding, exit event
forwarding, restart replacing the PTY, dispose killing it once, and
`disposeAll()` clearing every entry.

- [ ] **Step 2: Run terminal-service tests and verify RED**

Run:

```bash
npm test -- src/main/workspace/workspace-terminal-service.test.ts
```

Expected: FAIL because the terminal service does not exist.

- [ ] **Step 3: Implement the PTY registry**

Use:

```ts
type TerminalRecord = {
  worktreeId: string;
  terminalId: string;
  cols: number;
  rows: number;
  pty: IPty;
  exited: boolean;
};
```

Choose the shell with:

```ts
const shell =
  process.platform === "win32"
    ? process.env.ComSpec ?? "powershell.exe"
    : process.env.SHELL ?? "/bin/zsh";
```

Pass `cwd`, `cols`, `rows`, `name: "xterm-256color"`, and a filtered copy of
`process.env` to `node-pty.spawn`. Do not send the environment over IPC.

- [ ] **Step 4: Externalize and clean up native PTY**

Add `"node-pty"` beside `"better-sqlite3"` in
`vite.main.config.ts`'s `rollupOptions.external`.

Call `workspaceTerminalService.disposeAll()` from the existing application
shutdown lifecycle in `src/main.ts`.

- [ ] **Step 5: Run terminal-service tests and verify GREEN**

Run:

```bash
npm test -- src/main/workspace/workspace-terminal-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/workspace/workspace-terminal-service.ts src/main/workspace/workspace-terminal-service.test.ts vite.main.config.ts src/main.ts
git commit -m "feat: add workspace PTY lifecycle" -m "- Manage one validated PTY process per terminal identifier in the main process.\n- Forward output and exit state without exposing environment data to the renderer.\n- Dispose native terminal resources during session and application shutdown."
```

---

### Task 4: Implement Git and GitHub publishing services

**Files:**
- Create: `src/main/workspace/workspace-git-service.ts`
- Create: `src/main/workspace/workspace-git-service.test.ts`
- Modify: `src/main/git/worktree.ts`

**Interfaces:**
- Produces:

```ts
export interface WorkspaceGitService {
  getStatus(worktreeId: string): Promise<WorkspaceGitStatusDto>;
  commit(worktreeId: string, message: string): Promise<WorkspaceGitStatusDto>;
  push(worktreeId: string): Promise<WorkspaceGitStatusDto>;
  createPullRequest(input: {
    worktreeId: string;
    title: string;
    body: string;
    baseBranch: string;
  }): Promise<WorkspacePullRequestResultDto>;
}
```

- [ ] **Step 1: Write failing Git availability tests**

Use an injected Git adapter and repository/worktree resolvers. Assert:

```ts
await expect(service.getStatus("wt-1")).resolves.toMatchObject({
  hasChanges: true,
  hasOrigin: true,
  currentBranch: "feat/side-panel",
  baseBranch: "main",
  githubLinked: true,
  pullRequestEligible: false,
});
```

Cover local repositories (`githubRepoId < 0`), missing origin, missing base
branch, current branch equal to base, published branch, and unpushed commits.

- [ ] **Step 2: Write failing commit, push, and PR tests**

Assert:

```ts
await service.commit("wt-1", "Add workspace side panel");
expect(git.add).toHaveBeenCalledWith(["-A"]);
expect(git.commit).toHaveBeenCalledWith("Add workspace side panel");

await service.push("wt-1");
expect(git.raw).toHaveBeenCalledWith([
  "push",
  "--set-upstream",
  "origin",
  "feat/side-panel",
]);

await service.createPullRequest({
  worktreeId: "wt-1",
  title: "Add workspace side panel",
  body: "Adds review, terminal, and file modes.",
  baseBranch: "main",
});
expect(octokit.rest.pulls.create).toHaveBeenCalledWith({
  owner: "owner",
  repo: "agentic-worktrees",
  head: "feat/side-panel",
  base: "main",
  title: "Add workspace side panel",
  body: "Adds review, terminal, and file modes.",
  draft: false,
});
```

Also test empty commit rejection, no-origin push rejection, unpublished PR
rejection, and non-GitHub repository PR rejection.

- [ ] **Step 3: Run Git-service tests and verify RED**

Run:

```bash
npm test -- src/main/workspace/workspace-git-service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 4: Export the authenticated Git client factory**

Rename the private `createGitClient` in `src/main/git/worktree.ts` to an
exported `createAuthenticatedGitClient(baseDir, accessToken?)`. Reuse it from
existing clone/worktree code so prompt disabling and token-safe headers remain
centralized.

- [ ] **Step 5: Implement status, commit, push, and PR**

Status uses `git.status()`, `git.getRemotes(true)`, and upstream/ahead queries.
For an untracked branch, derive unpublished work with
`rev-list --count <baseBranch>..HEAD`; for a tracked branch, use
`rev-list --count @{upstream}..HEAD`.
Suggested PR title comes from:

```ts
(await git.log({ maxCount: 1 })).latest?.message ?? worktree.branchName
```

Commit runs `add(["-A"])`, rechecks staged state, then commits. Push uses the
existing upstream when present or:

```ts
await git.raw([
  "push",
  "--set-upstream",
  "origin",
  worktree.branchName,
]);
```

PR creation uses `getAuthenticatedOctokit()` and returns:

```ts
{ number: response.data.number, url: response.data.html_url }
```

- [ ] **Step 6: Run Git-service tests and verify GREEN**

Run:

```bash
npm test -- src/main/workspace/workspace-git-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/git/worktree.ts src/main/workspace/workspace-git-service.ts src/main/workspace/workspace-git-service.test.ts
git commit -m "feat: add workspace Git publishing operations" -m "- Derive commit, push, and pull-request eligibility from the current worktree.\n- Stage all changes and publish branches through the shared authenticated Git transport.\n- Create non-draft GitHub pull requests without exposing credentials to the renderer."
```

---

### Task 5: Wire services through validated IPC and preload

**Files:**
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/ipc/github-auth-handlers.test.ts`
- Modify: `src/preload.ts`
- Modify: `src/preload-auth.test.ts`

**Interfaces:**
- Consumes all shared schemas and the three workspace services.
- Produces the complete `window.api.workspace` implementation.

- [ ] **Step 1: Write failing IPC registration and preload tests**

Extend the channel-registration set and assert:

```ts
await api.workspace.files.listDirectory({
  worktreeId: "wt-1",
  relativePath: "src",
});
expect(ipcRenderer.invoke).toHaveBeenCalledWith(
  IPC_CHANNELS.WORKSPACE_DIRECTORY_LIST,
  { worktreeId: "wt-1", relativePath: "src" },
);
```

For terminal subscription:

```ts
const cleanup = api.workspace.terminal.onEvent(listener);
terminalEventHandler?.({}, {
  type: "data",
  worktreeId: "wt-1",
  terminalId: "terminal-1",
  data: "ready",
  secret: "strip-me",
});
expect(listener).toHaveBeenCalledWith({
  type: "data",
  worktreeId: "wt-1",
  terminalId: "terminal-1",
  data: "ready",
});
cleanup();
expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
  IPC_CHANNELS.WORKSPACE_TERMINAL_EVENT,
  terminalEventHandler,
);
```

- [ ] **Step 2: Run IPC/preload tests and verify RED**

Run:

```bash
npm test -- src/main/ipc/github-auth-handlers.test.ts src/preload-auth.test.ts
```

Expected: FAIL because workspace channels are not registered or exposed.

- [ ] **Step 3: Add thin IPC handlers**

Each handler parses its request and delegates exactly once. Example:

```ts
const handleWorkspaceDirectoryList = async (
  _event: IpcMainInvokeEvent,
  rawRequest: unknown,
) => {
  const request = workspaceDirectoryRequestSchema.parse(rawRequest);
  return workspaceFileService.listDirectory(
    request.worktreeId,
    request.relativePath,
  );
};
```

Register file, terminal, Git status, commit, and push with the existing
authenticated application guard. Register PR creation with authentication,
create through the service, validate the returned URL, then call
`shell.openExternal(result.url)`.

Subscribe once to terminal-service events and broadcast parsed public events to
all renderer windows.

- [ ] **Step 4: Implement and parse preload API methods**

Use `ipcRenderer.invoke` for commands. Parse structured responses with their
Zod schemas. Parse terminal events before invoking renderer listeners and remove
the exact registered listener during cleanup.

- [ ] **Step 5: Run IPC/preload tests and verify GREEN**

Run:

```bash
npm test -- src/main/ipc/github-auth-handlers.test.ts src/preload-auth.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/index.ts src/main/ipc/github-auth-handlers.test.ts src/preload.ts src/preload-auth.test.ts
git commit -m "feat: expose workspace operations over typed IPC" -m "- Validate file, terminal, Git, and pull-request requests before delegation.\n- Forward sanitized terminal events and parse structured responses in preload.\n- Keep renderer access constrained to worktree identifiers and relative paths."
```

---

### Task 6: Build the workspace panel shell and preserve review behavior

**Files:**
- Create: `src/renderer/features/coding-agent/components/workspace-panel-state.ts`
- Create: `src/renderer/features/coding-agent/components/workspace-panel-state.test.ts`
- Create: `src/renderer/features/coding-agent/components/WorkspacePanel.tsx`
- Move: `src/renderer/features/coding-agent/components/InspectionPanel.tsx` to `src/renderer/features/coding-agent/components/ReviewPanel.tsx`
- Modify: `src/renderer/features/coding-agent/components/coding-agent-layout.test.tsx`
- Modify: `src/renderer/features/coding-agent/views/CodingAgentSession.tsx`

**Interfaces:**
- Produces:

```ts
export type WorkspacePanelMode = "review" | "terminal" | "files";

export type WorkspacePanelProps = {
  runId: string;
  worktreeId: string;
  worktreePath: string;
  diff: CodingAgentDiffDto[];
  focusedFile?: string;
  onFocusedFileConsumed?: () => void;
};
```

- [ ] **Step 1: Write failing mode and review regression tests**

Assert:

```ts
expect(getWorkspaceModeLabel("review")).toBe("Revisione");
expect(getWorkspaceModeLabel("terminal")).toBe("Terminale");
expect(getWorkspaceModeLabel("files")).toBe("File");
```

Render the panel server-side and require `aria-pressed="true"` for review,
the three accessible mode names, the truncated path, and existing diff
expansion markup.

- [ ] **Step 2: Run renderer tests and verify RED**

Run:

```bash
npm test -- src/renderer/features/coding-agent/components/workspace-panel-state.test.ts src/renderer/features/coding-agent/components/coding-agent-layout.test.tsx
```

Expected: FAIL because `WorkspacePanel` and state helpers do not exist.

- [ ] **Step 3: Implement the shell**

Use a compact segmented header with icons `ScanText`, `TerminalSquare`, and
`FolderTree`. Buttons use `aria-pressed`, visible focus rings, theme tokens, and
text labels hidden only at constrained widths.

Move existing `InspectionPanel` logic unchanged into `ReviewPanel`, changing
only its outer header ownership so `WorkspacePanel` supplies the mode selector
and path.

- [ ] **Step 4: Integrate into the session**

Replace:

```tsx
<InspectionPanel diff={diff} ... />
```

with:

```tsx
<WorkspacePanel
  key={runId}
  runId={runId}
  worktreeId={context.worktree.id}
  worktreePath={context.worktree.path}
  diff={diff}
  focusedFile={sessionState.selectedSummaryFile}
  onFocusedFileConsumed={clearFocusedDiffFile}
/>
```

Preserve the existing resize separator and width range.

- [ ] **Step 5: Run renderer tests and verify GREEN**

Run:

```bash
npm test -- src/renderer/features/coding-agent/components/workspace-panel-state.test.ts src/renderer/features/coding-agent/components/coding-agent-layout.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/features/coding-agent/components/WorkspacePanel.tsx src/renderer/features/coding-agent/components/ReviewPanel.tsx src/renderer/features/coding-agent/components/workspace-panel-state.ts src/renderer/features/coding-agent/components/workspace-panel-state.test.ts src/renderer/features/coding-agent/components/coding-agent-layout.test.tsx src/renderer/features/coding-agent/views/CodingAgentSession.tsx
git commit -m "feat: replace inspection with workspace panel" -m "- Add accessible Review, Terminal, and File mode selection to the resizable panel.\n- Preserve existing session-diff expansion and linked-file focus behavior.\n- Keep panel presentation aligned with the current dense application styling."
```

---

### Task 7: Implement the recursive read-only file UI

**Files:**
- Create: `src/renderer/features/coding-agent/components/FileBrowserPanel.tsx`
- Create: `src/renderer/features/coding-agent/components/FileTree.tsx`
- Create: `src/renderer/features/coding-agent/components/FilePreview.tsx`
- Modify: `src/renderer/features/coding-agent/components/WorkspacePanel.tsx`
- Modify: `src/renderer/features/coding-agent/components/WorkspacePanel.test.tsx`

**Interfaces:**
- `FileBrowserPanel({ worktreeId }: { worktreeId: string })`
- `FileTree` receives loaded nodes and callbacks; it does not invoke IPC.
- `FilePreview` receives `WorkspaceFilePreviewDto | undefined`, loading, and
  error state.

- [ ] **Step 1: Configure the interaction test environment**

At the top of `WorkspacePanel.test.tsx`, add:

```ts
// @vitest-environment jsdom
```

Provide a fully typed `window.api.workspace` fake in the test setup.

- [ ] **Step 2: Write failing file-browser interaction tests**

Render `FileBrowserPanel`, click the root `src` directory, and assert
`listDirectory({ worktreeId: "wt-1", relativePath: "src" })`. Click
`src/index.ts`, assert `readFile`, then assert the preview contains the returned
text and `read only`.

Add visible tests for binary, too-large, empty, loading, and error states.

- [ ] **Step 3: Run file UI tests and verify RED**

Run:

```bash
npm test -- src/renderer/features/coding-agent/components/WorkspacePanel.test.tsx
```

Expected: FAIL because file browser components do not exist.

- [ ] **Step 4: Implement lazy recursive tree state**

Store directory children by relative path:

```ts
type DirectoryState = {
  loading: boolean;
  loaded: boolean;
  entries: WorkspaceEntryDto[];
  error?: string;
};
```

Use semantic buttons with `aria-expanded` for directories. Use `Folder`,
`FolderOpen`, `FileText`, and `ChevronRight` icons. Keep row height compact and
indent by depth without horizontal overflow.

- [ ] **Step 5: Implement read-only preview**

Use a sticky preview header, `<pre>` for text, and explicit empty/binary/size
states. Do not use `dangerouslySetInnerHTML`. Reset stale preview errors when a
new file is selected.

- [ ] **Step 6: Run file UI tests and verify GREEN**

Run:

```bash
npm test -- src/renderer/features/coding-agent/components/WorkspacePanel.test.tsx
```

Expected: PASS for file-mode cases.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/features/coding-agent/components/FileBrowserPanel.tsx src/renderer/features/coding-agent/components/FileTree.tsx src/renderer/features/coding-agent/components/FilePreview.tsx src/renderer/features/coding-agent/components/WorkspacePanel.tsx src/renderer/features/coding-agent/components/WorkspacePanel.test.tsx
git commit -m "feat: add read-only workspace file explorer" -m "- Load folders lazily into an accessible recursive tree.\n- Preview bounded text content without exposing filesystem access to the renderer.\n- Surface empty, binary, oversized, loading, and error states in the panel."
```

---

### Task 8: Implement the integrated xterm UI

**Files:**
- Create: `src/renderer/features/coding-agent/components/TerminalPanel.tsx`
- Create: `src/renderer/features/coding-agent/components/TerminalPanel.css`
- Modify: `src/renderer/features/coding-agent/components/WorkspacePanel.tsx`
- Modify: `src/renderer/features/coding-agent/components/WorkspacePanel.test.tsx`

**Interfaces:**
- `TerminalPanel({ worktreeId, active }: { worktreeId: string; active: boolean })`
- Terminal ID is internal to `TerminalPanel`; the parent keeps the component
  mounted while switching modes.

- [ ] **Step 1: Write failing terminal UI lifecycle tests**

Mock `@xterm/xterm` and `@xterm/addon-fit`. Assert that mounting creates one
terminal, xterm input calls `workspace.terminal.write`, fit dimensions call
`resize`, incoming matching terminal events write output, and unmount calls
`dispose`.

Assert a terminal exit renders `Riavvia` and clicking it invokes restart.

- [ ] **Step 2: Run terminal UI tests and verify RED**

Run:

```bash
npm test -- src/renderer/features/coding-agent/components/WorkspacePanel.test.tsx
```

Expected: FAIL because terminal UI does not exist.

- [ ] **Step 3: Implement xterm lifecycle**

Instantiate once:

```ts
const terminal = new Terminal({
  convertEol: true,
  cursorBlink: true,
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  theme: terminalTheme,
});
terminal.loadAddon(fitAddon);
terminal.open(container);
```

Create the PTY after open, subscribe to events, forward `onData`, fit on active
mode and `ResizeObserver` changes, and dispose IPC/terminal/listeners on
unmount. Keep the component mounted with an inert hidden wrapper while inactive
so the xterm buffer survives mode switches.

- [ ] **Step 4: Add scoped modern styling**

Import `@xterm/xterm/css/xterm.css` and add only panel-scoped layout overrides:
full-height viewport, transparent background, compact padding, and focus ring
using existing theme tokens.

- [ ] **Step 5: Run terminal UI tests and verify GREEN**

Run:

```bash
npm test -- src/renderer/features/coding-agent/components/WorkspacePanel.test.tsx
```

Expected: PASS for terminal-mode cases.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/features/coding-agent/components/TerminalPanel.tsx src/renderer/features/coding-agent/components/TerminalPanel.css src/renderer/features/coding-agent/components/WorkspacePanel.tsx src/renderer/features/coding-agent/components/WorkspacePanel.test.tsx
git commit -m "feat: integrate workspace terminal UI" -m "- Attach xterm to a main-process PTY rooted in the active worktree.\n- Preserve terminal process and buffer state while switching panel modes.\n- Handle input, resize, exit, restart, and cleanup with accessible status UI."
```

---

### Task 9: Add operational Git actions and dialogs to Review

**Files:**
- Create: `src/renderer/features/coding-agent/components/WorkspaceGitActions.tsx`
- Create: `src/renderer/features/coding-agent/components/CommitDialog.tsx`
- Create: `src/renderer/features/coding-agent/components/PullRequestDialog.tsx`
- Modify: `src/renderer/features/coding-agent/components/ReviewPanel.tsx`
- Modify: `src/renderer/features/coding-agent/components/workspace-panel-state.ts`
- Modify: `src/renderer/features/coding-agent/components/workspace-panel-state.test.ts`
- Modify: `src/renderer/features/coding-agent/components/WorkspacePanel.tsx`
- Modify: `src/renderer/features/coding-agent/components/WorkspacePanel.test.tsx`

**Interfaces:**
- `WorkspaceGitActions({ worktreeId }: { worktreeId: string })`
- `canCommit(status, busy)`, `canPush(status, busy)`, and
  `canOpenPullRequest(status, busy)` are pure tested helpers.

- [ ] **Step 1: Write failing Git availability helper tests**

Assert:

```ts
expect(canCommit(status({ hasChanges: true }), false)).toBe(true);
expect(canPush(status({ hasOrigin: true, hasUnpushedCommits: true }), false)).toBe(true);
expect(canOpenPullRequest(status({
  githubLinked: true,
  pullRequestEligible: true,
}), false)).toBe(true);
expect(shouldShowOpenPullRequest(status({ githubLinked: false }))).toBe(false);
```

Assert all operations are disabled when `busy` is true.

- [ ] **Step 2: Write failing dialog and operation tests**

Use Testing Library to assert:

- `Commit` opens a dialog.
- whitespace commit message cannot submit.
- a valid message calls `workspace.git.commit`.
- commit failure keeps dialog content and renders an alert.
- `Push` calls `workspace.git.push` and refreshes status.
- `Open PR` is absent for local repositories.
- PR dialog prepopulates title/base, sends edited title/body, and keeps values
  after failure.

- [ ] **Step 3: Run Git UI tests and verify RED**

Run:

```bash
npm test -- src/renderer/features/coding-agent/components/workspace-panel-state.test.ts src/renderer/features/coding-agent/components/WorkspacePanel.test.tsx
```

Expected: FAIL because Git action components do not exist.

- [ ] **Step 4: Implement sticky Git actions**

Use `GitCommitHorizontal`, `Upload`, and `GitPullRequest` icons. `Commit` uses
the existing primary button variant; the others use outline. Render the row only
inside `ReviewPanel`.

On success, call `getStatus` again. Preserve the cumulative session diff: a
commit changes action availability but does not erase the agent's session
history.

- [ ] **Step 5: Implement commit and PR dialogs**

Reuse the existing `Dialog`, `Input`, `Label`, and `Button` components. Add a
plain `<textarea>` styled with theme tokens for PR body. Use inline
`role="alert"` messages and loading labels:

- `Committing…`
- `Pushing…`
- `Creating PR…`

- [ ] **Step 6: Run Git UI tests and verify GREEN**

Run:

```bash
npm test -- src/renderer/features/coding-agent/components/workspace-panel-state.test.ts src/renderer/features/coding-agent/components/WorkspacePanel.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/features/coding-agent/components/WorkspaceGitActions.tsx src/renderer/features/coding-agent/components/CommitDialog.tsx src/renderer/features/coding-agent/components/PullRequestDialog.tsx src/renderer/features/coding-agent/components/ReviewPanel.tsx src/renderer/features/coding-agent/components/workspace-panel-state.ts src/renderer/features/coding-agent/components/workspace-panel-state.test.ts src/renderer/features/coding-agent/components/WorkspacePanel.tsx src/renderer/features/coding-agent/components/WorkspacePanel.test.tsx
git commit -m "feat: add review publishing controls" -m "- Place Commit, Push, and Open PR exclusively in the diff panel.\n- Drive button availability from live worktree Git status and GitHub linkage.\n- Add resilient commit and non-draft pull-request dialogs with inline errors."
```

---

### Task 10: Full integration verification and documentation

**Files:**
- Modify: `README.md`
- Modify: any task-owned file only if verification exposes a defect.

**Interfaces:**
- No new interfaces.

- [ ] **Step 1: Update the README**

Under AI coding-agent sessions, document:

```md
- Switch the session side panel between review, an interactive worktree terminal,
  and a recursive read-only file explorer.
- Commit all worktree changes, push the current branch, and create a GitHub pull
  request directly from the review panel when the repository is GitHub-linked.
```

- [ ] **Step 2: Run focused workspace tests**

Run:

```bash
npm test -- src/shared/ipc/schemas.test.ts src/main/workspace src/main/ipc/github-auth-handlers.test.ts src/preload-auth.test.ts src/renderer/features/coding-agent/components/workspace-panel-state.test.ts src/renderer/features/coding-agent/components/WorkspacePanel.test.tsx src/renderer/features/coding-agent/components/coding-agent-layout.test.tsx
```

Expected: all targeted tests PASS with zero unhandled errors.

- [ ] **Step 3: Run the full test suite**

Run:

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 4: Run strict type checking**

Run:

```bash
npm run typecheck
```

Expected: exit code 0.

- [ ] **Step 5: Run lint**

Run:

```bash
npm run lint
```

Expected: exit code 0 with no new warnings in modified files.

- [ ] **Step 6: Build the renderer**

Run:

```bash
npm exec vite -- build --config vite.renderer.config.ts
```

Expected: renderer production build completes successfully.

- [ ] **Step 7: Package the Electron application**

Run:

```bash
npm run package
```

Expected: Forge completes main, preload, renderer, native-module packaging, and
asar assembly successfully.

- [ ] **Step 8: Inspect final scope**

Run:

```bash
git status --short
git diff --check HEAD
git diff --stat HEAD
```

Confirm there are no `.env` files, credentials, databases, logs, coverage,
workspace clones, or generated build artifacts in the commit scope.

- [ ] **Step 9: Commit**

```bash
git add README.md
git commit -m "docs: document workspace side panel workflows" -m "- Describe integrated review, terminal, and read-only file exploration.\n- Document commit, push, and GitHub pull-request actions available from review."
```
