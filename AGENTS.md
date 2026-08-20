# Agent Instructions

## Project Context

* Treat this as an Electron application for managing Git worktrees, GitHub Pull Requests and AI agent execution.
* Use the Electron renderer process exclusively for the user interface.
* Use the Electron main process as the local backend responsible for business logic, Git operations, GitHub integration, and database access.
* Keep shared contracts and IPC types centralized to avoid duplicating models across processes.

## Tooling

* Use `npm` for project commands.
* Run the project's type checking before completing TypeScript changes.
* Run the frontend build after modifying renderer components, routing, or styling.
* Regenerate database artifacts whenever schema definitions change.

## Build & Development Commands

Use the following commands through `npm`. Prefer the narrowest command that verifies the affected area.

### Dependencies and native modules

* `npm ci` - install the exact dependency versions from `package-lock.json`. Prefer this after cloning the repository or in clean/CI environments.
* `npm install` - install or update dependencies from `package.json` and `package-lock.json`. Use when intentionally changing dependencies or regenerating the lockfile.
* `npm run rebuild` - rebuild Electron native modules, currently `better-sqlite3` and `node-pty`, for the installed Electron version. Use after installing dependencies, changing Electron versions, or changing native dependencies.

### Development

* `npm start` - start the Electron application in development mode through Electron Forge. This also runs `npm run rebuild` first via the `prestart` lifecycle script. Use when manually testing the complete desktop application.

### Verification

* `npm run typecheck` - run TypeScript type checking without emitting files. Use after every TypeScript change and before completing the task.
* `npm run lint` - run ESLint over the TypeScript and TSX source files. Use after code changes, especially when adding or modifying imports, React components, or services.
* `npm test` - run the Vitest test suite once. Use after behavioral changes and before completing the task.
* `npm test -- path/to/file.test.ts` - run a focused Vitest test file. Prefer this first when iterating on a specific behavior.

### Database

* `npm run db:generate` - generate Drizzle migration artifacts from the current schema. Use after changing database schema definitions.
* `npm run db:migrate` - apply pending Drizzle migrations to the configured database. Use only when the local database must be brought up to date for development or verification.
* Never manually edit generated migration artifacts unless repairing a known generation issue.

### Packaging and distribution

* `npm run package` - package the Electron application without creating platform installers. Use to verify that the application can be assembled after main-process, preload, renderer, or build-configuration changes.
* `npm run make` - create platform-specific distributable artifacts using Electron Forge makers. Use when explicitly validating or preparing an installable build.
* `npm run publish` - publish a packaged release through the configured Electron Forge publisher. Use only when explicitly requested and after confirming the target repository, credentials, version, and release configuration.

Do not use `npm run make` or `npm run publish` as routine verification. Do not start multiple development instances unless required by the task, and do not terminate processes by broad name or path patterns.

## Renderer Rules

* Keep the renderer focused on rendering UI and handling user interactions.
* Do not perform Git operations, filesystem access, database access, or GitHub API calls directly from the renderer.
* Communicate with the main process exclusively through well-defined IPC interfaces.
* Keep presentation logic separate from business logic.
* Split components by responsibility; avoid long files that mix many unrelated concerns.
* Reuse existing UI components before introducing new ones.
* Keep the interface dense and operational; avoid decorative redesigns unless explicitly requested.

## Electron Security

* Keep `contextIsolation` enabled and `nodeIntegration` disabled in the renderer.
* Expose only narrow, typed APIs from the preload script.
* Never expose `ipcRenderer`, filesystem primitives, environment variables, tokens, or private keys directly to the renderer.
* Validate every IPC payload in the main process, even when the caller is the local renderer.
* Prefer one IPC channel per user capability over generic arbitrary command channels.

## IPC Contracts

* Define shared IPC request, response, and error types in one central location.
* Centralize IPC channel names; do not duplicate string literals across main, preload, and renderer code.
* Keep IPC handlers thin and delegate business logic to dedicated main-process services.
* Return structured success and error results across IPC boundaries.
* Do not pass database entities or implementation-specific objects directly to the renderer.
* Any new IPC channel must include a shared contract, preload API, main-process handler, renderer usage, and focused tests.

## Main Process Rules

* Treat the Electron main process as the application's backend.
* Keep Git operations, GitHub integration, AI agent orchestration, filesystem access, and database operations inside the main process.
* Keep IPC handlers thin; delegate business logic to dedicated services.
* Keep environment configuration centralized; do not read environment variables throughout the codebase.
* Validate all renderer input before executing backend operations.

## Database Rules

* Keep database schema definitions centralized.
* Do not manually modify generated migration artifacts unless repairing a known generation issue.
* Encapsulate database access behind dedicated services or repositories.
* Avoid exposing database implementation details outside the backend layer.

## UI Design

* Design the UI around user workflows, not around backend implementation.
* User-facing features must originate from explicit product requirements.
* Never infer new UI from backend entities, database tables, services, APIs, IPC handlers, workflows, queues, execution models, or other implementation details.
* The existence of a backend model is never sufficient justification for creating pages, navigation entries, tables, cards, dashboards, or management screens.
* Backend and database implementations must remain implementation details unless the user explicitly requests them to be exposed.
* Keep internal orchestration invisible whenever it does not provide direct value to the user.
* When implementing an MVP, build only the functionality explicitly requested.
* Prefer the smallest user-facing implementation that satisfies the requirement.
* Do not introduce dashboards, statistics, administration pages, or management views unless they are explicitly part of the requested scope.

## UI Quality

* Preserve existing interaction patterns, visual density, and component conventions.
* Do not add screens, navigation entries, or dashboards without an explicit product requirement.
* Keep renderer state local unless it must be shared across components or routes.
* Avoid unnecessary polling, timers, global listeners, and continuous animations.
* Support keyboard navigation, visible focus states, accessible labels, and appropriate semantic elements.
* Handle loading, empty, success, and error states for user-facing operations.

## Git and Worktree Safety

* Never run `git reset --hard`, `git clean`, branch deletion, force-push, or worktree removal unless explicitly requested.
* Before mutating a repository, resolve and verify the exact repository and worktree path.
* Preserve uncommitted user changes and do not assume the current working directory is the target repository.
* Use repository-scoped Git commands and report the affected path when performing mutations.
* Never kill processes by name, path, or broad pattern. Only stop a process whose PID was explicitly captured or whose ownership was verified from the target repository and port.
* Never expose GitHub tokens or credentials in logs, IPC responses, error messages, or UI state.

## Agent Processes

* Spawn and manage provider or agent processes only from the main process.
* Track child-process ownership and clean up owned processes on cancellation and application exit.
* Preserve relevant stdout and stderr context in structured backend logs without exposing secrets.
* Surface cancellation, timeout, startup failure, and exit states to the renderer.
* Do not block the Electron main process with synchronous long-running work.

## Security

* Never commit `.env`, GitHub private keys, local workspace clones, logs, database files, build artifacts, or generated coverage.
* Preserve `.env.example` as the only committed environment template.
* Read secrets exclusively from environment variables.
* Never expose secrets, tokens, or private keys to the renderer process.
* Do not execute destructive Git or filesystem operations unless explicitly requested.

## Error Handling

* Never silently ignore errors.
* Return meaningful, structured errors across IPC boundaries.
* Preserve original error context in backend logs while redacting secrets and sensitive paths where appropriate.
* Show user-friendly messages in the renderer without exposing internal implementation details.

## Change Discipline

* Preserve strict TypeScript settings.
* Avoid `any` unless interacting with genuinely untyped external boundaries.
* Keep changes scoped to the affected feature.
* Prefer extending existing services over introducing new abstractions.
* Create new services, entities, IPC channels, or UI flows only when the existing architecture cannot reasonably accommodate the requested feature.

## Definition of Done

* Keep changes scoped to the requested feature.
* Add or update focused tests for changed backend behavior, IPC contracts, and important user interactions.
* Run the relevant checks before reporting completion.
* Before completing a task, describe every modified file, the purpose of each change, the checks that were run, and any remaining risks.

## Commit Messages

* Write every commit message in English.
* Explain in detail the changes made for each modified file, describing what changed and why and use Markdown formatting for doing it.

## Critical Prohibitions

* Do not commit `.env`, GitHub private keys, local workspace clones, logs, database files, build artifacts, or generated coverage.
* Do not read environment variables throughout the codebase; keep environment configuration centralized.
* Do not manually modify generated migration artifacts, except when repairing a known generation issue.
* Do not use `any` unless interacting with a genuinely untyped external boundary.
* Do not use package managers other than `npm` for project commands.
* Do not write commit messages in languages other than English.
* Do not spawn subagents until I ask you to do so.
* Do not use the `superpowers` skill until I ask you to do so.
* Do not use Ralph Loop until I ask you to do so.
