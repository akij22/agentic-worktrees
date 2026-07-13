# Final review fixes

## Changes

- Replaced renderer-provided worktree paths with `worktreeId` in the editor IPC contract and session UI.
- Resolve editor launch paths from the persisted worktree record, canonicalize them, and require a directory before launch.
- Re-check editor availability when launching, support both system and user macOS Applications directories, and surface spawn or non-zero process failures.
- Direct GUI editor launches attach `error` and `spawn` listeners before detaching, reject on an asynchronous spawn error, and resolve on `spawn` without waiting for the editor process to close. macOS `open` retains short-lived exit-status validation.
- Added focused schema and editor-service coverage for ID-only IPC input, macOS user Applications discovery, unavailable editors, spawn failure, and non-zero exits.
- Show a concise inline message when editor discovery fails. Discovery and launch errors remain distinct, so a later successful discovery only clears its own error.

## Verification

- `npm run typecheck` — passed
- `npm test -- src/main/editors/editor-service.test.ts src/shared/ipc/schemas.test.ts` — passed (13 tests)
- `npm test -- src/main/editors/editor-service.test.ts` — passed (11 tests), including direct-launch spawn and asynchronous-error behavior

No full suite, package build, or commit was run.
