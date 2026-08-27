# Capability SDK and Web Search Vertical Slice Design

**Date:** 2026-08-27  
**Status:** Approved design, pending implementation plan  
**Scope:** Project A — local Capability SDK, curated catalog, Brave Web Search port, cross-agent MCP runtime, Capability Library, and chat activation

## 1. Context

Agentic Worktrees currently manages Codex and OpenCode sessions through provider-specific adapters. The proposed Capability System turns each chat into an extensible workspace whose coding agent can acquire task-specific skills and tools.

The product-facing abstraction is a **Capability**: something the user wants the coding agent to be able to do. Provider-specific implementations, MCP servers, ports of Pi extensions, and native runtime details remain infrastructure.

The initial specifications describe a broader ecosystem that includes skills, executable extensions, packs, recommendations, multiple scopes, a public marketplace, publisher verification, and AI-assisted porting. This design deliberately narrows the first implementation to a vertical slice that proves the central technical claim:

> The same capability, compiled against a provider-neutral Agentic Worktrees SDK, can be activated on an existing Codex or OpenCode chat and invoked through MCP.

The pilot capability is **Web Search**, manually ported from the reusable parts and behavior of `pi-web-access` 0.25.0 to Brave Search.

## 2. Decisions

The approved decisions are:

- Build a vertical slice before a broad SDK or a batch of ports.
- Use a manual port, not a runtime shim for Pi APIs.
- Treat Pi as a source of ideas, reusable logic, provenance, and licenses—not as a supported runtime.
- Use Brave Search as the pilot backend.
- Package the SDK locally in this repository, with an API designed for later npm publication.
- Support only tool-based MCP capabilities in SDK v0.1.
- Allow activation after an agent has already completed turns.
- Make a newly activated capability available from the next turn, never during an in-flight turn.
- Use provider-specific activation adapters behind a common Capability Manager.
- Permit a coordinated, transparent OpenCode restart and session resume when MCP configuration changes.
- Store the Brave API key in an app-managed encrypted vault.
- Use a bundled, curated catalog in v0.1.
- Provide both a Capability Library and a selector in the chat composer.
- Run bundled capability code in a separate app-owned process.
- Verify behavior with deterministic automated tests and opt-in smoke tests against real Codex, OpenCode, and Brave.

## 3. Goals

### 3.1 Product goals

- Let a user discover Web Search in a Capability Library.
- Show compatibility, provenance, version, license, tools, and requested permissions.
- Configure a Brave API key without exposing it to the renderer or coding agent.
- Add or remove Web Search from an existing chat.
- Show active capabilities and activation events in the chat.
- Preserve chat history across OpenCode reloads.

### 3.2 Platform goals

- Establish a small, provider-neutral Capability SDK.
- Validate capability manifests and tool inputs at every boundary.
- Run capability tools through a dedicated MCP host process.
- Keep Codex and OpenCode differences inside activation adapters.
- Persist configuration and chat activation state without persisting secrets in SQLite.
- Produce a repeatable compatibility test harness for future ports.

### 3.3 Developer experience goals

- Make the pilot capability a separate consumer of the local SDK package.
- Document how to define, validate, run, test, and inspect a capability.
- Ensure the Web Search package contains no Codex-, OpenCode-, Electron-, or Pi-specific code.

## 4. Non-goals

SDK v0.1 does not include:

- commands;
- platform event subscriptions;
- capability-provided UI components;
- arbitrary third-party native plugins;
- automatic import or execution of Pi extensions;
- capability packs;
- task-based automatic recommendations;
- `Use once`, worktree, project, or global activation scopes;
- public marketplace submissions;
- ratings, downloads, or automatic updates;
- remote registry or publisher identity;
- AI-assisted portability analysis;
- a strong sandbox for hostile executable code.

The Brave credential may be reused globally, but capability activation is scoped only to a chat/session in v0.1.

## 5. Architecture

The implementation is divided into five independently testable units.

### 5.1 Capability SDK

`@agentic-worktrees/capability-sdk` is a local package with no dependency on Electron, Codex, OpenCode, or Pi. It defines:

- capability manifests;
- metadata and provenance;
- compatibility declarations;
- permissions;
- non-secret settings and secret references;
- tool definitions;
- execution context;
- structured errors and output limits.

The public schema format is JSON Schema exposed through typed SDK helpers. Runtime validation may use Zod internally, but capability authors are not required to couple their package to Zod or TypeBox.

### 5.2 Bundled catalog

The catalog contains reviewed manifests and entry points distributed with the app. It is the only source of executable capabilities in v0.1.

Each port records:

- source ecosystem;
- source package and version;
- source repository;
- source license;
- porting method;
- reusable portions;
- adapted or omitted portions.

For the pilot, the provenance identifies `pi-web-access` 0.25.0 and its MIT license. The catalog presents the user-facing capability as **Web Search** and the implementation as infrastructure.

### 5.3 Capability Manager

The Electron main-process Capability Manager:

- loads and validates the bundled catalog;
- exposes safe DTOs over typed IPC;
- validates renderer requests;
- persists installation, configuration, and activation state;
- manages permission consent;
- resolves opaque secret references through the vault;
- owns capability host lifecycle;
- delegates provider activation to Codex and OpenCode adapters;
- reconciles interrupted activation after crashes;
- emits safe UI events.

IPC handlers remain thin and delegate business logic to this manager and supporting repositories.

### 5.4 Capability Host

The Capability Host is an app-owned child process. It loads only bundled, reviewed capability packages and exposes their tools through MCP on loopback.

Each chat receives an isolated host identity and an ephemeral access token. The host:

- binds only to loopback;
- validates its configuration before serving;
- lists only tools active for its chat;
- requests declared secrets through a private main-process channel when executing a tool;
- applies timeouts, cancellation, output limits, and error normalization;
- redacts logs;
- shuts down when no longer owned by an active chat or when the app exits.

Process isolation limits crash impact. It is not presented as a security sandbox against malicious code.

### 5.5 Activation adapters

The common activation interface supports:

- attach capability host to a chat;
- refresh available tools;
- verify tool visibility;
- detach capability host;
- restore previous configuration after failure.

Provider behavior remains private:

- **Codex:** associate the thread with its chat-scoped MCP host and refresh MCP configuration. Codex applies the refresh on the thread's next active turn. Tool visibility is verified through app-server MCP status.
- **OpenCode:** generate app-owned MCP configuration and an agent profile whose tools match the chat's active capabilities. When this changes, wait for the shared OpenCode runtime to become idle, persist external session identifiers, restart the controlled process, verify health, resume affected sessions, and use the updated profile for subsequent prompts.

The OpenCode strategy is replaceable when a stable hot-reload API becomes available; capability packages and the SDK must not change.

## 6. SDK v0.1 Contract

A capability has one default export created with `defineCapability()`:

```ts
export default defineCapability({
  manifest: {
    id: "agentic-worktrees.web-search",
    name: "Web Search",
    version: "0.1.0",
    sdkVersion: "^0.1.0",
    description: "Search the web using Brave Search.",
    category: "web-browser",
    author: { name: "Agentic Worktrees" },
    license: "MIT",
    compatibility: {
      codex: "supported",
      opencode: "supported",
    },
    provenance: {
      kind: "manual-port",
      source: "pi-extension",
      package: "pi-web-access",
      sourceVersion: "0.25.0",
      repository: "https://github.com/nicobailon/pi-web-access",
    },
    permissions: {
      network: ["api.search.brave.com"],
      secrets: ["brave-api-key"],
    },
    settings: {
      braveApiKey: { type: "secret", required: true },
      resultLimit: {
        type: "integer",
        default: 5,
        min: 1,
        max: 20,
      },
    },
  },
  tools: [
    defineTool({
      name: "web_search",
      description: "Search the web and return attributed results.",
      input: SearchInputSchema,
      async execute(input, context) {
        const apiKey = await context.secrets.get("braveApiKey");
        return searchBrave(input, apiKey, context.signal);
      },
    }),
  ],
});
```

### 6.1 Stability rules

- Capability IDs and tool names are stable identifiers.
- Manifest and tool schemas are validated during build and load.
- `sdkVersion` declares the compatible SDK range.
- Compatibility means verified compatibility, not expected compatibility.
- A permission change alters a deterministic permission digest and invalidates prior consent.
- Secret fields contain opaque references only.

### 6.2 Execution context

The v0.1 context exposes only:

- `AbortSignal`;
- redacted structured logging;
- validated non-secret settings;
- access to secrets declared by the capability;
- bounded progress reporting if supported by MCP transport.

It does not expose Electron, database objects, renderer APIs, arbitrary process execution, or platform filesystem helpers.

### 6.3 Tool results

Tool results use MCP-compatible content and optional bounded JSON details. The host enforces:

- 50 KB maximum output;
- 2,000-line maximum output;
- capability and tool timeouts;
- cancellation;
- schema validation;
- stable error codes.

## 7. Web Search Pilot

The first port includes only the smallest representative subset of `pi-web-access`:

- one `web_search` tool;
- Brave Search as the only provider;
- query, result count, and optional recency inputs supported by Brave;
- attributed result title, URL, and description;
- cancellation and timeout handling;
- normalized rate-limit and upstream errors;
- output truncation.

It excludes:

- provider routing and fallback;
- page fetching;
- browser curator UI;
- asynchronous background content fetching;
- Pi session entries and custom messages;
- Pi widgets, commands, provider registry, and model-assisted summaries;
- authentication profiles other than the app vault.

This subset validates the SDK's metadata, permissions, settings, secrets, network access, tool schemas, MCP exposure, cancellation, and cross-agent behavior without prematurely porting the full suite.

## 8. State and Persistence

The catalog remains a bundled artifact. User state is persisted separately.

### 8.1 Capability installations

Stores:

- capability ID and configured version;
- configuration status;
- accepted permission digest;
- timestamps;
- last safe error code where useful.

### 8.2 Capability settings

Stores validated, non-sensitive values only. Secret settings store opaque vault references, never plaintext.

### 8.3 Session capabilities

Stores:

- internal run ID;
- capability ID and version;
- activation state;
- activation error code;
- activation and update timestamps.

Supported activation states are:

- `pending_activation`;
- `reloading`;
- `active`;
- `pending_deactivation`;
- `activation_failed`;
- `inactive`.

### 8.4 Credential vault

The existing Electron `safeStorage` pattern is generalized behind a capability credential repository. The vault:

- encrypts persisted secret payloads;
- assigns opaque IDs;
- never returns secret values to the renderer;
- removes corrupt temporary or persisted payloads safely;
- redacts sensitive values from errors and logs;
- reports only presence and validity state to UI callers.

Database schema changes require generated Drizzle migration artifacts.

## 9. Activation Flows

### 9.1 Configure from the Library

1. Renderer requests a capability detail DTO.
2. Main process validates the capability against the bundled catalog.
3. UI displays publisher, provenance, license, compatibility, permissions, and requested secret.
4. User accepts permissions and enters the Brave API key.
5. Main process stores the key in the encrypted vault and non-secret settings in the database.
6. Manager optionally tests the Brave credential through a bounded request.
7. Capability becomes `Ready`.

The key is never returned after submission; the renderer receives only configuration state.

### 9.2 Activate before the first turn

1. User opens a chat and chooses Web Search before sending a prompt.
2. Manager creates or updates the chat-scoped Capability Host.
3. Activation adapter attaches MCP configuration to the agent session/runtime.
4. Manager verifies tool visibility.
5. `session_capabilities` becomes `active`.
6. The first agent turn receives `web_search`.

### 9.3 Activate after completed turns

1. User selects Web Search in an existing chat.
2. Manager validates compatibility and configuration.
3. State becomes `pending_activation`.
4. Manager starts or updates the chat-scoped host.
5. Provider adapter applies the update.
6. State becomes `active` only after the provider reports `web_search` as available.
7. Chat timeline records `Web Search activated`.
8. The tool is available on the next turn.

An in-flight turn is never mutated.

### 9.4 OpenCode coordinated reload

Because the current OpenCode runtime is shared:

1. Mark affected activation as `reloading`.
2. Wait until all turns owned by that OpenCode process are idle.
3. Snapshot external session identifiers and generated configuration.
4. Stop only the app-owned OpenCode process.
5. Start it with the new MCP and agent-profile configuration.
6. Verify health.
7. Resume all affected persisted sessions.
8. Verify the updated profile and tool visibility.
9. Mark activation `active`.

New prompts are temporarily disabled while reload is in progress. Existing history remains visible.

### 9.5 Deactivation

Deactivation follows the same provider lifecycle and takes effect on the next turn. When no capability remains active for a chat, its capability host and token are revoked.

## 10. Failure Handling and Recovery

Failures use stable codes:

- `invalid_input`;
- `missing_secret`;
- `permission_denied`;
- `rate_limited`;
- `upstream_unavailable`;
- `cancelled`;
- `activation_failed`;
- `agent_reload_failed`;
- `internal_error`.

On activation or reload failure:

- preserve agent session records and history;
- restore the previous generated configuration;
- stop newly created unowned host processes;
- revoke unused tokens;
- set `activation_failed` with a redacted error;
- offer retry from the UI.

At app startup, the manager reconciles `pending_activation`, `reloading`, and `pending_deactivation` records. Reconciliation is idempotent.

## 11. Security Model

### 11.1 Enforced boundaries

- Renderer communicates only through typed, validated IPC.
- The renderer receives no API keys, host endpoints, MCP tokens, environment values, database entities, or process handles.
- Capability endpoints bind only to loopback.
- Access tokens are random, ephemeral, scoped, and revocable.
- The main process owns all child processes and cleans them up on cancellation and exit.
- Capability secrets are resolved only for declared settings and tools.
- Logs omit secret values, query text, and result content by default.
- Tool inputs and outputs are validated and bounded.

### 11.2 Explicit limitation

A child process running reviewed Node.js code is not a hostile-code sandbox. SDK API restrictions and process isolation do not prevent arbitrary Node.js code from attempting filesystem or network access. Therefore v0.1 supports only bundled capabilities reviewed and distributed with Agentic Worktrees.

Third-party native capabilities require a later sandbox and supply-chain design.

## 12. User Experience

### 12.1 Capability Library

Add a dedicated `Capabilities` route with:

- search by name, description, and goal;
- category, compatibility, and state filters;
- a dense capability list;
- a detail panel;
- status: `Available`, `Needs setup`, `Ready`, or `Unavailable`;
- actions: `Configure` and `Add to chat` when opened from chat context.

The detail view shows:

- description and provided tools;
- Codex/OpenCode compatibility;
- publisher;
- Pi source provenance;
- version and license;
- requested permissions;
- review status.

Because code is bundled, v0.1 uses **Configure** and **Add to chat**, not **Install**.

### 12.2 Chat selector

Add a keyboard-accessible Capability control near the existing composer controls. Its picker groups:

- active capabilities;
- compatible and ready capabilities;
- capabilities requiring setup;
- incompatible capabilities.

It includes search, status feedback, and a link to the full Library.

### 12.3 Active state

The chat shows:

- capability count in the header;
- compact active capability chips;
- activation and deactivation timeline events;
- an explicit `Applying capability…` state during reload;
- retryable, user-safe failure messages.

The UI must handle loading, empty, incompatible, setup-required, active, reloading, and error states, with visible focus and accessible labels.

## 13. Testing Strategy

### 13.1 Automated tests

1. **SDK:** manifest rules, compatibility, permission digest, settings, secret references, schema compatibility, and output bounds.
2. **Brave port:** fake HTTP success, invalid inputs, rate limiting, upstream failures, timeout, cancellation, and truncation.
3. **Vault:** encryption availability, save/load/remove, corruption, temporary file cleanup, and redaction.
4. **Capability Host:** authenticated handshake, tool listing, invocation, cancellation, invalid token, and shutdown.
5. **Capability Manager:** state transitions, idempotency, permission changes, rollback, host ownership, and crash recovery.
6. **Codex adapter:** late attachment, MCP refresh, next-turn visibility, status verification, and rollback using a fake app-server.
7. **OpenCode adapter:** idle coordination, restart, health failure, multi-session resume, profile selection, and rollback using a fake server/process.
8. **IPC and preload:** schema rejection, narrow API exposure, and proof that secret values never cross to the renderer.
9. **Renderer:** Library search and states, setup dialog, chat selector, active indicators, reload state, deactivation, and failures.

### 13.2 Opt-in real smoke tests

The smoke harness requires installed, authenticated Codex and OpenCode CLIs plus a Brave API key supplied outside source control.

Scenarios:

- Start and use a Codex chat, activate Web Search, then invoke it successfully on the next turn.
- Start and use an OpenCode chat, activate Web Search, observe a transparent reload, preserve history, and invoke the tool on the next turn.
- Deactivate Web Search and verify it is no longer available.
- Verify the same vault credential supports both agents.
- Inspect logs and renderer DTOs to confirm the key is absent.

Real smoke tests are opt-in and are not required in default CI. Deterministic protocol and network fakes remain mandatory in CI.

## 14. Acceptance Criteria

The vertical slice is complete only when:

- Web Search is a separate package that depends on the Capability SDK and contains no provider-specific integration code.
- The same built capability is exposed through MCP to real Codex and OpenCode installations.
- It can be activated after both agents have already completed a turn.
- Codex sees the tool on the next turn without losing history.
- OpenCode restarts transparently, resumes the same session history, and sees the tool on the next turn.
- Permission and provenance information is visible before configuration.
- The Brave key is encrypted at rest and absent from renderer state and logs.
- Capability crashes do not crash Electron.
- Failed activation rolls back to a usable agent session.
- Library, chat selector, active state, and error states are covered by interaction tests.
- Type checking, linting, tests, and the renderer build pass.
- A developer guide explains how to create and verify a second tool-based capability.

## 15. Delivery Roadmap

### Project A — SDK and Web Search vertical slice

This document defines Project A. Its implementation phases are:

1. local SDK and manifest validation;
2. bundled catalog and provenance;
3. capability host and MCP protocol;
4. generalized vault and Brave port;
5. database persistence and Capability Manager;
6. Codex activation;
7. OpenCode coordinated reload;
8. Capability Library and chat selector;
9. hardening, automated tests, smoke harness, and author guide.

A detailed implementation plan will define exact files, migrations, tests, and checkpoints.

### Project B — Porting kit

After Project A:

- capability template;
- local validate/dev/test/pack commands;
- Codex/OpenCode compatibility harness;
- provenance and license checklist;
- manual Portability Report format;
- examples for tools, settings, secrets, and cancellation.

An AI analyzer is deferred until three to five manual ports establish reliable patterns.

### Project C — Initial curated ecosystem

Candidates are assessed before porting:

- **Tier A — Tool-centric:** reusable logic, strong MCP fit.
- **Tier B — Mixed:** reusable tools with UI or lifecycle rebuilt in Agentic Worktrees.
- **Tier C — Agent-specific:** provider, compaction, usage, or session lifecycle requiring an agent adapter.
- **Tier D — Ineligible or duplicate:** TUI-dependent or lacking direct user value.

Suggested order:

1. Web Search;
2. URL/content fetch;
3. browser automation;
4. documentation search;
5. GitHub operations;
6. database inspection;
7. test runner;
8. dependency audit;
9. security scan;
10. structured user questions;
11. memory/context retrieval;
12. code review;
13. subagents;
14. usage monitoring;
15. session recap;
16. TDD skill;
17. systematic debugging skill;
18. accessibility skill;
19. React review skill;
20. PR-ready workflow skill or pack.

Skills that already follow the Agent Skills standard remain skills. Mature MCP servers remain MCP integrations. Only manually adapted executable logic becomes a Capability SDK package.

### Project D — Public marketplace

A later, separate design covers:

- signed remote registry;
- package resolution and lockfiles;
- publisher identity and verification;
- review, revocation, and update policy;
- stronger sandboxing;
- submissions;
- portability analysis;
- AI-assisted porting.

## 16. Risks and Mitigations

### OpenCode reload affects shared sessions

Mitigation: wait for all owned sessions to be idle, disable new prompts during the short reload, persist identifiers, health-check before resume, and roll back on failure.

### CLI APIs evolve rapidly

Mitigation: declare minimum tested versions, keep activation logic behind adapters, maintain fake protocol contract tests, and run opt-in real smoke tests before releases.

### Permissions may be misunderstood as a sandbox

Mitigation: label bundled review and process isolation accurately; do not admit third-party executable capabilities until a separate sandbox design is approved.

### Porting the complete Pi extension would overfit the SDK

Mitigation: port only the Brave tool subset and record omitted Pi-specific APIs in provenance notes.

### Scope expansion into a full marketplace

Mitigation: bundled-only catalog, session-only activation, one capability, one provider, and tool-only SDK in Project A.

## 17. Required Specification Corrections

The source capability documents should later be consolidated to remove two inconsistencies:

- the Capability System document links to a non-existent `Capability Ecosystem e SDK` filename rather than the current Platform & SDK document;
- the original potential MVP places the public SDK in a later phase, while this approved roadmap requires a local SDK as the first vertical-slice prerequisite.

These corrections should preserve the long-term vision while making the implementation order explicit.
