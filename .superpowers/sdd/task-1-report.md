# Task 1 — Testable editor launcher report

## Implementation

Added a main-process-only editor service with:

- The required immutable seven-editor catalog and exported `EditorId` and `AvailableEditor` contracts.
- Injectable platform, filesystem-existence, and process-spawn dependencies through `createEditorService`.
- macOS detection at `/Applications/<app>.app` and detached `open -a <app> <worktree>` launches with ignored stdio and child `unref()`.
- Windows and Linux command mappings for every catalog ID.
- Rejection of unsupported editor IDs and missing worktree paths.
- Production `listAvailableEditors` and `openEditor` wrappers backed by Node's `process.platform`, `existsSync`, and `spawn`.

## Files changed

- `src/main/editors/editor-service.ts` — editor catalog, injected service factory, platform launch mapping, validation, and production wrappers.
- `src/main/editors/editor-service.test.ts` — focused macOS detection/launch test, unref assertion, invalid-ID and missing-worktree rejection tests, and Linux command-mapping test.

## Test evidence

### RED

`npm test -- src/main/editors/editor-service.test.ts` exited 1 before implementation. Vitest reported `Cannot find module './editor-service'`, which is the expected missing-module failure.

### GREEN

`npm test -- src/main/editors/editor-service.test.ts` exited 0: 1 test file passed, 4 tests passed.

### Static check

`npm run typecheck` exited 0.

### Full suite limitation

The sandboxed `npm test` run exited 1 only because the pre-existing `opencode-utils.test.ts` local TCP-port test could not bind `127.0.0.1` (`listen EPERM: operation not permitted 127.0.0.1`). The new editor test file passed in that full run (6 of 7 total tests passed). An expanded-permission rerun was requested but interrupted before it returned, and the parent directed no further commands.

## Self-review

- The service keeps filesystem and process operations in the Electron main process.
- The public list result strips platform-specific implementation fields.
- Validation occurs before launching and never invokes `spawn` for a missing worktree.
- The exact required macOS catalog fields and launch arguments are retained.

## Concerns / follow-up

- No commit was created because the task was interrupted after the verification-permission request and the parent explicitly directed immediate finalization without further commands.
- The full test suite should be rerun in an environment that permits local TCP binding before integration.

## PATH discovery fix

### Root cause

On Windows and Linux, non-macOS editor detection passed bare launcher names such as `code` to `existsSync`. That API checks a filesystem path relative to the current working directory; it does not search the executable `PATH`, so installed editors were incorrectly hidden.

### Change

- Added an asynchronous injectable `commandExists(command)` dependency to `EditorServiceDependencies`.
- Production discovery now uses `execFile('which', [command])` on Linux and `execFile('where.exe', [command])` on Windows, resolving `true` only when lookup succeeds.
- `listAvailableEditors` now awaits platform detection while preserving catalog order.
- macOS bundle detection and worktree path validation continue to use `existsSync`.
- Updated the Linux regression test and added a Windows regression test. Each keeps the filesystem predicate false for executable names and provides only the relevant resolver result, proving discovery comes from command resolution rather than a bare-path file check.

### Fix verification

1. `npm test -- src/main/editors/editor-service.test.ts` (RED) — exited 1 with Linux and Windows discovery tests returning no editors, reproducing the bare-command `existsSync` defect.
2. `npm run typecheck` — exited 0.
3. `npm test -- src/main/editors/editor-service.test.ts` (GREEN) — exited 0; 1 file and 5 tests passed.

The parent directed that no full-suite run or commit be attempted for this fix because those may require sandbox escalation.
