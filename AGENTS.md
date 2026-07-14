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

## Renderer Rules

* Keep the renderer focused on rendering UI and handling user interactions.
* Do not perform Git operations, filesystem access, database access, or GitHub API calls directly from the renderer.
* Communicate with the main process exclusively through well-defined IPC interfaces.
* Keep presentation logic separate from business logic.
* Split components by responsibility; avoid long files that mix many unrelated concerns.
* Reuse existing UI components before introducing new ones.
* Keep the interface dense and operational; avoid decorative redesigns unless explicitly requested.

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

## Security

* Never commit `.env`, GitHub private keys, local workspace clones, logs, database files, build artifacts, or generated coverage.
* Preserve `.env.example` as the only committed environment template.
* Read secrets exclusively from environment variables.
* Never expose secrets, tokens, or private keys to the renderer process.
* Do not execute destructive Git or filesystem operations unless explicitly requested.

## Error Handling

- Never silently ignore errors.
- Return meaningful errors across IPC boundaries.
- Preserve original error context in backend logs.
- Show user-friendly messages in the renderer.

## Change Discipline

* Preserve strict TypeScript settings.
* Avoid `any` unless interacting with genuinely untyped external boundaries.
* Keep changes scoped to the affected feature.
* Prefer extending existing services over introducing new abstractions.
* Create new services, entities, IPC channels, or UI flows only when the existing architecture cannot reasonably accommodate the requested feature.
* Before completing a task, describe every modified file and summarize the purpose of each change.

## Commit Messages

* Write every commit message in English.
* Explain in detail the changes made for each modified file, describing what changed and why and use Markdown formatting for doing it.

## DO NOT

* Do not use the renderer process for business logic, Git operations, filesystem access, database access, or GitHub API calls.
* Do not read environment variables throughout the codebase; keep environment configuration centralized.
* Do not create new services, entities, IPC channels, or UI flows when the existing architecture can reasonably accommodate the feature.
* Do not manually modify generated migration artifacts, except when repairing a known generation issue.
* Do not infer new UI from backend entities, database tables, services, APIs, IPC handlers, workflows, queues, execution models, or other implementation details.
* Do not introduce dashboards, statistics, administration pages, or management views unless they are explicitly part of the requested scope.
* Do not commit `.env`, GitHub private keys, local workspace clones, logs, database files, build artifacts, or generated coverage.
* Do not expose secrets, tokens, or private keys to the renderer process.
* Do not execute destructive Git or filesystem operations unless explicitly requested.
* Do not silently ignore errors.
* Do not use `any` unless interacting with genuinely untyped external boundaries.
* Do not write commit messages in languages other than English.
* Do not use package managers other than `npm` for project commands.
* Do not spawn subagents until I ask you to do so.
* Do not use 'superpowers' skill until I ask you to do so.
