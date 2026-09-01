# Agent Skills Runtime Design

**Date:** 2026-09-01  
**Status:** Approved design  
**Branch:** `feat/skills-runtime`  
**Base:** `feat/capabilities` at `c90350f`

## 1. Summary

Agentic Worktrees will support portable Agent Skills as a first-class marketplace item distinct from executable capabilities.

Installed skills are discoverable by Codex and OpenCode through each provider's native skill runtime. A coding agent may load a skill automatically when its metadata is relevant to the current task. A user may force one skill for a turn with `/skill:<id>`, selected through an autocomplete widget and represented internally as a structured invocation rather than command text.

The implementation follows progressive disclosure:

1. every installed skill exposes only its ID, name, and description to supported coding agents;
2. full `SKILL.md` content is loaded only when the provider invokes the skill;
3. referenced text files are loaded only when the skill workflow requires them;
4. skills are not continuously injected into every prompt.

The first runtime accepts instructions and textual references only. Executable scripts, remote marketplace distribution, advanced scopes, packs, recommendations, and chat-to-skill generation are separate projects.

## 2. Product terminology

The UI must not use **Capability** as an umbrella label for both systems.

The shared user-facing surface is the **Marketplace**, which contains two visibly different item kinds:

- **Capability** — an executable tool or integration, currently delivered through the Capability SDK and MCP host.
- **Skill** — a portable workflow or set of instructions following the Agent Skills format.

Marketplace cards, filters, detail pages, installation behavior, trust information, and status labels must preserve this distinction.

## 3. Current implementation

The existing implementation is a complete vertical slice for executable capabilities but has no skill runtime.

### 3.1 Capability SDK

`packages/capability-sdk/src/types.ts` defines:

- `CapabilityManifest`;
- compatibility for Codex and OpenCode;
- settings and secrets;
- network and secret permissions;
- executable tools and their execution context.

`CapabilityDefinition` always contains `tools`. The contract has no instruction, skill, or content-discovery primitive.

### 3.2 Reviewed catalog and executable registry

`src/main/capabilities/catalog.ts` exposes immutable reviewed metadata and tool names.

`src/main/capabilities/host-registry.ts` separately exposes executable definitions to the utility process. This separation prevents executable definitions from crossing into the renderer.

### 3.3 Installation and activation

`src/main/capabilities/capability-service.ts` manages:

- installation/configuration state;
- permission digests;
- settings and encrypted secret references;
- compatibility checks;
- per-session activation and deactivation;
- rollback when host or coding-agent reconfiguration fails.

`src/main/capabilities/capability-repository.ts` persists capability installations, settings, and per-session state.

### 3.4 Runtime delivery

`src/main/capabilities/capability-host-manager.ts` starts one authenticated loopback MCP utility host per run.

`src/main/capabilities/capability-host-server.ts` validates tool input, enforces declared secret access, bounds execution time and output, and exposes only active tools.

`CodingAgentCapabilityConnection` in `src/main/coding-agents/types.ts` represents an MCP server connection. Codex and OpenCode adapters reconfigure their MCP profiles when the active capability set changes.

### 3.5 Renderer and IPC

Shared Zod schemas, preload APIs, IPC handlers, the Capability Library, and the chat picker all assume executable capabilities with permissions, settings, and provided tools.

### 3.6 Gap

The product documents describe skills, but the codebase currently has no:

- Agent Skills parser or validator;
- managed skill storage;
- skill installation records;
- provider skill adapter;
- structured skill invocation;
- skill IPC contract;
- marketplace skill DTO;
- `/skill:` composer experience.

## 4. Goals

### 4.1 Runtime goals

- Support portable directory-based Agent Skills with `SKILL.md`.
- Make every installed, compatible skill discoverable to Codex and OpenCode.
- Let each coding agent load a relevant skill automatically.
- Let a user force exactly one skill for a turn with `/skill:<id>`.
- Use provider-native discovery and invocation instead of prompt injection or MCP emulation.
- Keep full skill bodies out of context until invocation.
- Allow skills and executable MCP capabilities to coexist in one session and turn.

### 4.2 Product goals

- Present Skills and Capabilities in one Marketplace with distinct badges and detail views.
- Provide searchable, keyboard-accessible `/skill:` autocomplete.
- Represent an explicit invocation as a chip and structured IPC payload.
- Show origin, version, license, compatibility, digest, and instruction preview before installation.
- Surface invocation or loading activity when the provider protocol makes it observable.

### 4.3 Security goals

- Keep all filesystem access in the Electron main process.
- Never let the renderer choose arbitrary installation or invocation paths.
- Materialize only validated textual content in the managed skill root.
- Reject path traversal, symlinks, binaries, scripts, malformed metadata, and duplicate IDs.
- Never silently degrade a failed explicit invocation into an ordinary prompt.

## 5. Non-goals

The first Skills Runtime does not include:

- executable helper scripts;
- arbitrary assets or binary files;
- capability packs;
- session, worktree, project, or global scope selection;
- remote marketplace downloads;
- signatures, publisher verification, revocation, or automatic updates;
- contextual recommendation performed by Agentic Worktrees;
- “Save workflow as Skill”;
- automatic skill generation;
- ratings or usage analytics;
- a provider-independent fallback based on prompt injection;
- representing skills as MCP tools.

All installed skills are globally available to Agentic Worktrees sessions in this first runtime. A later scope resolver will narrow availability without changing provider adapter contracts.

## 6. Architecture

### 6.1 Service boundaries

Skills remain separate from executable capability implementation:

```text
Marketplace
├── Executable Capability
│   └── existing CapabilityService + MCP host
└── Skill
    ├── SkillCatalog
    ├── SkillInstaller
    ├── SkillRepository
    ├── SkillService
    └── CodingAgentSkillAdapter
```

The Marketplace aggregates summaries for display only. It must not merge the security or activation lifecycle of the two item kinds.

### 6.2 Proposed modules

```text
src/main/skills/
  skill-catalog.ts
  skill-installer.ts
  skill-repository.ts
  skill-service.ts
  skill-validation.ts

src/main/coding-agents/
  codex-skill-adapter.ts
  opencode-skill-adapter.ts

src/shared/skills/
  contracts.ts
  schemas.ts

src/renderer/features/skills/
  SkillCommandMenu.tsx
  SkillInvocationChip.tsx

src/renderer/features/marketplace/
  MarketplaceRegistry.tsx
```

Exact filenames may be adjusted to existing component conventions during planning, but the boundaries must remain explicit.

### 6.3 Why skills do not extend `CapabilityDefinition`

Adding optional `instructions`, optional `tools`, and multiple lifecycle variants to `CapabilityDefinition` would make the SDK ambiguous and would couple low-risk instruction packages to the executable capability host.

Agent Skills already have a portable standard. They should remain valid outside Agentic Worktrees. Application-specific installation metadata belongs in the application database, not in a proprietary required extension to `SKILL.md`.

## 7. Skill format and validation

### 7.1 Portable content

A skill uses the directory form:

```text
security-review/
├── SKILL.md
└── references/
    └── checklist.md
```

Required frontmatter:

```yaml
---
name: security-review
description: Reviews application changes for concrete security risks. Use for authentication, authorization, secrets, network boundaries, and untrusted input.
---
```

The runtime follows Agent Skills naming constraints:

- 1–64 characters;
- lowercase ASCII letters, digits, and single hyphens;
- no leading or trailing hyphen;
- no consecutive hyphens;
- directory name must equal the skill ID.

The description is required, bounded to 1,024 characters, and used for model-facing discovery.

### 7.2 Optional standard metadata

The parser may retain:

- `license`;
- `compatibility`;
- `metadata`;
- `allowed-tools`;
- `disable-model-invocation`.

For the first runtime:

- `allowed-tools` is informational and grants no permission;
- `disable-model-invocation: true` hides the skill from automatic model discovery but keeps it available in `/skill:` search;
- unknown fields are preserved for portability but do not change runtime behavior.

### 7.3 Managed content policy

The installer accepts only:

- `SKILL.md`;
- Markdown references;
- explicitly allowed text formats required by references.

It rejects:

- `scripts/` directories;
- executable files;
- binary files;
- symlinks and hard-link escapes;
- absolute paths;
- `..` traversal;
- files outside the staged root;
- oversized files or packages;
- malformed frontmatter;
- duplicate IDs;
- case-variant ID collisions.

Limits must be constants with focused tests. The implementation plan will choose conservative byte, file-count, and nesting limits.

## 8. Managed storage

Skills are copied into an application-owned root:

```text
<electron-user-data>/skills/<skill-id>/<version>/
```

The renderer never receives or supplies this path.

Installation uses:

1. a temporary staging directory under the same managed root;
2. validation and canonical digest computation;
3. rejection of unsupported entries;
4. atomic rename into the final version directory;
5. a database transaction recording installation metadata;
6. provider catalog synchronization.

A failed operation removes staging data and leaves the previously installed version unchanged.

Bundled skills and local imports use the same validated materialization path. Provider adapters receive only a trusted root chosen by the main process.

## 9. Shared contracts

### 9.1 Marketplace union

```ts
type MarketplaceItemDto =
  | { kind: "capability"; capability: CapabilitySummaryDto }
  | { kind: "skill"; skill: SkillSummaryDto };
```

The union prevents renderer code from assuming that every item has permissions, settings, or tools.

### 9.2 Skill summary

```ts
interface SkillSummaryDto {
  id: string;
  name: string;
  description: string;
  version: string;
  source: "bundled" | "local";
  compatibility: {
    codex: "supported" | "unsupported";
    opencode: "supported" | "unsupported";
  };
  installationState: "pending_verification" | "installed" | "invalid" | "update_available";
  automaticInvocation: boolean;
}
```

A detail DTO additionally exposes license, origin, digest, review state, and sanitized Markdown preview. It does not expose the managed filesystem path.

### 9.3 Structured invocation

Exactly one skill may be forced in one user turn. A skill turn and an ordinary message are distinct request variants, so the user's text is never duplicated:

```ts
interface SkillInvocationRequest {
  skillId: string;
  version: string;
  arguments?: string;
}

type CodingAgentSendMessageRequest =
  | {
      runId: string;
      content: string;
      reasoningVariant?: string;
      skillInvocation?: never;
    }
  | {
      runId: string;
      skillInvocation: SkillInvocationRequest;
      content?: never;
      reasoningVariant?: string;
    };
```

For `/skill:<id> some text`, `some text` is stored once as `skillInvocation.arguments`. It is also the user-visible text associated with the turn. The main process validates installation, version, digest, compatibility, and session state before passing the invocation to an adapter.

### 9.4 Adapter turn input

The provider-neutral adapter input must preserve the same discriminated shape rather than encoding command strings:

```ts
interface CodingAgentTurnBase {
  providerId: string;
  modelId: string;
  reasoningVariant?: string;
}

type CodingAgentTurnInput = CodingAgentTurnBase & (
  | { content: string; explicitSkill?: never }
  | {
      content?: never;
      explicitSkill: {
        id: string;
        name: string;
        path: string;
        arguments?: string;
      };
    }
);
```

Codex converts the explicit variant to one skill input followed by an optional text input containing `arguments`. OpenCode converts it to one native skill command whose arguments are the same value. The managed path exists only in main-process types and must not be placed in shared renderer contracts.

## 10. Persistence

### 10.1 `skill_installations`

The installation table stores at least:

- skill ID;
- version;
- source kind;
- sanitized source reference;
- content digest;
- compatibility verification state;
- automatic-invocation eligibility;
- installation and update timestamps.

Managed paths should be derived from the trusted root and ID/version rather than accepted from IPC.

### 10.2 `skill_invocations`

The invocation table stores:

- invocation ID;
- run ID;
- skill ID;
- installed version;
- mode: `explicit` or `automatic`;
- status: `requested`, `loaded`, or `failed`;
- normalized error code where applicable;
- timestamps.

Explicit invocations can always be recorded. Automatic invocations are recorded only when the provider exposes a reliable load event. The application must not infer successful loading from unrelated file reads or fabricate telemetry.

### 10.3 Separation from capability tables

`capability_installations`, `capability_settings`, and `session_capabilities` remain unchanged in meaning. Skills do not require capability permission digests, secret settings, host state, or per-session activation transitions.

Any schema change must use `npm run db:generate`; generated migrations must not be edited manually.

## 11. Provider integration

### 11.1 Adapter contract

A provider skill adapter exposes behavior equivalent to:

```ts
interface CodingAgentSkillAdapter {
  syncSkills(root: string, skills: readonly SkillDescriptor[]): Promise<void>;
  invokeSkill(
    session: CodingAgentSessionContext,
    turn: CodingAgentTurnInput,
  ): Promise<void>;
  verifySkills(
    session: CodingAgentSessionContext,
    expectedSkillIds: readonly string[],
  ): Promise<void>;
}
```

The implementation may integrate these methods into the existing Codex and OpenCode adapter classes if that produces a smaller public interface. Provider-specific protocol fields must not leak into `SkillService`.

### 11.2 Codex

The installed Codex app-server protocol exposes native skill operations, including:

- `skills/extraRoots/set`;
- `skills/list` with forced reload;
- a `UserInput` variant `{ type: "skill", name, path }`.

Codex flow:

1. register the managed skill root after app-server initialization;
2. force a skill-list refresh after installation or removal;
3. verify expected IDs and managed paths;
4. let Codex advertise enabled skill metadata for automatic use;
5. encode an explicit skill and the user's text in the same `turn/start` input array.

Skill synchronization must not reconfigure MCP servers or restart the capability utility host.

### 11.3 OpenCode

OpenCode supports native Agent Skill discovery through configured `skills` roots. Its runtime advertises ID, name, and description, then loads the body through its native `skill` mechanism.

OpenCode flow:

1. add the managed root to the `skills` array produced by `buildOpenCodeRuntimeConfig()`;
2. preserve existing MCP and permission configuration;
3. allow native skill loading for installed skills except those that disable model invocation;
4. use the native command/session API for explicit invocation, passing the remaining user text as arguments;
5. verify discovery after process start and after catalog changes;
6. reload only when the installed OpenCode version does not observe changes dynamically.

The configured permission model must not allow a skill to bypass existing shell approval behavior.

### 11.4 Version compatibility

Existing capability minimums are Codex `0.150.1` and OpenCode `1.18.23`. Skill support must be independently feature-detected and covered by real smoke tests before final minimum versions are declared.

A provider without the required native primitives marks skills as unsupported. The runtime must not silently fall back to prompt injection.

### 11.5 Coexistence with MCP capabilities

A turn may use:

- the existing session MCP capability profile;
- automatically discoverable skills;
- one explicit skill attachment.

Skill catalog synchronization and capability activation have separate lifecycle state. A failure in one must not corrupt the other, and a capability rollback must not remove the skill root.

## 12. Invocation flows

### 12.1 Automatic invocation

```text
installed skill
  → adapter publishes metadata through native provider discovery
  → coding agent evaluates ID/name/description against the task
  → coding agent invokes native skill loader
  → provider loads SKILL.md body
  → provider may load textual references on demand
  → adapter records `loaded` only when reliably observable
```

Agentic Worktrees does not run a second relevance classifier in this project.

### 12.2 Explicit invocation

```text
user types /skill:sec
  → renderer filters installed compatible skills
  → user selects security-review
  → composer replaces command token with a Skill chip
  → renderer sends one structured invocation containing ID, version, and arguments
  → IPC validates the payload
  → SkillService validates current installation/version/digest
  → provider adapter submits one native turn
  → invocation is persisted as requested/loaded/failed
```

A failed explicit invocation does not submit the text as an ordinary turn.

### 12.3 Version race

The chip captures the selected skill version. If the skill changes before send:

1. the main process rejects the request with `skill_version_changed`;
2. the renderer refreshes its skill catalog;
3. the chip displays an actionable error;
4. the user reselects or removes the skill.

## 13. Renderer design

### 13.1 Marketplace

The current Capability Library evolves into a Marketplace containing:

- `All`, `Capabilities`, and `Skills` filters;
- explicit `Capability` and `Skill` badges;
- shared search and category navigation;
- type-specific status and detail content.

Capability detail continues to show tools, settings, secrets, permissions, provenance, and review state.

Skill detail shows:

- ID, name, and description;
- version and source;
- license;
- Codex/OpenCode compatibility;
- automatic invocation eligibility;
- content digest;
- sanitized `SKILL.md` preview;
- textual reference inventory;
- install/remove action.

The UI must not expose MCP implementation details for a skill or imply that skills request executable permissions in this MVP.

### 13.2 `/skill:` autocomplete

The menu opens when the first composer token starts with `/skill:`.

Required behavior:

- incremental matching by skill ID and display name;
- installed skills only;
- incompatible entries visible but disabled;
- description, source, and Skill badge in each result;
- keyboard navigation with arrows, Enter, and Escape;
- visible focus state and accessible labels;
- empty and error states;
- one selected skill maximum.

Selecting a result removes the command token and inserts a structured chip. All remaining composer text becomes `skillInvocation.arguments`; the request contains no separate `content` field. The timeline renders those arguments as the user-visible text for the skill turn.

### 13.3 Skill chip

The chip displays the skill name, supports removal, and distinguishes stale or invalid state. It must not display or serialize the managed path.

### 13.4 Timeline

The renderer may show:

- `Requested skill: security-review` for explicit invocation;
- `Loaded skill: security-review` when confirmed by the provider;
- a user-friendly failed state.

Automatic loading must not be displayed as confirmed when only inferred.

## 14. IPC

New narrow channels:

- `skills.list`;
- `skills.get`;
- `skills.install`;
- `skills.remove`;
- optional `skills.onChanged` invalidation event.

The exact install request depends on the later source-selection UX, but main-process validation must resolve and verify every path. No generic filesystem or arbitrary package-loading channel is allowed.

`codingAgent.sendMessage` receives the optional structured invocation. Zod validation must occur in shared contracts, preload, and main-process handlers following the existing IPC pattern.

## 15. Error handling

Stable error codes:

- `skill_not_installed`;
- `skill_invalid`;
- `skill_incompatible`;
- `skill_sync_failed`;
- `skill_invocation_failed`;
- `skill_version_changed`.

Errors crossing IPC include a safe code and user-facing message. Internal logs may retain provider operation names and normalized failure context but must not log full skill content, user prompts, managed absolute paths, or sensitive repository paths.

Provider synchronization failures leave the installation record in a recoverable `invalid` or `pending_verification` state. They must never mark the skill available when discovery verification failed.

## 16. Testing strategy

### 16.1 Unit tests

Validation tests cover:

- valid frontmatter;
- missing or malformed descriptions;
- ID rules and directory mismatch;
- duplicate and case-variant collisions;
- `disable-model-invocation`;
- size and nesting limits.

Installer security tests cover:

- traversal;
- absolute paths;
- symlinks;
- binaries;
- scripts;
- partial writes;
- atomic replacement;
- rollback after database or synchronization failure.

Repository tests cover:

- install and update transactions;
- removal;
- invocation state transitions;
- persistence across restart.

### 16.2 Adapter tests

Codex tests assert:

- root registration;
- forced list refresh;
- expected-ID verification;
- one `turn/start` containing skill input and text;
- preservation of MCP config;
- structured failure when native methods are unavailable.

OpenCode tests assert:

- managed root in runtime `skills` config;
- preservation of MCP and shell permission configuration;
- explicit native command with arguments;
- automatic discovery eligibility;
- bounded reload and rollback behavior.

### 16.3 IPC and renderer tests

IPC tests reject malformed IDs, unknown versions, renderer-supplied paths, missing installation, and incompatible providers.

Renderer tests cover:

- menu trigger and filtering;
- keyboard navigation;
- disabled compatibility state;
- chip insertion/removal;
- exactly one selected skill;
- stale-version error;
- successful structured send;
- Marketplace filters and badges.

### 16.4 Integration and smoke tests

An integration test activates an MCP capability and invokes a skill in the same session.

Opt-in real smoke tests use a deterministic skill whose instructions require a recognizable response. Each supported provider must pass:

1. discovery;
2. explicit invocation;
3. automatic invocation from a clearly relevant prompt;
4. coexistence with an MCP tool;
5. catalog refresh after installation/removal.

The verified results establish minimum Codex and OpenCode versions.

## 17. Implementation sequence

1. Add shared skill contracts and generated database migration.
2. Implement parser, validator, managed storage, and repository.
3. Add Codex native skill synchronization and explicit invocation.
4. Add OpenCode native skill synchronization and explicit invocation.
5. Implement `SkillService`, IPC, preload API, and structured send-message flow.
6. Aggregate Skills and Capabilities in the Marketplace with distinct DTO branches.
7. Add `/skill:` autocomplete, structured chip, and timeline states.
8. Add integration tests, real smoke harnesses, authoring docs, and compatibility matrix.

Each phase must keep the application type-safe and preserve existing capability behavior.

Required verification after TypeScript changes:

```bash
npm run typecheck
npm run lint
npm test
```

After renderer or routing changes:

```bash
npm run package
```

After schema changes:

```bash
npm run db:generate
```

## 18. Deferred projects

The complete skills product will be delivered through later designs:

1. scope resolution for session, worktree, project, and global availability;
2. remote Marketplace, publisher identity, signatures, updates, and revocation;
3. mixed Capability/Skill packs;
4. “Save workflow as Skill” and personal authoring;
5. contextual recommendations and success signals.

These projects must build on `SkillService`, `SkillRepository`, and `CodingAgentSkillAdapter` rather than bypassing them.

## 19. Acceptance criteria

The core runtime is complete when:

- a validated textual Agent Skill can be installed into managed storage;
- it appears as a Skill, not a Capability, in the shared Marketplace;
- all installed compatible skills are advertised natively to Codex and OpenCode;
- either provider can choose a relevant skill automatically;
- `/skill:<id>` opens an autocomplete menu and creates one structured chip;
- sending the turn invokes that exact skill through the provider-native protocol;
- full skill instructions are not injected before invocation;
- scripts, binaries, symlinks, and unsafe paths are rejected;
- capability MCP tools and skills work together;
- automated and opt-in real compatibility tests pass;
- failures are structured, visible, recoverable, and never silently downgraded.
