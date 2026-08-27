# Capability SDK and Keyless Web Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a provider-neutral local Capability SDK and a bundled Web Search capability that uses Exa hosted MCP without a mandatory API key and can be activated on existing Codex and OpenCode chats.

**Architecture:** Capability packages depend only on a local SDK workspace. The Electron main process owns catalog, persistence, consent, optional credentials, and provider activation; an Electron utility process hosts chat-scoped MCP endpoints and executes reviewed capability code. Codex receives a chat capability endpoint at thread start and refreshes it after activation; OpenCode regenerates app-owned MCP/agent configuration and performs a coordinated restart/resume.

**Tech Stack:** TypeScript 5.9, npm workspaces, Electron 43 utility processes, Electron Forge/Vite, React 19, Zod 4, Ajv JSON Schema validation, `@modelcontextprotocol/sdk`, Drizzle ORM, SQLite, Vitest, Testing Library.

**Spec:** `docs/capabilities/2026-08-27-capability-sdk-web-search-design.md`

## Global Constraints

- Use `npm` for every dependency, build, database, test, lint, and typecheck command.
- Preserve Electron `contextIsolation: true` and `nodeIntegration: false`.
- Renderer code must not access filesystem, processes, databases, MCP endpoints, tokens, environment variables, or credentials.
- Every new IPC payload must be validated in the main process and parsed in preload.
- SDK v0.1 supports metadata, compatibility, permissions, settings, optional secrets, and MCP tools only; it does not expose commands, events, or UI extension points.
- Only bundled, reviewed capability packages may execute.
- The first compatibility floor is Codex CLI 0.150.1 and OpenCode 1.18.23; lower versions are reported as incompatible until separately verified.
- `auto` is the only Web Search provider mode; no-key requests use `https://mcp.exa.ai/mcp`, an optional Exa key uses `https://api.exa.ai`, and there is no silent Brave or DuckDuckGo fallback.
- Capability activation is chat/session scoped and takes effect on the next turn, never during an in-flight turn.
- Capability output is capped at 50 KB and 2,000 lines.
- Do not log search queries, result content, API keys, MCP bearer tokens, or internal capability endpoints.
- Generate Drizzle artifacts with `npm run db:generate`; do not hand-edit generated migration files.
- Run `npm run typecheck` after each TypeScript task and run `npm run lint`, `npm test`, and `npm run package` at the final gate.
- Keep the user's untracked documents under `docs/capabilities/` and `docs/conflict-panel/` untouched unless explicitly named by a task.

---

## Planned File Structure

### Local packages

- `packages/capability-sdk/package.json` — local publishable package metadata.
- `packages/capability-sdk/src/index.ts` — public SDK exports.
- `packages/capability-sdk/src/types.ts` — manifest, permission, setting, tool, context, and result contracts.
- `packages/capability-sdk/src/schema.ts` — JSON Schema validation and definition helpers.
- `packages/capability-sdk/src/errors.ts` — stable capability error codes.
- `packages/capability-sdk/src/output.ts` — output limit enforcement.
- `packages/capability-sdk/src/*.test.ts` — SDK contract tests.
- `capabilities/web-search/package.json` — bundled capability package metadata.
- `capabilities/web-search/src/manifest.ts` — provenance and permission manifest.
- `capabilities/web-search/src/exa-client.ts` — hosted MCP and optional direct API client.
- `capabilities/web-search/src/index.ts` — `web_search` definition.
- `capabilities/web-search/src/*.test.ts` — provider behavior tests.

### Main process capability subsystem

- `src/main/capabilities/catalog.ts` — immutable bundled catalog.
- `src/main/capabilities/capability-repository.ts` — SQLite installation/settings/session-state access.
- `src/main/capabilities/capability-credential-store.ts` — encrypted optional secret storage.
- `src/main/capabilities/host-protocol.ts` — main↔utility-process messages.
- `src/main/capabilities/host-registry.ts` — static mapping from bundled IDs to executable definitions.
- `src/main/capabilities/capability-host-server.ts` — authenticated Streamable HTTP MCP server.
- `src/main/capabilities/host-entry.ts` — utility-process entrypoint.
- `src/main/capabilities/capability-host-manager.ts` — utility-process ownership and chat connections.
- `src/main/capabilities/activation-types.ts` — provider activation boundary.
- `src/main/capabilities/capability-service.ts` — orchestration, state transitions, rollback, and events.
- `src/main/capabilities/*.test.ts` — focused backend tests.
- `vite.capability-host.config.ts` — dedicated utility-process bundle.

### Shared contracts and persistence

- `src/shared/db/schema.ts` — capability tables and inferred record types.
- `src/main/database/bootstrap.ts` — fresh-database capability tables.
- `src/main/database/index.test.ts` — bootstrap/upgrade coverage.
- `src/main/database/migrations/` — generated migration and snapshot artifacts.
- `src/shared/ipc/schemas.ts` — capability DTO and request schemas.
- `src/shared/ipc/channels.ts` — capability channels.
- `src/shared/ipc/api.ts` — renderer-facing capability API.
- `src/shared/ipc/schemas.test.ts` — contract validation tests.
- `src/main/ipc/index.ts` — thin validated handlers.
- `src/main/ipc/capability-handlers.test.ts` — handler delegation and rejection tests.
- `src/preload.ts` and `src/preload-auth.test.ts` — narrow exposure and parsing.

### Coding-agent adapters

- `src/main/coding-agents/types.ts` — capability connection/profile adapter contracts.
- `src/main/coding-agents/codex-adapter.ts` and tests — MCP config at start/resume and refresh verification.
- `src/main/coding-agents/opencode-adapter.ts` and tests — generated config, profile selection, restart/resume.
- `src/main/coding-agents/coding-agent-service.ts` and tests — run-host preparation, idle coordination, rollback, and capability snapshots.

### Renderer

- `src/renderer/pages/Capabilities.tsx` and test — Library route.
- `src/renderer/features/capabilities/hooks/useCapabilities.ts` and test — library/session state.
- `src/renderer/features/capabilities/components/CapabilityDetail.tsx` — detail panel.
- `src/renderer/features/capabilities/components/CapabilitySetupDialog.tsx` and test — consent and optional key.
- `src/renderer/features/capabilities/components/CapabilityPicker.tsx` and test — composer picker.
- `src/renderer/features/capabilities/components/ActiveCapabilities.tsx` — chips and status.
- `src/renderer/features/coding-agent/components/SessionComposer.tsx` and test — picker integration.
- `src/renderer/features/coding-agent/views/CodingAgentSession.tsx` — header/chips/setup flow.
- `src/renderer/features/coding-agent/hooks/useCodingAgentSession.ts` and test — capability event refresh and reload lock.
- `src/renderer/features/coding-agent/components/SessionMessages.tsx` and test — activation status row.
- `src/renderer/App.tsx`, `src/renderer/components/AppShell.tsx`, and route/navigation tests — Library route.

### Documentation and smoke testing

- `scripts/smoke-capability-web-search.mjs` — opt-in real CLI/keyless smoke harness.
- `scripts/lib/electron-capability-smoke-driver.mjs` — Playwright driver over the packaged app's narrow preload API.
- `scripts/smoke-capability-web-search.test.ts` — deterministic smoke-runner seam tests.
- `docs/capabilities/authoring-capabilities.md` — author workflow.
- `.env.example` — optional `EXA_API_KEY` smoke-test documentation only; the app runtime uses the vault.

---

### Task 1: Establish npm Workspaces and the Capability SDK Contract

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Create: `packages/capability-sdk/package.json`
- Create: `packages/capability-sdk/src/types.ts`
- Create: `packages/capability-sdk/src/errors.ts`
- Create: `packages/capability-sdk/src/schema.ts`
- Create: `packages/capability-sdk/src/output.ts`
- Create: `packages/capability-sdk/src/index.ts`
- Test: `packages/capability-sdk/src/schema.test.ts`
- Test: `packages/capability-sdk/src/output.test.ts`

**Interfaces:**

- Produces: `defineCapability()`, `defineTool<Input>()`, `validateCapabilityDefinition()`, `limitCapabilityOutput()`, `CapabilityDefinition`, `CapabilityManifest`, `CapabilityTool`, `CapabilityExecutionContext`, and `CapabilityError`.
- Consumes: no feature-specific code.

- [ ] **Step 1: Add the workspace and runtime dependencies**

Run:

```bash
npm install @modelcontextprotocol/sdk ajv
```

Add these workspace roots to `package.json`:

```json
{
  "workspaces": ["packages/*", "capabilities/*"]
}
```

Change `tsconfig.json` to include all authored TypeScript:

```json
{
  "include": ["src", "packages", "capabilities", "scripts"]
}
```

Expected: `package-lock.json` records the SDK, Ajv, and local workspace topology.

- [ ] **Step 2: Write failing manifest and tool contract tests**

Create tests that exercise exact stability rules:

```ts
const definition = defineCapability({
  manifest: validManifest,
  tools: [
    defineTool<{ query: string }>({
      name: "web_search",
      description: "Search the web",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", minLength: 1 } },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async ({ query }) => ({ content: [{ type: "text", text: query }] }),
    }),
  ],
});

expect(validateCapabilityDefinition(definition)).toEqual(definition);
expect(() =>
  validateCapabilityDefinition({
    ...definition,
    manifest: { ...definition.manifest, id: "Invalid ID" },
  }),
).toThrow("manifest.id");
```

Also assert duplicate tool names, unknown compatibility values, undeclared secret access, and invalid JSON Schema fail.

- [ ] **Step 3: Run the SDK tests and confirm RED**

Run:

```bash
npm test -- packages/capability-sdk/src/schema.test.ts packages/capability-sdk/src/output.test.ts
```

Expected: FAIL because the SDK package and helpers do not exist.

- [ ] **Step 4: Implement the public SDK types and helpers**

Define these stable public shapes:

```ts
export type CapabilityAgentKind = "codex" | "opencode";
export type CapabilityCompatibility = "supported" | "unsupported";
export type CapabilityErrorCode =
  | "invalid_input"
  | "missing_secret"
  | "permission_denied"
  | "rate_limited"
  | "upstream_unavailable"
  | "upstream_protocol_error"
  | "cancelled"
  | "activation_failed"
  | "agent_reload_failed"
  | "internal_error";

export interface CapabilityExecutionContext {
  signal: AbortSignal;
  settings: Readonly<Record<string, unknown>>;
  secrets: {
    get(name: string): Promise<string>;
    getOptional(name: string): Promise<string | undefined>;
  };
  logger: {
    info(event: string, fields?: Readonly<Record<string, string | number | boolean>>): void;
    error(event: string, fields?: Readonly<Record<string, string | number | boolean>>): void;
  };
}

export interface CapabilityTool<Input> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Input, context: CapabilityExecutionContext): Promise<CapabilityToolResult>;
}
```

Use Ajv in `validateCapabilityDefinition()` for schema compilation and enforce lowercase dotted capability IDs plus lowercase snake-case tool names. `CapabilityError` must retain only a stable code and safe message.

- [ ] **Step 5: Implement and test output bounds**

`limitCapabilityOutput()` must keep at most 2,000 lines and 50 KiB and append a deterministic truncation notice:

```ts
const limited = limitCapabilityOutput({
  content: [{ type: "text", text: "x\n".repeat(2_100) }],
});
expect(limited.content[0]?.text).toContain("[Capability output truncated]");
expect(Buffer.byteLength(limited.content[0]?.text ?? "")).toBeLessThanOrEqual(50 * 1024);
```

- [ ] **Step 6: Run focused and static verification**

Run:

```bash
npm test -- packages/capability-sdk/src/schema.test.ts packages/capability-sdk/src/output.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the SDK foundation**

```bash
git add package.json package-lock.json tsconfig.json packages/capability-sdk
git commit -m "feat(capabilities): add capability SDK contract"
```

---

### Task 2: Port Keyless Exa Web Search as a Separate Capability Package

**Files:**

- Create: `capabilities/web-search/package.json`
- Create: `capabilities/web-search/src/manifest.ts`
- Create: `capabilities/web-search/src/exa-client.ts`
- Create: `capabilities/web-search/src/index.ts`
- Test: `capabilities/web-search/src/exa-client.test.ts`
- Test: `capabilities/web-search/src/index.test.ts`
- Create: `capabilities/web-search/LICENSE.pi-web-access`

**Interfaces:**

- Consumes: `defineCapability`, `defineTool`, `CapabilityError`, and `CapabilityExecutionContext` from Task 1.
- Produces: `webSearchManifest`, `createWebSearchCapability({ fetchImpl })`, and default `CapabilityDefinition` with tool `web_search`.

- [ ] **Step 1: Create the workspace package and preserve provenance**

Use:

```json
{
  "name": "@agentic-worktrees/web-search-capability",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts",
  "dependencies": {
    "@agentic-worktrees/capability-sdk": "0.1.0"
  }
}
```

Copy the MIT license text from the analyzed `pi-web-access` 0.25.0 source into `LICENSE.pi-web-access` with its original copyright line.

- [ ] **Step 2: Write failing Exa transport tests**

Cover keyless JSON-RPC over JSON and SSE, 429, malformed payloads, timeout/cancel, and advanced-to-basic degradation. The keyless request assertion must be exact:

```ts
expect(fetchMock).toHaveBeenCalledWith(
  "https://mcp.exa.ai/mcp?tools=web_search_exa",
  expect.objectContaining({
    method: "POST",
    headers: expect.objectContaining({
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    }),
  }),
);
expect(JSON.stringify(fetchMock.mock.calls[0])).not.toContain("apiKey");
```

For 429:

```ts
await expect(client.search({ query: "electron" }, signal)).rejects.toMatchObject({
  code: "rate_limited",
});
```

- [ ] **Step 3: Run the Web Search tests and confirm RED**

```bash
npm test -- capabilities/web-search/src/exa-client.test.ts capabilities/web-search/src/index.test.ts
```

Expected: FAIL because the capability does not exist.

- [ ] **Step 4: Implement the manifest and input schema**

The manifest must declare the maximum reviewed network surface and optional secret:

```ts
export const webSearchManifest: CapabilityManifest = {
  id: "agentic-worktrees.web-search",
  name: "Web Search",
  version: "0.1.0",
  sdkVersion: "^0.1.0",
  description: "Search the web using Exa in automatic keyless mode.",
  category: "web-browser",
  author: { name: "Agentic Worktrees" },
  license: "MIT",
  compatibility: { codex: "supported", opencode: "supported" },
  provenance: {
    kind: "manual-port",
    source: "pi-extension",
    package: "pi-web-access",
    sourceVersion: "0.25.0",
    repository: "https://github.com/nicobailon/pi-web-access",
  },
  permissions: {
    network: ["mcp.exa.ai", "api.exa.ai"],
    secrets: ["exa-api-key"],
  },
  settings: {
    providerMode: { type: "string", enum: ["auto"], default: "auto" },
    exaApiKey: { type: "secret", required: false },
    resultLimit: { type: "integer", default: 5, min: 1, max: 20 },
  },
};
```

- [ ] **Step 5: Implement `searchExaAuto()`**

Use hosted MCP when `apiKey` is absent and direct Exa `/search` when present. Parse both plain JSON and `data:` SSE frames. Try `web_search_advanced_exa` only when recency, domains, or content are requested; on a non-abort advanced-tool failure, retry `web_search_exa` with filters folded into the query. Never call another vendor.

Return:

```ts
export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
  publishedDate?: string;
}

export interface WebSearchOutput {
  provider: "exa-hosted" | "exa-api";
  degraded: boolean;
  results: WebSearchResult[];
}
```

- [ ] **Step 6: Implement the SDK tool definition**

`createWebSearchCapability()` injects `fetch` for deterministic tests and resolves the optional key only at execution:

```ts
const apiKey = await context.secrets.getOptional("exaApiKey");
const output = await searchExaAuto(input, {
  apiKey,
  fetchImpl,
  signal: context.signal,
});
return {
  content: [{ type: "text", text: formatAttributedResults(output) }],
  details: output,
};
```

Do not call `context.logger` with input or output data.

- [ ] **Step 7: Verify the package**

```bash
npm test -- capabilities/web-search/src/exa-client.test.ts capabilities/web-search/src/index.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit the first capability**

```bash
git add capabilities/web-search package-lock.json
git commit -m "feat(capabilities): add keyless Exa web search"
```

---

### Task 3: Add the Bundled Catalog and Safe Renderer DTOs

**Files:**

- Create: `src/main/capabilities/catalog.ts`
- Test: `src/main/capabilities/catalog.test.ts`
- Modify: `src/shared/ipc/schemas.ts`
- Modify: `src/shared/ipc/schemas.test.ts`

**Interfaces:**

- Consumes: `webSearchManifest` from Task 2.
- Produces: `listBundledCapabilities()`, `getBundledCapability(id)`, `CapabilitySummaryDto`, `CapabilityDetailDto`, `CapabilitySessionStateDto`, and request schemas used by later IPC tasks.

- [ ] **Step 1: Write failing catalog and DTO tests**

Assert immutable lookup, unknown-ID rejection, safe provenance, and absence of executable entrypoints, tokens, endpoints, and secret values:

```ts
const detail = getBundledCapability("agentic-worktrees.web-search");
expect(detail.manifest.compatibility).toEqual({ codex: "supported", opencode: "supported" });
expect(JSON.stringify(toCapabilityDetailDto(detail))).not.toMatch(
  /token|endpoint|secretValue|execute/,
);
```

Validate requests:

```ts
expect(capabilityActivateRequestSchema.parse({
  runId: "run-1",
  capabilityId: "agentic-worktrees.web-search",
})).toEqual({ runId: "run-1", capabilityId: "agentic-worktrees.web-search" });
```

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
npm test -- src/main/capabilities/catalog.test.ts src/shared/ipc/schemas.test.ts
```

Expected: FAIL because catalog and schemas are absent.

- [ ] **Step 3: Implement the static catalog**

Use a frozen map with a single reviewed manifest:

```ts
const bundledCapabilities = new Map([
  [webSearchManifest.id, Object.freeze({ manifest: webSearchManifest, reviewStatus: "bundled-reviewed" as const })],
]);
```

`getBundledCapability()` throws `new CapabilityError("invalid_input", "Unknown capability.")` without echoing arbitrary input.

- [ ] **Step 4: Add shared DTOs and request schemas**

Define exact renderer states:

```ts
export const capabilityStateSchema = z.enum([
  "available",
  "needs_setup",
  "ready",
  "pending_activation",
  "reloading",
  "active",
  "pending_deactivation",
  "activation_failed",
  "inactive",
  "unavailable",
]);
```

Add schemas for list/detail/configure/activate/deactivate and `CapabilityChangedEventDto`. Configuration accepts `exaApiKey?: string` only on the inbound request; response schemas expose `secretConfigured: boolean` and never a string value.

- [ ] **Step 5: Verify contracts**

```bash
npm test -- src/main/capabilities/catalog.test.ts src/shared/ipc/schemas.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit catalog contracts**

```bash
git add src/main/capabilities/catalog.ts src/main/capabilities/catalog.test.ts src/shared/ipc/schemas.ts src/shared/ipc/schemas.test.ts
git commit -m "feat(capabilities): add bundled catalog contracts"
```

---

### Task 4: Persist Capability Configuration and Session State

**Files:**

- Modify: `src/shared/db/schema.ts`
- Modify: `src/main/database/bootstrap.ts`
- Modify: `src/main/database/index.test.ts`
- Create: `src/main/capabilities/capability-repository.ts`
- Test: `src/main/capabilities/capability-repository.test.ts`
- Generated: `src/main/database/migrations/`

**Interfaces:**

- Produces: `CapabilityRepository` with `getInstallation`, `upsertInstallation`, `replaceSettings`, `getSettings`, `getSessionCapability`, `listSessionCapabilities`, `transitionSessionCapability`, and `listInterruptedSessionCapabilities`.
- Consumes: capability IDs from Task 3 and existing `runs.id` foreign keys.

- [ ] **Step 1: Write failing database and repository tests**

Test fresh bootstrap table names and cascade behavior:

```ts
expect(readTableNames(sqlite, "capability%")).toEqual([
  "capability_installations",
  "capability_settings",
]);
expect(readTableNames(sqlite, "session_capabilit%")).toEqual([
  "session_capabilities",
]);
```

Repository transitions must reject invalid edges, for example `inactive -> active` without `pending_activation`.

- [ ] **Step 2: Run database tests and confirm RED**

```bash
npm test -- src/main/database/index.test.ts src/main/capabilities/capability-repository.test.ts
```

Expected: FAIL because the tables and repository do not exist.

- [ ] **Step 3: Add Drizzle tables**

Use these keys and constraints:

```ts
capabilityInstallations: capabilityId PK, version, permissionDigest,
  configured boolean, createdAt, updatedAt
capabilitySettings: id PK, capabilityId FK cascade, key, valueJson nullable,
  secretRef nullable, createdAt, updatedAt, UNIQUE(capabilityId, key)
sessionCapabilities: id PK, runId FK cascade, capabilityId,
  version, status, errorCode nullable, activatedAt nullable,
  deactivatedAt nullable, createdAt, updatedAt,
  UNIQUE(runId, capabilityId)
```

Add bootstrap SQL that matches the Drizzle schema exactly.

- [ ] **Step 4: Generate migration artifacts**

```bash
npm run db:generate
```

Expected: Drizzle creates the next numbered SQL migration, snapshot, and journal entry under `src/main/database/migrations/`. Inspect the generated SQL for only the three capability tables and indexes; do not edit it manually.

- [ ] **Step 5: Implement the repository and transition guard**

Use an explicit transition map:

```ts
const allowedTransitions = {
  inactive: ["pending_activation"],
  activation_failed: ["pending_activation", "inactive"],
  pending_activation: ["reloading", "active", "activation_failed"],
  reloading: ["active", "activation_failed", "inactive"],
  active: ["pending_deactivation"],
  pending_deactivation: ["reloading", "inactive", "activation_failed"],
} as const;
```

All writes occur in transactions and return domain records, not Drizzle entities.

- [ ] **Step 6: Verify persistence**

```bash
npm test -- src/main/database/index.test.ts src/main/capabilities/capability-repository.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit schema and repository**

```bash
git add src/shared/db/schema.ts src/main/database/bootstrap.ts src/main/database/index.test.ts src/main/database/migrations src/main/capabilities/capability-repository.ts src/main/capabilities/capability-repository.test.ts
git commit -m "feat(capabilities): persist configuration and activation state"
```

---

### Task 5: Add the Optional Encrypted Capability Credential Store

**Files:**

- Create: `src/main/capabilities/capability-credential-store.ts`
- Test: `src/main/capabilities/capability-credential-store.test.ts`

**Interfaces:**

- Produces: `CapabilityCredentialStore` with `setSecret(capabilityId, settingKey, value): Promise<string>`, `getSecret(reference): Promise<string | undefined>`, and `removeSecret(reference): Promise<void>`.
- Consumes: Electron `safeStorage` only through injected dependencies.

- [ ] **Step 1: Write failing vault tests**

Cover unavailable encryption, atomic replacement, corrupt ciphertext removal, opaque IDs, and redacted errors:

```ts
const reference = await store.setSecret(
  "agentic-worktrees.web-search",
  "exaApiKey",
  "exa-secret-value",
);
expect(reference).not.toContain("exa-secret-value");
expect(await store.getSecret(reference)).toBe("exa-secret-value");
expect(loggedErrors.join(" ")).not.toContain("exa-secret-value");
```

- [ ] **Step 2: Run tests and confirm RED**

```bash
npm test -- src/main/capabilities/capability-credential-store.test.ts
```

Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement the encrypted store**

Follow the existing GitHub credential-store safety pattern but use a versioned map:

```ts
interface CapabilityCredentialPayload {
  version: 1;
  secrets: Record<string, {
    capabilityId: string;
    settingKey: string;
    value: string;
  }>;
}
```

Write encrypted bytes to a temporary sibling path, rename atomically, set restrictive file mode where supported, and redact both the new secret and any previously loaded secrets from logged causes.

- [ ] **Step 4: Verify vault behavior**

```bash
npm test -- src/main/capabilities/capability-credential-store.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit vault support**

```bash
git add src/main/capabilities/capability-credential-store.ts src/main/capabilities/capability-credential-store.test.ts
git commit -m "feat(capabilities): add encrypted optional credentials"
```

---

### Task 6: Build the Isolated Capability Host and Utility-Process Manager

**Files:**

- Create: `src/main/capabilities/host-protocol.ts`
- Create: `src/main/capabilities/host-registry.ts`
- Create: `src/main/capabilities/capability-host-server.ts`
- Create: `src/main/capabilities/host-entry.ts`
- Create: `src/main/capabilities/capability-host-manager.ts`
- Test: `src/main/capabilities/capability-host-server.test.ts`
- Test: `src/main/capabilities/capability-host-manager.test.ts`
- Create: `vite.capability-host.config.ts`
- Modify: `forge.config.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `CapabilityHostConnection { runId, serverName, url, bearerToken }` and `CapabilityHostManager.ensureHost`, `setActiveCapabilities`, `resolveSecret`, `stopHost`, `stopAll`.
- Consumes: bundled executable registry from Task 2, SDK output/error helpers, and credential store from Task 5.

- [ ] **Step 1: Write failing authenticated MCP server tests**

Start the server on port `0`, initialize an MCP client, and assert:

```ts
expect(await listTools(validToken)).toEqual([]);
await server.setActiveCapabilities(["agentic-worktrees.web-search"]);
expect((await listTools(validToken)).map((tool) => tool.name)).toEqual(["web_search"]);
await expect(listTools("wrong-token")).rejects.toMatchObject({ status: 401 });
```

Invoke `web_search` with a fake Exa fetch and assert output bounds and safe errors.

- [ ] **Step 2: Write failing manager ownership tests**

Inject a fake utility-process launcher. Verify one process per run, idempotent `ensureHost`, token rotation after stop, secret request/reply correlation, crash cleanup, and `stopAll()`.

- [ ] **Step 3: Run host tests and confirm RED**

```bash
npm test -- src/main/capabilities/capability-host-server.test.ts src/main/capabilities/capability-host-manager.test.ts
```

Expected: FAIL because host modules do not exist.

- [ ] **Step 4: Implement the host protocol and static executable registry**

Use discriminated messages:

```ts
type MainToHostMessage =
  | { type: "host.initialize"; runId: string; token: string; activeCapabilityIds: string[]; settings: Record<string, Record<string, unknown>> }
  | { type: "host.capabilities.set"; requestId: string; capabilityIds: string[]; settings: Record<string, Record<string, unknown>> }
  | { type: "host.secret.result"; requestId: string; value?: string; errorCode?: "missing_secret" };

type HostToMainMessage =
  | { type: "host.ready"; runId: string; port: number }
  | { type: "host.secret.request"; requestId: string; capabilityId: string; settingKey: string }
  | { type: "host.capabilities.applied"; requestId: string; toolNames: string[] }
  | { type: "host.error"; code: CapabilityErrorCode; message: string };
```

`host-registry.ts` statically maps `agentic-worktrees.web-search` to the bundled definition; it never resolves paths supplied by the renderer.

- [ ] **Step 5: Implement the loopback Streamable HTTP MCP host**

Use `@modelcontextprotocol/sdk` and Node `http`. Reject non-loopback binding, require `Authorization: Bearer <token>`, create transport sessions per MCP client, and map each SDK tool through Ajv validation, `AbortSignal`, safe secret resolution, `CapabilityError`, and `limitCapabilityOutput()`.

Send MCP tool-list change notifications after activation when supported, while provider adapters still perform explicit refresh/reload.

- [ ] **Step 6: Implement the utility-process manager**

Launch with:

```ts
utilityProcess.fork(path.join(__dirname, "capability-host.js"), [], {
  serviceName: `Agentic Worktrees Capability Host ${runId}`,
  stdio: "pipe",
});
```

Generate 32-byte base64url tokens, wait for `host.ready` with a 10-second timeout, retain exact process ownership, correlate secret requests, and kill only the owned utility process.

- [ ] **Step 7: Add the dedicated Vite build**

Configure `vite.capability-host.config.ts` to emit `capability-host.js`, externalizing only native modules also externalized by main. Add a second `target: "main"` build entry in `forge.config.ts` with entry `src/main/capabilities/host-entry.ts`. Add a narrow script:

```json
{
  "scripts": {
    "build:capability-host": "vite build --config vite.capability-host.config.ts"
  }
}
```

- [ ] **Step 8: Verify host tests and bundle**

```bash
npm test -- src/main/capabilities/capability-host-server.test.ts src/main/capabilities/capability-host-manager.test.ts
npm run build:capability-host
npm run typecheck
```

Expected: PASS and `.vite/build/capability-host.js` exists locally as an ignored build artifact.

- [ ] **Step 9: Commit host runtime**

```bash
git add src/main/capabilities/host-protocol.ts src/main/capabilities/host-registry.ts src/main/capabilities/capability-host-server.ts src/main/capabilities/host-entry.ts src/main/capabilities/capability-host-manager.ts src/main/capabilities/capability-host-server.test.ts src/main/capabilities/capability-host-manager.test.ts vite.capability-host.config.ts forge.config.ts package.json package-lock.json
git commit -m "feat(capabilities): add isolated MCP capability host"
```

---

### Task 7: Extend Coding-Agent Contracts and Integrate Codex MCP Refresh

**Files:**

- Modify: `src/main/coding-agents/types.ts`
- Modify: `src/main/coding-agents/codex-adapter.ts`
- Modify: `src/main/coding-agents/codex-adapter.test.ts`
- Modify: `src/main/coding-agents/codex-app-server-client.ts`
- Modify: `src/main/coding-agents/codex-app-server-client.test.ts`

**Interfaces:**

- Consumes: `CapabilityHostConnection` from Task 6.
- Produces: `CodingAgentCapabilityConnection`, `CodingAgentAdapter.refreshCapabilities()`, and Codex start/resume configuration using a chat-scoped MCP endpoint.

- [ ] **Step 1: Write failing Codex capability tests**

Assert `thread/start` receives a request-level config:

```ts
expect(client.requests).toContainEqual({
  method: "thread/start",
  params: expect.objectContaining({
    config: {
      mcp_servers: {
        agentic_worktrees: {
          url: "http://127.0.0.1:43123/mcp",
          http_headers: { Authorization: "Bearer run-token" },
        },
      },
    },
  }),
});
```

Assert late activation sends `config/mcpServer/reload`, then polls `mcpServerStatus/list` for thread `thread-1` until `web_search` is visible or a bounded timeout fails with `activation_failed`.

- [ ] **Step 2: Run Codex tests and confirm RED**

```bash
npm test -- src/main/coding-agents/codex-app-server-client.test.ts src/main/coding-agents/codex-adapter.test.ts
```

Expected: FAIL because capability configuration and refresh do not exist.

- [ ] **Step 3: Extend adapter contracts**

Add:

```ts
export interface CodingAgentCapabilityConnection {
  serverName: string;
  url: string;
  authorizationHeader: string;
  profileId: string;
}

export interface CodingAgentSessionOptions {
  modelId: string;
  capabilities: CodingAgentCapabilityConnection;
}
```

Extend `getSession()` to accept the connection for cold resume, extend `sendPrompt()` with `capabilityProfileId`, and add:

```ts
refreshCapabilities(
  directory: string,
  sessionId: string,
  connection: CodingAgentCapabilityConnection,
  expectedToolNames: string[],
): Promise<void>;
```

- [ ] **Step 4: Implement Codex start, resume, and refresh**

Use the connection in `thread/start` and `thread/resume` request-level `config.mcp_servers`. Add typed client requests for reload and status listing. Poll only while the thread is idle and stop after 10 seconds. Do not write `~/.codex/config.toml`.

- [ ] **Step 5: Verify Codex integration**

```bash
npm test -- src/main/coding-agents/codex-app-server-client.test.ts src/main/coding-agents/codex-adapter.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Codex support**

```bash
git add src/main/coding-agents/types.ts src/main/coding-agents/codex-adapter.ts src/main/coding-agents/codex-adapter.test.ts src/main/coding-agents/codex-app-server-client.ts src/main/coding-agents/codex-app-server-client.test.ts
git commit -m "feat(capabilities): connect Codex sessions to MCP hosts"
```

---

### Task 8: Add OpenCode Capability Profiles and Coordinated Reload

**Files:**

- Modify: `src/main/coding-agents/opencode-adapter.ts`
- Modify: `src/main/coding-agents/opencode-adapter.test.ts`
- Create: `src/main/coding-agents/opencode-capability-config.ts`
- Test: `src/main/coding-agents/opencode-capability-config.test.ts`

**Interfaces:**

- Consumes: `CodingAgentCapabilityConnection` from Task 7.
- Produces: `buildOpenCodeRuntimeConfig()`, adapter registration of per-run MCP servers/profiles, coordinated `reconfigureCapabilities()`, and profile-aware prompt dispatch.

- [ ] **Step 1: Write failing generated-config tests**

For run `run-1`, assert a unique remote MCP server and primary agent profile:

```ts
expect(buildOpenCodeRuntimeConfig([connection])).toMatchObject({
  mcp: {
    aw_run_1: {
      type: "remote",
      url: connection.url,
      headers: { Authorization: connection.authorizationHeader },
    },
  },
  agent: {
    aw_run_1: {
      mode: "primary",
      permission: { bash: "ask" },
    },
  },
});
```

Assert profile IDs and server names sanitize Nano ID values deterministically and never include bearer tokens.

- [ ] **Step 2: Write failing restart/resume tests**

With two persisted sessions, verify:

1. reconfiguration waits until both statuses are idle;
2. one owned OpenCode process is stopped;
3. the previous config is retained for rollback;
4. the process restarts with new `OPENCODE_CONFIG_CONTENT`;
5. health is checked;
6. both session IDs are fetched successfully;
7. future prompts pass `agent: profileId`.

Also test health failure restores the previous config and restarts it once.

- [ ] **Step 3: Run OpenCode tests and confirm RED**

```bash
npm test -- src/main/coding-agents/opencode-capability-config.test.ts src/main/coding-agents/opencode-adapter.test.ts
```

Expected: FAIL because generated profiles and reconfiguration do not exist.

- [ ] **Step 4: Extract runtime config generation**

Replace the static `OPENCODE_COMMAND_APPROVAL_CONFIG` with `buildOpenCodeRuntimeConfig(connections)`. Preserve `build.permission.bash = "ask"` behavior for legacy/no-profile calls and generate one profile per run connection. Use current agent-level wildcard permissions so each profile denies all generated capability servers and then allows its own normalized server namespace:

```ts
permission: {
  bash: "ask",
  "aw_*": "deny",
  [`${serverName}_*`]: "allow",
}
```

MCP tool names follow OpenCode's normalized `<server>_<tool>` format. Keep this logic confined to the OpenCode adapter and verify it against the declared OpenCode 1.18.23 floor.

- [ ] **Step 5: Implement coordinated adapter reconfiguration**

Add an adapter-owned connection map and:

```ts
reconfigureCapabilities(input: {
  connections: CodingAgentCapabilityConnection[];
  sessions: Array<{ directory: string; sessionId: string }>;
}): Promise<void>;
```

Reject reconfiguration while a turn is active unless the caller has already waited for idle. Stop and restart only the adapter-owned child PID. After health succeeds, call `getSession()` for every supplied session. On failure, restore the prior connection map/config and restart once before throwing `agent_reload_failed`.

- [ ] **Step 6: Make prompts profile-aware**

Replace hard-coded `agent: "build"` with `agent: input.capabilityProfileId || "build"`. Keep model and reasoning behavior unchanged.

- [ ] **Step 7: Verify OpenCode integration**

```bash
npm test -- src/main/coding-agents/opencode-capability-config.test.ts src/main/coding-agents/opencode-adapter.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit OpenCode support**

```bash
git add src/main/coding-agents/opencode-capability-config.ts src/main/coding-agents/opencode-capability-config.test.ts src/main/coding-agents/opencode-adapter.ts src/main/coding-agents/opencode-adapter.test.ts
git commit -m "feat(capabilities): reload OpenCode capability profiles"
```

---

### Task 9: Implement Capability Orchestration, Rollback, and Session Snapshots

**Files:**

- Create: `src/main/capabilities/activation-types.ts`
- Create: `src/main/capabilities/capability-service.ts`
- Test: `src/main/capabilities/capability-service.test.ts`
- Modify: `src/main/coding-agents/coding-agent-service.ts`
- Modify: `src/main/coding-agents/coding-agent-service.test.ts`
- Modify: `src/main/coding-agents/types.ts`
- Modify: `src/shared/ipc/schemas.ts`

**Interfaces:**

- Produces: `listCapabilities`, `getCapability`, `configureCapability`, `activateCapability`, `deactivateCapability`, `subscribeToCapabilityEvents`, `reconcileCapabilities`, and `stopCapabilities`.
- Consumes: catalog, repository, credential store, host manager, and coding-agent refresh/reconfigure methods.

- [ ] **Step 1: Write failing service state-machine tests**

Test keyless setup, the bounded Exa endpoint probe, optional key replacement, Codex activation, OpenCode reload state, deactivation, rollback, idempotent retry, and crash reconciliation:

```ts
await service.configureCapability({
  capabilityId: "agentic-worktrees.web-search",
  acceptedPermissionDigest: expectedDigest,
  settings: { providerMode: "auto", resultLimit: 5 },
});
expect(await service.getCapability(id)).toMatchObject({ state: "ready", secretConfigured: false });
```

For activation, require event order:

```ts
expect(events.map((event) => event.state)).toEqual([
  "pending_activation",
  "reloading",
  "active",
]);
```

- [ ] **Step 2: Write failing coding-agent lifecycle tests**

Generate `runId` before external session creation, create an empty capability host, pass its connection into Codex/OpenCode session options, stop it when session creation fails, and include capability states in `getAgentSessionSnapshot()`.

Assert `sendAgentMessage()` refuses while capability state is `reloading` with the user-safe message `Capabilities are being applied. Try again when reload completes.`

- [ ] **Step 3: Run service tests and confirm RED**

```bash
npm test -- src/main/capabilities/capability-service.test.ts src/main/coding-agents/coding-agent-service.test.ts
```

Expected: FAIL because orchestration is absent.

- [ ] **Step 4: Implement the activation boundary**

Define:

```ts
export interface CodingAgentCapabilityActivator {
  prepareSession(runId: string, agentKind: CodingAgentKind): Promise<CodingAgentCapabilityConnection>;
  apply(runId: string, expectedToolNames: string[]): Promise<"refreshed" | "reloaded">;
  remove(runId: string): Promise<"refreshed" | "reloaded">;
  isAgentIdle(runId: string): Promise<boolean>;
}
```

The concrete implementation delegates to adapters through `coding-agent-service`; capability packages never import this interface.

- [ ] **Step 5: Implement configuration and activation transactions**

Configuration validates the current manifest and permission digest, stores optional key material first, and transactionally replaces the opaque setting reference. It performs a five-second `HEAD` reachability probe against the manifest's baseline `https://mcp.exa.ai/mcp` endpoint without sending a query or key. A network failure is returned as a non-blocking `upstream_unavailable` warning because anonymous Exa is explicitly best-effort; valid consent still leaves the capability `ready`.

Activation:

1. validates run and agent compatibility;
2. transitions to `pending_activation`;
3. updates host active IDs/settings;
4. transitions to `reloading` only when adapter returns that path;
5. verifies expected tools;
6. transitions to `active` and records `activatedAt`.

On failure, restore the previous host active set and provider config, then record `activation_failed` with a stable code.

- [ ] **Step 6: Integrate session creation, cold resume, prompt dispatch, and snapshots**

Derive `profileId` from `runId`; do not persist bearer tokens. On cold resume, rehydrate the host and pass the new connection to `getSession()`. Add to `CodingAgentSessionSnapshotDto`:

```ts
capabilities: Array<{
  id: string;
  name: string;
  version: string;
  state: CapabilityStateDto;
  errorCode?: string;
  activatedAt?: string;
  deactivatedAt?: string;
}>;
capabilityReloading: boolean;
```

Use the profile ID in every prompt and compaction request that selects an OpenCode agent.

- [ ] **Step 7: Implement startup reconciliation and cleanup**

`reconcileCapabilities()` rehydrates active hosts and converts interrupted pending states into a retryable `activation_failed` unless the provider verification proves the desired tool set is already active. `stopCapabilities()` revokes tokens and awaits all owned utility processes.

- [ ] **Step 8: Verify orchestration**

```bash
npm test -- src/main/capabilities/capability-service.test.ts src/main/coding-agents/coding-agent-service.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit orchestration**

```bash
git add src/main/capabilities/activation-types.ts src/main/capabilities/capability-service.ts src/main/capabilities/capability-service.test.ts src/main/coding-agents/coding-agent-service.ts src/main/coding-agents/coding-agent-service.test.ts src/main/coding-agents/types.ts src/shared/ipc/schemas.ts
git commit -m "feat(capabilities): orchestrate chat capability lifecycle"
```

---

### Task 10: Expose Narrow Capability IPC and Preload APIs

**Files:**

- Modify: `src/shared/ipc/channels.ts`
- Modify: `src/shared/ipc/api.ts`
- Modify: `src/shared/ipc/schemas.ts`
- Modify: `src/shared/ipc/schemas.test.ts`
- Modify: `src/main/ipc/index.ts`
- Create: `src/main/ipc/capability-handlers.test.ts`
- Modify: `src/preload.ts`
- Modify: `src/preload-auth.test.ts`

**Interfaces:**

- Consumes: capability service from Task 9.
- Produces: `window.api.capabilities.list`, `get`, `configure`, `activate`, `deactivate`, and `onChanged`.

- [ ] **Step 1: Write failing IPC and preload tests**

Assert malformed IDs and missing run IDs are rejected before service calls. Assert preload parses every response and event. Assert API shape contains only:

```ts
capabilities: {
  list(request?: { runId?: string }): Promise<CapabilitySummaryDto[]>;
  get(request: { capabilityId: string; runId?: string }): Promise<CapabilityDetailDto>;
  configure(request: CapabilityConfigureRequest): Promise<CapabilityDetailDto>;
  activate(request: CapabilityActivateRequest): Promise<CapabilitySessionStateDto>;
  deactivate(request: CapabilityDeactivateRequest): Promise<CapabilitySessionStateDto>;
  onChanged(listener: (event: CapabilityChangedEventDto) => void): () => void;
}
```

Check serialized responses never contain `bearerToken`, `url`, `secretRef`, or the supplied Exa key.

- [ ] **Step 2: Run IPC tests and confirm RED**

```bash
npm test -- src/main/ipc/capability-handlers.test.ts src/preload-auth.test.ts src/shared/ipc/schemas.test.ts
```

Expected: FAIL because channels and APIs are absent.

- [ ] **Step 3: Add centralized channels and API types**

Add exact channels:

```ts
CAPABILITY_LIST: "capability:list"
CAPABILITY_GET: "capability:get"
CAPABILITY_CONFIGURE: "capability:configure"
CAPABILITY_ACTIVATE: "capability:activate"
CAPABILITY_DEACTIVATE: "capability:deactivate"
CAPABILITY_CHANGED: "capability:changed"
```

- [ ] **Step 4: Add thin validated handlers**

Each handler parses with its Zod request schema and calls one service method. Do not catch and flatten structured safe capability errors into raw stack traces. Register capability event forwarding alongside existing coding-agent event forwarding.

- [ ] **Step 5: Add narrow preload methods**

Parse list/detail/session-state responses and `CAPABILITY_CHANGED` events before invoking renderer listeners. Never expose generic invoke/send methods.

- [ ] **Step 6: Verify IPC boundaries**

```bash
npm test -- src/main/ipc/capability-handlers.test.ts src/preload-auth.test.ts src/shared/ipc/schemas.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit IPC support**

```bash
git add src/shared/ipc/channels.ts src/shared/ipc/api.ts src/shared/ipc/schemas.ts src/shared/ipc/schemas.test.ts src/main/ipc/index.ts src/main/ipc/capability-handlers.test.ts src/preload.ts src/preload-auth.test.ts
git commit -m "feat(capabilities): expose validated capability IPC"
```

---

### Task 11: Build the Capability Library and Setup Flow

**Files:**

- Create: `src/renderer/pages/Capabilities.tsx`
- Test: `src/renderer/pages/Capabilities.test.tsx`
- Create: `src/renderer/features/capabilities/hooks/useCapabilities.ts`
- Test: `src/renderer/features/capabilities/hooks/useCapabilities.test.tsx`
- Create: `src/renderer/features/capabilities/components/CapabilityDetail.tsx`
- Create: `src/renderer/features/capabilities/components/CapabilitySetupDialog.tsx`
- Test: `src/renderer/features/capabilities/components/CapabilitySetupDialog.test.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/AppShell.tsx`
- Modify: `src/renderer/components/app-shell-layout.test.ts`

**Interfaces:**

- Consumes: `window.api.capabilities` from Task 10.
- Produces: `/capabilities` route, searchable Library, detail view, consent flow, and optional-key setup.

- [ ] **Step 1: Write failing Library interaction tests**

Render two fixture summaries and assert search, compatibility filter, state labels, detail selection, and keyboard focus. For the keyless path:

```ts
await user.click(screen.getByRole("button", { name: "Configure Web Search" }));
expect(screen.getByText(/queries are sent to Exa/i)).toBeVisible();
expect(screen.getByLabelText("Exa API key (optional)")).toBeVisible();
await user.click(screen.getByRole("button", { name: "Accept and continue" }));
expect(api.capabilities.configure).toHaveBeenCalledWith(
  expect.objectContaining({ settings: { providerMode: "auto", resultLimit: 5 } }),
);
```

Assert the request omits `exaApiKey` when blank.

- [ ] **Step 2: Run renderer tests and confirm RED**

```bash
npm test -- src/renderer/pages/Capabilities.test.tsx src/renderer/features/capabilities/hooks/useCapabilities.test.tsx src/renderer/features/capabilities/components/CapabilitySetupDialog.test.tsx
```

Expected: FAIL because the feature does not exist.

- [ ] **Step 3: Implement `useCapabilities()`**

The hook loads summaries, optionally loads details, subscribes once to `onChanged`, coalesces refreshes, and exposes `configure`, `activate`, `deactivate`, `loading`, and user-safe `error`. It must ignore late responses after unmount or context change.

- [ ] **Step 4: Implement the dense Library and detail panel**

Use existing Button, Badge, Dialog, Input, and Select components. Add search plus category/compatibility/state filters. Show `Available`, `Needs setup`, `Ready`, and `Unavailable`; show publisher, source package/version, repository, license, review status, provided tools, and both Exa domains.

- [ ] **Step 5: Implement keyless consent and optional secret setup**

The dialog must state:

- queries and requested options are sent to Exa;
- anonymous service is best-effort and rate-limited;
- no key is required;
- an optional key may increase limits;
- no silent fallback provider is used.

After save, clear the local secret input immediately and retain only `secretConfigured` from the response.

- [ ] **Step 6: Add route and navigation**

Add `/capabilities` to `App.tsx` and a `Blocks` icon main-navigation item labeled `Capabilities` to `AppShell.tsx`. Extend route/navigation tests for active and collapsed labels.

- [ ] **Step 7: Verify the Library**

```bash
npm test -- src/renderer/pages/Capabilities.test.tsx src/renderer/features/capabilities/hooks/useCapabilities.test.tsx src/renderer/features/capabilities/components/CapabilitySetupDialog.test.tsx src/renderer/components/app-shell-layout.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Library UI**

```bash
git add src/renderer/pages/Capabilities.tsx src/renderer/pages/Capabilities.test.tsx src/renderer/features/capabilities src/renderer/App.tsx src/renderer/components/AppShell.tsx src/renderer/components/app-shell-layout.test.ts
git commit -m "feat(capabilities): add curated Capability Library"
```

---

### Task 12: Add Chat Capability Picker, Active State, and Reload UX

**Files:**

- Create: `src/renderer/features/capabilities/components/CapabilityPicker.tsx`
- Test: `src/renderer/features/capabilities/components/CapabilityPicker.test.tsx`
- Create: `src/renderer/features/capabilities/components/ActiveCapabilities.tsx`
- Modify: `src/renderer/features/coding-agent/components/SessionComposer.tsx`
- Modify: `src/renderer/features/coding-agent/components/SessionComposer.test.tsx`
- Modify: `src/renderer/features/coding-agent/views/CodingAgentSession.tsx`
- Modify: `src/renderer/features/coding-agent/hooks/useCodingAgentSession.ts`
- Modify: `src/renderer/features/coding-agent/hooks/useCodingAgentSession.test.tsx`
- Modify: `src/renderer/features/coding-agent/components/SessionMessages.tsx`
- Modify: `src/renderer/features/coding-agent/components/SessionMessages.test.tsx`

**Interfaces:**

- Consumes: session capability snapshot and `window.api.capabilities`.
- Produces: composer selector, setup handoff, active chips/count, reload lock, activation row, removal, retry, and next-turn messaging.

- [ ] **Step 1: Write failing picker and session tests**

Assert groups for Active, Ready, Needs setup, and Incompatible. Test activation after an existing assistant message:

```ts
await user.click(screen.getByRole("button", { name: "Capabilities" }));
await user.click(screen.getByRole("menuitem", { name: /Web Search.*Ready/ }));
expect(api.capabilities.activate).toHaveBeenCalledWith({
  runId: "run-1",
  capabilityId: "agentic-worktrees.web-search",
});
```

For `reloading`, assert textarea/send are disabled, stop remains available for any already-owned agent operation, and `Applying Web Search…` is visible. For `active`, assert `1 Capability`, a removable `Web Search` chip, and `Web Search activated` status row.

- [ ] **Step 2: Run focused UI tests and confirm RED**

```bash
npm test -- src/renderer/features/capabilities/components/CapabilityPicker.test.tsx src/renderer/features/coding-agent/components/SessionComposer.test.tsx src/renderer/features/coding-agent/hooks/useCodingAgentSession.test.tsx src/renderer/features/coding-agent/components/SessionMessages.test.tsx
```

Expected: FAIL because chat integration is absent.

- [ ] **Step 3: Implement the picker and setup handoff**

Use the existing `PickerMenu` interaction pattern. Selecting `needs_setup` opens `CapabilitySetupDialog`; after successful keyless setup, call activate. Selecting `ready` activates directly. Selecting `active` asks for deactivation confirmation. Include a `Browse Capability Library` link with `runId` in router state, not in a query containing secrets.

- [ ] **Step 4: Extend the session hook**

Read capabilities from the coding-agent snapshot, subscribe to `window.api.capabilities.onChanged`, and queue a session refresh only when `event.runId === runId`. Expose:

```ts
capabilities,
capabilityReloading,
activateCapability,
deactivateCapability,
retryCapability,
```

Do not add polling or timers.

- [ ] **Step 5: Integrate composer lock and active indicators**

Add capability props to `SessionComposer`; render the picker near existing model/reasoning controls. In `CodingAgentSession`, show count and chips in the header and pass `locked || capabilityReloading` to send controls.

- [ ] **Step 6: Render persisted activation status**

`SessionMessages` renders one compact status row from each session capability's latest `activatedAt`, `deactivatedAt`, or error state. It does not inject this UI-only row into model context or run messages.

- [ ] **Step 7: Verify chat UX**

```bash
npm test -- src/renderer/features/capabilities/components/CapabilityPicker.test.tsx src/renderer/features/coding-agent/components/SessionComposer.test.tsx src/renderer/features/coding-agent/hooks/useCodingAgentSession.test.tsx src/renderer/features/coding-agent/components/SessionMessages.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit chat integration**

```bash
git add src/renderer/features/capabilities/components/CapabilityPicker.tsx src/renderer/features/capabilities/components/CapabilityPicker.test.tsx src/renderer/features/capabilities/components/ActiveCapabilities.tsx src/renderer/features/coding-agent/components/SessionComposer.tsx src/renderer/features/coding-agent/components/SessionComposer.test.tsx src/renderer/features/coding-agent/views/CodingAgentSession.tsx src/renderer/features/coding-agent/hooks/useCodingAgentSession.ts src/renderer/features/coding-agent/hooks/useCodingAgentSession.test.tsx src/renderer/features/coding-agent/components/SessionMessages.tsx src/renderer/features/coding-agent/components/SessionMessages.test.tsx
git commit -m "feat(capabilities): activate capabilities from chat"
```

---

### Task 13: Wire Application Startup, Recovery, and Owned-Process Shutdown

**Files:**

- Modify: `src/main.ts`
- Modify: `src/main-lifecycle.test.ts`
- Modify: `src/main/capabilities/capability-service.ts`
- Modify: `src/main/capabilities/capability-service.test.ts`

**Interfaces:**

- Consumes: `reconcileCapabilities()` and `stopCapabilities()` from Task 9.
- Produces: startup recovery after database initialization and deterministic shutdown of capability hosts before app exit.

- [ ] **Step 1: Write failing lifecycle tests**

Assert order:

```ts
expect(callOrder).toEqual([
  "initDatabase",
  "registerIpcHandlers",
  "reconcileCapabilities",
  "createWindow",
]);
```

On `before-quit`, assert terminals, capability hosts, and coding agents are each stopped once, and `app.quit()` occurs only after all owned cleanup promises settle.

- [ ] **Step 2: Run lifecycle tests and confirm RED**

```bash
npm test -- src/main-lifecycle.test.ts src/main/capabilities/capability-service.test.ts
```

Expected: FAIL because capability lifecycle is not wired.

- [ ] **Step 3: Wire startup reconciliation**

After database initialization and before the renderer can request session state, initialize the credential store/host manager/service and await `reconcileCapabilities()`. A reconciliation failure logs only a safe code and leaves affected records retryable; it does not prevent opening unrelated chats.

- [ ] **Step 4: Wire shutdown ownership**

Extend the existing guarded `before-quit` path to await:

```ts
Promise.allSettled([
  stopWorkspaceTerminals(),
  stopCapabilities(),
  stopCodingAgents(),
]);
```

Keep the existing re-entry guard so cleanup cannot recursively trigger itself.

- [ ] **Step 5: Verify lifecycle**

```bash
npm test -- src/main-lifecycle.test.ts src/main/capabilities/capability-service.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit lifecycle wiring**

```bash
git add src/main.ts src/main-lifecycle.test.ts src/main/capabilities/capability-service.ts src/main/capabilities/capability-service.test.ts
git commit -m "feat(capabilities): reconcile and stop capability runtimes"
```

---

### Task 14: Add Authoring Documentation and Opt-In Real Smoke Harness

**Files:**

- Create: `scripts/smoke-capability-web-search.mjs`
- Create: `scripts/lib/electron-capability-smoke-driver.mjs`
- Test: `scripts/smoke-capability-web-search.test.ts`
- Create: `docs/capabilities/authoring-capabilities.md`
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes: packaged app capability APIs and installed `codex`/`opencode` CLIs.
- Produces: repeatable keyless smoke command and a second-capability author guide.

- [ ] **Step 1: Add the packaged-app smoke driver dependency**

Run:

```bash
npm install --save-dev @playwright/test
```

Use Playwright's Electron API only in the opt-in script; do not ship it in the renderer or main-process runtime bundle.

- [ ] **Step 2: Define and test the smoke-driver seam**

Export this interface from `scripts/lib/electron-capability-smoke-driver.mjs` through JSDoc typing:

```ts
interface CapabilitySmokeDriver {
  launch(): Promise<void>;
  listConfiguredAgents(): Promise<Array<{ kind: "codex" | "opencode"; version: string }>>;
  getFirstWorktreeId(): Promise<string>;
  createSession(agentKind: "codex" | "opencode", worktreeId: string): Promise<string>;
  sendMessage(runId: string, content: string): Promise<void>;
  waitForIdle(runId: string, timeoutMs: number): Promise<void>;
  configureKeylessWebSearch(): Promise<void>;
  activateWebSearch(runId: string): Promise<void>;
  deactivateWebSearch(runId: string): Promise<void>;
  getSnapshot(runId: string): Promise<unknown>;
  readProcessLogs(): string;
  close(): Promise<void>;
}
```

The implementation launches the executable supplied by `AW_SMOKE_EXECUTABLE` with Playwright `_electron.launch({ executablePath })`, obtains the first window, and calls only `window.api` methods through `page.evaluate()`. It captures the owned process stdout/stderr and uses bounded 250 ms polling only inside `waitForIdle()`.

In `scripts/smoke-capability-web-search.test.ts`, inject a fake driver and assert missing CLIs fail with `Codex CLI 0.150.1 or newer is required.` or `OpenCode 1.18.23 or newer is required.` rather than shell stack traces.

- [ ] **Step 3: Add the opt-in script**

The script must:

1. verify supported Codex and OpenCode versions;
2. require their existing authenticated sessions but no search key;
3. create/use one chat per agent through the app smoke driver;
4. send a baseline message;
5. activate `agentic-worktrees.web-search`;
6. send a search request on the next turn;
7. assert at least one attributed Exa URL;
8. deactivate and verify `web_search` is absent;
9. scan captured app logs for query text, result snippets, `Authorization`, `exaApiKey`, and optional key values;
10. optionally rerun with `EXA_API_KEY` when supplied.

Add:

```json
{
  "scripts": {
    "smoke:capabilities": "node scripts/smoke-capability-web-search.mjs"
  }
}
```

- [ ] **Step 4: Document SDK authoring**

The guide must walk through:

- creating an npm workspace capability package;
- defining manifest/provenance/permissions/settings;
- defining one JSON-Schema tool;
- dependency injection for network tests;
- local catalog registration;
- fake MCP verification;
- optional real Codex/OpenCode smoke verification;
- output, cancellation, error, logging, and no-secret rules.

Use a small `echo_text` capability as the second-capability example so documentation does not duplicate Web Search internals.

- [ ] **Step 5: Document optional smoke environment only**

Add to `.env.example`:

```dotenv
# Required for npm run smoke:capabilities: packaged Agentic Worktrees executable.
AW_SMOKE_EXECUTABLE=

# Optional: raises Exa limits for npm run smoke:capabilities.
# The desktop app stores user-provided capability keys in Electron safeStorage.
EXA_API_KEY=
```

Do not read this variable throughout app runtime code.

- [ ] **Step 6: Verify documentation and smoke seam**

```bash
npm test -- scripts
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit documentation and smoke harness**

```bash
git add scripts/smoke-capability-web-search.mjs scripts/lib/electron-capability-smoke-driver.mjs scripts/smoke-capability-web-search.test.ts docs/capabilities/authoring-capabilities.md .env.example package.json package-lock.json
git commit -m "docs(capabilities): add authoring and smoke workflow"
```

---

### Task 15: Run Full Verification and Package the Electron Application

**Files:**

- Modify only files required to fix failures introduced by Tasks 1–14.

**Interfaces:**

- Consumes: complete vertical slice.
- Produces: verified implementation evidence; no new feature surface.

- [ ] **Step 1: Run project-wide primary diagnostics before builds**

Run LSP diagnostics for:

```text
packages/capability-sdk/
capabilities/web-search/
src/main/capabilities/
src/main/coding-agents/
src/shared/
src/renderer/features/capabilities/
src/renderer/features/coding-agent/
```

Expected: no TypeScript errors.

- [ ] **Step 2: Run type checking**

```bash
npm run typecheck
```

Expected: PASS with exit code 0.

- [ ] **Step 3: Run focused capability and adapter tests**

```bash
npm test -- packages/capability-sdk capabilities/web-search src/main/capabilities src/main/coding-agents src/main/ipc/capability-handlers.test.ts src/renderer/features/capabilities
```

Expected: PASS.

- [ ] **Step 4: Run the complete test suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Run lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Build the renderer and utility process through packaging**

```bash
npm run package
```

Expected: Electron Forge packages the main, preload, renderer, native modules, and `capability-host.js` successfully. Do not run `npm run make` or `npm run publish`.

- [ ] **Step 7: Run the optional real keyless smoke test when authenticated CLIs are available**

```bash
npm run smoke:capabilities
```

Expected: Codex and OpenCode both invoke the same bundled `web_search` capability after an existing turn, OpenCode preserves history through reload, and no search API key is required. If authenticated CLIs are unavailable, record the smoke test as not run rather than weakening automated tests.

- [ ] **Step 8: Inspect final diagnostics and repository state**

Run `lens_diagnostics mode=all` for all edited files and:

```bash
git status --short
git diff --check
```

Expected: no blocking diagnostics, no whitespace errors, no `.env`, database files, logs, build outputs, coverage, or user-owned untracked docs staged.

- [ ] **Step 9: Commit verification-only fixes if any**

If verification changed files, inspect `git diff --name-only`, stage each verified feature file by its exact path using `git add -- path`, and commit:

```bash
git commit -m "fix(capabilities): resolve vertical slice verification issues"
```

Do not stage unrelated user files. If no files changed, do not create an empty commit.

---

## Plan Self-Review Record

- **Spec coverage:** Tasks 1–2 cover SDK and keyless Exa; Tasks 3–5 cover catalog, persistence, consent, and optional vault; Task 6 covers isolated MCP hosting; Tasks 7–9 cover Codex/OpenCode activation, rollback, state, and recovery; Task 10 covers IPC security; Tasks 11–12 cover Library and chat UX; Task 13 covers owned lifecycle; Tasks 14–15 cover authoring, smoke, tests, build, and acceptance evidence.
- **Explicit deferrals preserved:** no third-party execution, public registry, packs, recommendations, commands, platform events, extension UI, alternate activation scopes, Brave, DuckDuckGo, or silent fallback.
- **Type consistency:** `CapabilityHostConnection` maps once to `CodingAgentCapabilityConnection`; all session calls use derived `profileId`; optional keys are accepted only inbound and represented by `secretConfigured` outbound; activation states match the shared Zod enum and repository transition map.
- **Migration discipline:** schema is authored in Drizzle/bootstrap, generated artifacts come only from `npm run db:generate`.
- **Security boundary:** only the main process handles vault values and host connection details; the utility host receives secrets just in time; renderer DTOs exclude endpoints, tokens, references, and values.
