# Open worktree in editor

## Goal

Allow a coding-agent session to open its worktree in a locally installed editor from a compact dropdown in the session header.

## Scope

The supported editors are Visual Studio Code, Cursor, Zed, WebStorm, IntelliJ IDEA, Sublime Text, and Android Studio. The list contains only editors detected as installed on the current machine.

## Design

`CodingAgentSession` loads the available editor descriptors after its session snapshot is available. Its header contains an `Open in editor` dropdown button. Choosing an entry asks the backend to open the session worktree in that editor. The control is hidden when no supported editor is available.

The renderer does not inspect the filesystem or spawn applications. It uses a typed `window.api` interface only.

The main process owns editor detection and process launching. A small editor-launching service defines the fixed supported-editor catalog, resolves installed applications for the host platform, and opens the validated worktree path with the selected app. IPC handlers validate the editor identifier and worktree path before calling that service. The catalog and request/response DTOs live in shared IPC contracts.

## Error handling

If an editor disappears after detection or launching fails, the IPC call rejects with the original error context preserved in backend logs. The session UI shows a concise user-facing failure message without interrupting the chat session.

## Testing and verification

Add focused tests for the catalog/detection or launch command construction where the project test setup supports them. Run TypeScript type checking and the frontend build after the renderer and IPC changes.
