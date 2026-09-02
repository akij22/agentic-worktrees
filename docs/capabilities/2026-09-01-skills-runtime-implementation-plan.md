# Agent Skills Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure, provider-native Agent Skills runtime in which every installed compatible skill is discoverable automatically and one skill can be invoked explicitly per turn through `/skill:<id>`.

**Architecture:** Keep Skills separate from executable Capabilities in the backend, aggregate them only in the Marketplace UI, and store validated packages in app-managed versioned storage with an atomic `active/<skill-id>` provider projection. Codex and OpenCode use native skill discovery and invocation behind the existing coding-agent adapter boundary; no prompt-injection or MCP fallback is permitted.

**Tech Stack:** Electron 43, TypeScript 5.9 strict mode, React 19, Zod 4, SQLite/Drizzle ORM, Vitest, Testing Library, Codex app-server protocol, OpenCode SDK, YAML 2.9.

**Spec:** `docs/capabilities/2026-09-01-skills-runtime-design.md`

## Global Constraints

- Work only on `feat/skills-runtime`, based on `feat/capabilities` at `c90350f`.
- Preserve all pre-existing uncommitted user changes; inspect `git status --short` before every task and stage only files named by that task.
- Use `npm` exclusively. Add `yaml@^2.9.0` as the only new runtime dependency.
- Keep `contextIsolation: true` and `nodeIntegration: false`; the renderer must never receive filesystem paths or filesystem primitives.
- Skill IDs are lowercase kebab-case, 1–64 characters, with no leading, trailing, or consecutive hyphens, and must match the directory containing `SKILL.md`.
- Skill descriptions are required and limited to 1,024 characters.
- The first runtime accepts only `SKILL.md` and bounded textual references; reject scripts, binaries, symlinks, hard-linked source entries, absolute paths, and traversal.
- Store canonical packages under `<userData>/skills/packages/<skill-id>/<version>` and expose only real copied projections under `<userData>/skills/active/<skill-id>`.
- All installed compatible skills are provider-discoverable unless `disable-model-invocation: true`; explicitly invoked skills remain selectable.
- Preserve progressive disclosure: providers advertise only ID, name, and description before native invocation, and Agentic Worktrees must not preload full `SKILL.md` bodies into prompts.
- Exactly one explicit skill is allowed per turn. The structured request contains either ordinary `content` or `skillInvocation`, never both.
- Do not silently fall back to prompt injection or an MCP skill loader when native provider skill support is unavailable.
- Do not expose full skill content, prompts, managed absolute paths, or sensitive repository paths in logs or IPC errors.
- Run `npm run typecheck` after every TypeScript task. Run focused tests first, then `npm run lint` for touched source files through the project script.
- Run `npm run db:generate` after schema changes; never edit generated migration artifacts manually.
- Run `npm run package` after Marketplace, routing, composer, or styling changes.

---

## File Structure

### New shared contracts

- `src/shared/skills/schemas.ts` — portable skill IDs, Skill DTOs, structured invocation schemas, and inferred TypeScript types. The Capability/Skill Marketplace union remains in the central IPC schema to avoid a shared-module import cycle.
- `src/shared/skills/schemas.test.ts` — contract and discriminated-request tests.

### New main-process skill subsystem

- `src/main/skills/skill-validation.ts` — frontmatter parsing, package traversal, file policy, canonical descriptor, and digest calculation.
- `src/main/skills/skill-validation.test.ts` — malformed metadata, limits, collision, and unsafe-file tests.
- `src/main/skills/skill-installer.ts` — staging, package publication, active projection replacement, rollback, and removal.
- `src/main/skills/skill-installer.test.ts` — real temporary-directory tests for atomicity and rollback.
- `src/main/skills/skill-repository.ts` — installation and invocation persistence.
- `src/main/skills/skill-repository.test.ts` — in-memory SQLite repository tests.
- `src/main/skills/skill-service.ts` — list/get/install/remove/synchronize/invoke orchestration and safe errors.
- `src/main/skills/skill-service.test.ts` — dependency-injected service behavior and compensation tests.
- `src/main/ipc/skill-handlers.ts` — thin schema-validating IPC handlers beside the existing capability handlers.
- `src/main/ipc/skill-handlers.test.ts` — malformed payload and DTO-redaction tests.

### Existing backend files to modify

- `package.json`, `package-lock.json` — direct YAML dependency and skill smoke scripts.
- `src/shared/db/schema.ts` — `skill_installations` and `skill_invocations` tables.
- `src/main/database/bootstrap.ts` — equivalent clean-database bootstrap SQL.
- `src/main/database/migrations/*` — generated Drizzle migration and metadata.
- `src/main/coding-agents/types.ts` — discriminated turn input and optional native-skill adapter methods.
- `src/main/coding-agents/codex-adapter.ts` and test — Codex roots, verification, and native skill input.
- `src/main/coding-agents/opencode-capability-config.ts` and test — OpenCode skill root and permission config.
- `src/main/coding-agents/opencode-adapter.ts` and test — OpenCode catalog verification and native command invocation.
- `src/main/coding-agents/coding-agent-service.ts` and test — process-wide skill catalog configuration and structured turns.
- `src/shared/ipc/channels.ts`, `src/shared/ipc/schemas.ts`, `src/shared/ipc/schemas.test.ts` — skill channels and send-message union.
- `src/shared/ipc/api.ts`, `src/preload.ts` — narrow typed skill API.
- `src/main/ipc/index.ts` — authenticated registration, main-owned directory picker, and structured send coordination.
- `src/main.ts` — construct and reconcile `SkillService` with an app-owned root.

### New and modified renderer files

- `src/renderer/pages/Marketplace.tsx` and test — replaces the Capability-only page.
- `src/renderer/features/marketplace/components/MarketplaceRegistry.tsx` and test — combined list, filters, badges, and selection.
- `src/renderer/features/marketplace/hooks/useMarketplace.ts` and test — aggregate existing capability API with skill API.
- `src/renderer/features/skills/components/SkillDetail.tsx` and test — skill-specific detail and install/remove actions.
- `src/renderer/features/skills/components/SkillCommandMenu.tsx` and test — `/skill:` autocomplete.
- `src/renderer/features/skills/components/SkillInvocationChip.tsx` and test — controlled explicit selection.
- `src/renderer/features/coding-agent/lib/skill-commands.ts` and test — deterministic command parsing.
- `src/renderer/features/coding-agent/components/SessionComposer.tsx` and test — skill palette/chip keyboard integration.
- `src/renderer/features/coding-agent/hooks/useCodingAgentSession.ts` and test — skill catalog subscription and structured send.
- `src/renderer/features/coding-agent/views/CodingAgentSession.tsx` and test — controlled selection and successful-clear behavior.
- `src/renderer/App.tsx`, `src/renderer/components/AppShell.tsx`, visual tests — `/marketplace` route and label, with `/capabilities` redirect compatibility.
- `src/renderer/features/capabilities/components/CapabilityPicker.tsx` and test — link to Marketplace while retaining chat capability activation.

### Smoke and documentation

- `scripts/skill-smoke/driver.mjs` and test — typed browser-side skill operations.
- `scripts/skill-smoke/run.mjs` and test — provider/version gating and explicit/automatic scenarios.
- `scripts/skill-smoke/fixtures/deterministic-review/SKILL.md` — textual deterministic fixture.
- `docs/capabilities/authoring-skills.md` — supported format, security limits, and compatibility checks.

---

### Task 1: Shared Agent Skill contracts and strict frontmatter validation

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/shared/skills/schemas.ts`
- Create: `src/shared/skills/schemas.test.ts`
- Create: `src/main/skills/skill-validation.ts`
- Create: `src/main/skills/skill-validation.test.ts`

**Interfaces:**

- Produces: `skillIdSchema`, `skillSummarySchema`, `skillDetailSchema`, `skillInvocationRequestSchema`, `codingAgentTurnRequestSchema`, `SkillSummaryDto`, `SkillDetailDto`, and `SkillInvocationRequest`.
- Produces: `validateSkillPackage(sourceRoot: string): Promise<ValidatedSkillPackage>`.
- `ValidatedSkillPackage` contains `{ descriptor, files, contentDigest }`; `files` contains normalized safe relative paths and UTF-8 text.

- [ ] **Step 1: Add failing shared-schema tests**

```ts
import { describe, expect, it } from "vitest";
import {
  codingAgentTurnRequestSchema,
  skillInvocationRequestSchema,
  skillSummarySchema,
} from "./schemas";

describe("Agent Skill contracts", () => {
  it("accepts one versioned explicit invocation", () => {
    expect(skillInvocationRequestSchema.parse({
      skillId: "security-review",
      version: "1.0.0",
      arguments: "Review the authentication boundary",
    })).toEqual({
      skillId: "security-review",
      version: "1.0.0",
      arguments: "Review the authentication boundary",
    });
  });

  it("rejects content and a skill invocation in the same turn", () => {
    expect(() => codingAgentTurnRequestSchema.parse({
      runId: "run-1",
      content: "duplicate",
      skillInvocation: { skillId: "security-review", version: "1.0.0" },
    })).toThrow();
  });

  it("rejects invalid IDs and overlong descriptions", () => {
    expect(() => skillSummarySchema.parse({
      id: "Security_Review",
      name: "Security Review",
      description: "x".repeat(1_025),
      version: "1.0.0",
      source: "local",
      compatibility: { codex: "supported", opencode: "supported" },
      installationState: "installed",
      automaticInvocation: true,
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run the shared-schema test and verify RED**

Run: `npm test -- src/shared/skills/schemas.test.ts`

Expected: FAIL because `src/shared/skills/schemas.ts` does not exist.

- [ ] **Step 3: Add the direct YAML dependency**

Run: `npm install yaml@^2.9.0`

Expected: `package.json` and `package-lock.json` list `yaml` as a direct runtime dependency.

- [ ] **Step 4: Implement the shared schemas**

Use a strict discriminated union so ordinary content and explicit skill invocation cannot coexist:

```ts
import { z } from "zod";

export const skillIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64);
export const skillInvocationRequestSchema = z.object({
  skillId: skillIdSchema,
  version: z.string().trim().min(1).max(80),
  arguments: z.string().trim().max(100_000).optional(),
});
export const codingAgentTurnRequestSchema = z.union([
  z.object({
    runId: z.string().trim().min(1),
    content: z.string().trim().min(1).max(100_000),
    reasoningVariant: z.string().trim().min(1).max(80).optional(),
    skillInvocation: z.never().optional(),
  }),
  z.object({
    runId: z.string().trim().min(1),
    skillInvocation: skillInvocationRequestSchema,
    reasoningVariant: z.string().trim().min(1).max(80).optional(),
    content: z.never().optional(),
  }),
]);
```

Define `skillSummarySchema` and `skillDetailSchema` with the exact states and compatibility values from the spec. Task 8 defines `marketplaceItemSchema` in `src/shared/ipc/schemas.ts`, where `capabilitySummarySchema` already lives. Never include a filesystem path in a DTO.

- [ ] **Step 5: Add failing package-validation tests**

Create temporary fixtures in the test rather than committing unsafe files. Cover valid frontmatter, directory mismatch, missing description, `scripts/`, a symlink, `lstat().nlink > 1`, binary NUL bytes, traversal, more than 64 files, a file over 256 KiB, and total content over 1 MiB.

```ts
it("validates a textual directory skill and computes a stable digest", async () => {
  await writeSkill(root, "security-review", `---\nname: security-review\ndescription: Review security boundaries\n---\n# Workflow\nRead references/checklist.md\n`, {
    "references/checklist.md": "# Checklist\n",
  });
  const first = await validateSkillPackage(join(root, "security-review"));
  const second = await validateSkillPackage(join(root, "security-review"));
  expect(first.descriptor.id).toBe("security-review");
  expect(first.files.map((file) => file.relativePath)).toEqual([
    "SKILL.md",
    "references/checklist.md",
  ]);
  expect(first.contentDigest).toBe(second.contentDigest);
});
```

- [ ] **Step 6: Run validation tests and verify RED**

Run: `npm test -- src/main/skills/skill-validation.test.ts`

Expected: FAIL because `validateSkillPackage` is missing.

- [ ] **Step 7: Implement strict validation**

Use `yaml.parseDocument` with unique keys, reject aliases, extract only an object frontmatter document, walk with `lstat`, and hash sorted `(relativePath, byteLength, bytes)` entries. Export constants for all limits so tests do not duplicate magic values.

When `disable-model-invocation: true`, set `descriptor.automaticInvocation` to `false`. Preserve allowed standard metadata but do not grant tools. Derive a deterministic local version `0.0.0-local.<first-12-digest-hex>` after hashing; this gives versioned storage and stale-chip detection without requiring proprietary frontmatter.

- [ ] **Step 8: Run focused tests and typecheck**

Run:

```bash
npm test -- src/shared/skills/schemas.test.ts src/main/skills/skill-validation.test.ts
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 9: Commit only Task 1 files**

```bash
git add package.json package-lock.json src/shared/skills src/main/skills/skill-validation.ts src/main/skills/skill-validation.test.ts
git commit -m "feat(skills): add portable skill validation contracts" -m $'## Changes\n\n- Add strict shared Agent Skill DTO and turn-request schemas.\n- Parse and validate bounded textual SKILL.md packages with deterministic digests.\n- Add YAML as a direct dependency and reject unsafe package entries.'
```

---

### Task 2: Atomic managed package storage and provider projection

**Files:**

- Create: `src/main/skills/skill-installer.ts`
- Create: `src/main/skills/skill-installer.test.ts`

**Interfaces:**

- Consumes: `ValidatedSkillPackage`, `validateSkillPackage` from Task 1.
- Produces: `SkillStorageLayout`, `createSkillStorageLayout(userDataPath)`, `SkillInstallTransaction`, `stageSkillInstallation(input)`, `removeInstalledSkill(input)`.
- `SkillInstallTransaction.commit()` publishes both package and active projection; `rollback()` restores the prior projection.

- [ ] **Step 1: Write failing atomic-installation tests**

```ts
it("publishes versioned storage and an ID-shaped active projection", async () => {
  const transaction = await stageSkillInstallation({ sourceDirectory, managedRoot });
  const installed = await transaction.commit();
  expect(installed.packagePath).toBe(join(managedRoot, "packages", "security-review", "1.0.0"));
  expect(await readFile(join(managedRoot, "active", "security-review", "SKILL.md"), "utf8"))
    .toContain("name: security-review");
});

it("restores the previous active projection during rollback", async () => {
  await installVersion("1.0.0", "old workflow");
  const next = await stageVersion("2.0.0", "new workflow");
  await next.commit();
  await next.rollback();
  expect(await activeBody()).toContain("old workflow");
});
```

Also test that `disable-model-invocation: true` adds `metadata.opencode/autoinvoke: false` only in the active projection, while the canonical package bytes and digest remain unchanged.

- [ ] **Step 2: Run the installer test and verify RED**

Run: `npm test -- src/main/skills/skill-installer.test.ts`

Expected: FAIL because the installer module does not exist.

- [ ] **Step 3: Implement storage layout and staging**

```ts
export interface SkillStorageLayout {
  root: string;
  packagesRoot: string;
  activeRoot: string;
  stagingRoot: string;
}

export function createSkillStorageLayout(userDataPath: string): SkillStorageLayout {
  const root = join(userDataPath, "skills");
  return {
    root,
    packagesRoot: join(root, "packages"),
    activeRoot: join(root, "active"),
    stagingRoot: join(root, ".staging"),
  };
}
```

Copy files with exclusive creation into a random staging directory. Rename package and active projection atomically within the same filesystem. Keep a temporary backup of the old active projection until `finalize()` succeeds; `rollback()` must be idempotent.

Do not return `packagePath` or `activePath` from any renderer-facing DTO.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
npm test -- src/main/skills/skill-installer.test.ts src/main/skills/skill-validation.test.ts
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/main/skills/skill-installer.ts src/main/skills/skill-installer.test.ts
git commit -m "feat(skills): add atomic managed skill storage" -m $'## Changes\n\n- Store canonical skill versions under app-owned package storage.\n- Publish real active provider projections keyed by stable skill ID.\n- Add rollback and OpenCode autoinvoke projection coverage.'
```

---

### Task 3: Skill installation and invocation persistence

**Files:**

- Modify: `src/shared/db/schema.ts`
- Modify: `src/main/database/bootstrap.ts`
- Create: `src/main/skills/skill-repository.ts`
- Create: `src/main/skills/skill-repository.test.ts`
- Generate: `src/main/database/migrations/0008_*.sql`
- Generate: `src/main/database/migrations/meta/0008_snapshot.json`
- Modify generated: `src/main/database/migrations/meta/_journal.json` only through `npm run db:generate`

**Interfaces:**

- Produces: `SkillInstallationRecord`, `SkillInvocationRecord`, `SkillRepository`.
- Repository methods: `saveInstallation`, `setInstallationState`, `getInstallation`, `listInstallations`, `removeInstallation`, `startInvocation`, `transitionInvocation`, `listRunInvocations`.

- [ ] **Step 1: Add failing in-memory repository tests**

```ts
it("persists installation verification and invocation lifecycle", () => {
  repository.saveInstallation({
    skillId: "security-review",
    version: "1.0.0",
    sourceKind: "local",
    sourceRef: "local-import",
    contentDigest: "sha256:digest",
    codexCompatibility: "supported",
    opencodeCompatibility: "supported",
    automaticInvocation: true,
    state: "pending_verification",
  });
  repository.setInstallationState("security-review", "installed");
  const invocation = repository.startInvocation({
    runId: "run-1",
    skillId: "security-review",
    version: "1.0.0",
    mode: "explicit",
  });
  repository.transitionInvocation(invocation.id, "loaded");
  expect(repository.listRunInvocations("run-1")[0]).toMatchObject({ status: "loaded" });
});
```

Test legal transitions `requested -> loaded|failed`, rejection of terminal transitions, run cascade for invocations, and installation removal without deleting historical invocations.

- [ ] **Step 2: Add schema and bootstrap declarations**

Define `skill_installations` with explicit compatibility columns and `skill_invocations` with a run foreign key. Add indexes for state, run ID, skill ID, and unique installation ID. Mirror the tables in `bootstrapStatements` so in-memory tests and clean databases match Drizzle.

- [ ] **Step 3: Run repository test and verify RED**

Run: `npm test -- src/main/skills/skill-repository.test.ts`

Expected: FAIL because `SkillRepository` does not exist.

- [ ] **Step 4: Implement `SkillRepository` with prepared SQL**

Follow `CapabilityRepository` patterns: map rows into typed records, use transactions for installation replacement, use `randomUUID()` for invocation IDs, and never parse provider paths from stored JSON.

- [ ] **Step 5: Generate the migration**

Run: `npm run db:generate`

Expected: a new `0008_*.sql`, snapshot, and journal entry containing only the two skill tables and their indexes. Do not hand-edit these files.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
npm test -- src/main/skills/skill-repository.test.ts src/main/capabilities/capability-repository.test.ts
npm run typecheck
npm run lint
```

Expected: PASS, including unchanged capability persistence tests.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/shared/db/schema.ts src/main/database/bootstrap.ts src/main/database/migrations src/main/skills/skill-repository.ts src/main/skills/skill-repository.test.ts
git commit -m "feat(skills): persist installations and invocations" -m $'## Changes\n\n- Add dedicated skill installation and invocation tables.\n- Keep clean-database bootstrap SQL aligned with generated Drizzle artifacts.\n- Implement guarded repository transitions and historical invocation records.'
```

---

### Task 4: Skill service orchestration and safe lifecycle errors

**Files:**

- Create: `src/main/skills/skill-service.ts`
- Create: `src/main/skills/skill-service.test.ts`

**Interfaces:**

- Consumes: `SkillRepository`, storage transaction APIs, shared DTOs.
- Produces: `SkillRuntimeBridge` and `SkillService`.
- `SkillRuntimeBridge.syncCatalog({ activeRoot, skills })` synchronizes running providers.
- `SkillRuntimeBridge.invoke(runId, resolvedSkill, arguments, reasoningVariant)` sends one native skill turn.

- [ ] **Step 1: Write failing service tests**

Cover:

1. install publishes files, persists `pending_verification`, synchronizes providers, then marks `installed`;
2. database failure rolls storage back;
3. provider sync failure keeps the package but marks `invalid` with `skill_sync_failed`;
4. remove restores the record when provider synchronization fails;
5. invocation rejects stale version and incompatible agent before creating a turn;
6. successful invocation transitions `requested -> loaded`;
7. failed invocation transitions `requested -> failed` with a stable code.

```ts
it("rejects a stale explicit invocation before provider delegation", async () => {
  repository.saveInstallation(installedSkill({ version: "2.0.0" }));
  await expect(service.invokeSkill({
    runId: "run-1",
    skillId: "security-review",
    version: "1.0.0",
    arguments: "Review auth",
  })).rejects.toMatchObject({ code: "skill_version_changed" });
  expect(runtime.invoke).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run service tests and verify RED**

Run: `npm test -- src/main/skills/skill-service.test.ts`

Expected: FAIL because `SkillService` does not exist.

- [ ] **Step 3: Implement stable skill errors and DTO projection**

Define one error class or discriminated error factory with only:

- `skill_not_installed`;
- `skill_invalid`;
- `skill_incompatible`;
- `skill_sync_failed`;
- `skill_invocation_failed`;
- `skill_version_changed`.

`listSkills()` and `getSkill()` derive paths internally and return DTOs without path fields. `installFromDirectory()` accepts a main-process path, not an IPC payload path.

- [ ] **Step 4: Implement compensation ordering**

For install: stage -> publish -> persist pending -> sync -> mark installed -> finalize backup. On persistence failure, rollback storage. On sync failure, keep recoverable files, mark invalid, restore the old active projection if updating, and rethrow a safe error.

For invocation: validate run agent kind/version -> insert requested -> native invoke -> loaded; on failure -> failed.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
npm test -- src/main/skills/skill-service.test.ts src/main/skills/skill-installer.test.ts src/main/skills/skill-repository.test.ts
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/main/skills/skill-service.ts src/main/skills/skill-service.test.ts
git commit -m "feat(skills): orchestrate secure skill lifecycle" -m $'## Changes\n\n- Coordinate storage, persistence, provider synchronization, and rollback.\n- Validate version and compatibility before native invocation.\n- Surface stable safe errors without leaking managed paths.'
```

---

### Task 5: Codex native skill discovery and explicit invocation

**Files:**

- Modify: `src/main/coding-agents/types.ts`
- Modify: `src/main/coding-agents/codex-adapter.ts`
- Modify: `src/main/coding-agents/codex-adapter.test.ts`

**Interfaces:**

- Produces on `CodingAgentAdapter`: optional `configureSkills(catalog)` and `verifySkills(directory, expectedIds)` methods.
- Changes `sendPrompt` input to the discriminated `CodingAgentTurnInput` defined in Task 1/this task.
- Codex implementation uses `skills/extraRoots/set`, `skills/list`, and `UserInput { type: "skill", name, path }`.

- [ ] **Step 1: Add failing Codex tests**

```ts
it("registers the managed root and verifies expected skill IDs", async () => {
  const { adapter, client } = createAdapter();
  client.reply("skills/extraRoots/set", {});
  client.reply("skills/list", {
    data: [{ cwd: "/repo", skills: [{
      name: "security-review",
      description: "Review security",
      path: "/managed/active/security-review/SKILL.md",
      scope: "user",
      enabled: true,
      pluginId: null,
    }], errors: [] }],
  });
  await adapter.configureSkills({
    activeRoot: "/managed/active",
    expectedIds: ["security-review"],
  });
  expect(client.requestFor("skills/extraRoots/set").params).toEqual({
    extraRoots: ["/managed/active"],
  });
});

it("sends one native skill input and optional arguments in one turn", async () => {
  client.reply("turn/start", { turn: { id: "turn-1" } });
  await adapter.sendPrompt("/repo", "thread-1", {
    providerId: "openai",
    modelId: "gpt-5.4",
    explicitSkill: {
      id: "security-review",
      name: "security-review",
      path: "/managed/active/security-review/SKILL.md",
      arguments: "Review authentication",
    },
  });
  expect(client.requestFor("turn/start").params.input).toEqual([
    { type: "skill", name: "security-review", path: "/managed/active/security-review/SKILL.md" },
    { type: "text", text: "Review authentication", text_elements: [] },
  ]);
});
```

Also test empty arguments, list errors, missing IDs, duplicate IDs, and ordinary turns remaining byte-for-byte unchanged.

- [ ] **Step 2: Run Codex tests and verify RED**

Run: `npm test -- src/main/coding-agents/codex-adapter.test.ts`

Expected: FAIL because native skill APIs and the discriminated turn input are absent.

- [ ] **Step 3: Extend the adapter contract without provider leakage**

Add main-only types:

```ts
export interface CodingAgentSkillCatalog {
  activeRoot: string;
  expectedIds: string[];
}

export type CodingAgentTurnInput = {
  providerId: string;
  modelId: string;
  reasoningVariant?: string;
} & (
  | { content: string; explicitSkill?: never }
  | { content?: never; explicitSkill: ResolvedCodingAgentSkill }
);
```

- [ ] **Step 4: Implement Codex synchronization and turn construction**

Store the configured catalog in `CodexAdapter`; reapply it after `client.start()` and coordinated restart/resume. `verifySkills` calls `skills/list({ cwds: [directory], forceReload: true })`, rejects protocol errors, and compares exact enabled IDs and expected managed paths.

Build the `turn/start.input` array from the union without introducing hidden text markers.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
npm test -- src/main/coding-agents/codex-adapter.test.ts
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/main/coding-agents/types.ts src/main/coding-agents/codex-adapter.ts src/main/coding-agents/codex-adapter.test.ts
git commit -m "feat(skills): integrate Codex native skills" -m $'## Changes\n\n- Register and verify app-managed skill roots through Codex app-server.\n- Send explicit skills as native turn inputs with optional arguments.\n- Preserve existing MCP and ordinary prompt behavior.'
```

---

### Task 6: OpenCode native skill discovery and explicit invocation

**Files:**

- Modify: `src/main/coding-agents/opencode-capability-config.ts`
- Modify: `src/main/coding-agents/opencode-capability-config.test.ts`
- Modify: `src/main/coding-agents/opencode-adapter.ts`
- Modify: `src/main/coding-agents/opencode-adapter.test.ts`

**Interfaces:**

- Consumes: `CodingAgentSkillCatalog`, `CodingAgentTurnInput` from Task 5.
- `buildOpenCodeRuntimeConfig(connections, skillCatalog?)` adds a trusted `skills` root and native skill permission while preserving MCP profile isolation.
- Explicit invocation calls `session.command`, never `promptAsync` with an encoded slash command.

- [ ] **Step 1: Add failing runtime-config tests**

```ts
expect(buildOpenCodeRuntimeConfig([connection], {
  activeRoot: "/managed/active",
  expectedIds: ["security-review"],
})).toMatchObject({
  skills: ["/managed/active"],
  agent: {
    aw_run_1: {
      permission: {
        bash: "ask",
        skill: "allow",
        "aw_*": "deny",
        "aw_run_1_*": "allow",
      },
    },
  },
});
```

Use the exact MCP tool permission key already generated by `normalizeOpenCodeIdentifier`; do not weaken the existing `aw_*` deny rule.

- [ ] **Step 2: Add failing explicit-command tests**

Inject a fake OpenCode client and assert:

```ts
expect(client.session.command).toHaveBeenCalledWith({
  path: { id: "session-1" },
  query: { directory: "/repo" },
  body: {
    command: "security-review",
    arguments: "Review authentication",
    agent: "aw_run_1",
    model: "provider/model",
  },
  throwOnError: true,
});
```

Also assert ordinary input still uses `promptAsync`, empty arguments become `""`, and commands are rejected during capability reload.

- [ ] **Step 3: Run OpenCode tests and verify RED**

Run:

```bash
npm test -- src/main/coding-agents/opencode-capability-config.test.ts src/main/coding-agents/opencode-adapter.test.ts
```

Expected: FAIL because skill configuration and command dispatch are absent.

- [ ] **Step 4: Implement skill root configuration**

Persist the catalog in `OpenCodeAdapter` before launch. Pass it into `OPENCODE_CONFIG_CONTENT` on every start/restart. The root is selected by the main process and must not be read from environment input or renderer payloads.

- [ ] **Step 5: Implement explicit native command and verification**

Use `session.command` for explicit turns. Verify discovery with `this.v2Client.skill.list({ location: { directory } })`, compare exact path-derived IDs with `expectedIds`, and reject duplicate or missing IDs. If the running version does not expose this endpoint reliably, fail feature detection with `skill_sync_failed`; do not infer support from a successful process start.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
npm test -- src/main/coding-agents/opencode-capability-config.test.ts src/main/coding-agents/opencode-adapter.test.ts
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/main/coding-agents/opencode-capability-config.ts src/main/coding-agents/opencode-capability-config.test.ts src/main/coding-agents/opencode-adapter.ts src/main/coding-agents/opencode-adapter.test.ts
git commit -m "feat(skills): integrate OpenCode native skills" -m $'## Changes\n\n- Add the managed skill root to isolated OpenCode runtime configuration.\n- Invoke explicit skills through the native session command API.\n- Preserve capability reload guards and shell approval policy.'
```

---

### Task 7: Coding-agent skill catalog bridge and structured turn delivery

**Files:**

- Modify: `src/main/coding-agents/coding-agent-service.ts`
- Modify: `src/main/coding-agents/coding-agent-service.test.ts`

**Interfaces:**

- Produces: `configureCodingAgentSkillCatalog(catalog | null): Promise<void>`.
- Changes: `sendAgentMessage(runId, turn, reasoningVariant?)`, where `turn` is `{ content } | { explicitSkill }`.
- `SkillService` receives these functions through `SkillRuntimeBridge`; it does not import adapter instances.

- [ ] **Step 1: Add failing bridge tests**

Test that configuring a catalog stores it before providers start, synchronizes already-running adapters, and reuses it after restart. Test ordinary and explicit send variants separately.

```ts
await sendAgentMessage("run-1", {
  explicitSkill: {
    id: "security-review",
    name: "security-review",
    path: "/managed/active/security-review/SKILL.md",
    arguments: "Review auth",
  },
});
expect(adapter.sendPrompt).toHaveBeenCalledWith(
  worktreePath,
  externalSessionId,
  expect.objectContaining({ explicitSkill: expect.objectContaining({ id: "security-review" }) }),
);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/main/coding-agents/coding-agent-service.test.ts`

Expected: FAIL because the skill catalog bridge and union send input are absent.

- [ ] **Step 3: Implement process-wide catalog configuration**

Keep one trusted catalog value in the coding-agent service. Configure both harness adapters through optional `configureSkills`. `ensureStarted` must configure/verify skills before creating or resuming a user turn.

This catalog is process-wide because the first runtime exposes all installed skills. Do not couple it to per-session MCP profiles.

- [ ] **Step 4: Implement structured send semantics**

For ordinary turns, keep current prompt persistence and adapter payload behavior. For skill turns, persist `arguments ?? "/skill:<id>"` as the run's first visible prompt and pass only the structured skill variant to the adapter.

Reject skill sends while the coding agent is reconfiguring. Preserve existing model/reasoning validation.

- [ ] **Step 5: Run focused regression tests and typecheck**

Run:

```bash
npm test -- src/main/coding-agents/coding-agent-service.test.ts src/main/coding-agents/codex-adapter.test.ts src/main/coding-agents/opencode-adapter.test.ts
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit Task 7**

```bash
git add src/main/coding-agents/coding-agent-service.ts src/main/coding-agents/coding-agent-service.test.ts
git commit -m "feat(skills): bridge skill catalogs to coding agents" -m $'## Changes\n\n- Synchronize one trusted installed-skill catalog across provider harnesses.\n- Deliver ordinary and explicit skill turns through a strict union.\n- Preserve existing capability profiles and session lifecycle behavior.'
```

---

### Task 8: Authenticated skill IPC, preload API, and main-process initialization

**Files:**

- Create: `src/main/ipc/skill-handlers.ts`
- Create: `src/main/ipc/skill-handlers.test.ts`
- Modify: `src/shared/ipc/channels.ts`
- Modify: `src/shared/ipc/schemas.ts`
- Modify: `src/shared/ipc/schemas.test.ts`
- Modify: `src/shared/ipc/api.ts`
- Modify: `src/preload.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main.ts`
- Modify: `src/main-lifecycle.test.ts`

**Interfaces:**

- Adds channels: `SKILL_LIST`, `SKILL_GET`, `SKILL_INSTALL`, `SKILL_REMOVE`, `SKILL_CHANGED`.
- Adds `window.api.skills.list/get/install/remove/onChanged`.
- `skills.install()` accepts no path; the main process opens an `openDirectory` dialog.
- `SkillService.invokeSkill` owns explicit validation/persistence and delegates native send.

- [ ] **Step 1: Add failing IPC schema tests**

Assert that the send schema accepts ordinary or explicit variants and strips unknown response fields such as managed paths. Assert remove/get accept only a skill ID. Define install as `z.object({}).strict()` and assert it rejects renderer-supplied paths instead of silently stripping them. Define `marketplaceItemSchema` here as a union of the existing capability summary and the new skill summary.

- [ ] **Step 2: Add failing handler tests**

```ts
it("opens a main-owned folder picker and never accepts a renderer path", async () => {
  const chooseDirectory = vi.fn().mockResolvedValue("/chosen/skill");
  const service = { installFromDirectory: vi.fn().mockResolvedValue(detail) };
  const handlers = createSkillHandlers(service as never, { chooseDirectory });
  await handlers.install({});
  expect(service.installFromDirectory).toHaveBeenCalledWith("/chosen/skill");
  await expect(handlers.install({ path: "/renderer/path" })).rejects.toThrow();
});
```

- [ ] **Step 3: Run IPC tests and verify RED**

Run:

```bash
npm test -- src/shared/ipc/schemas.test.ts src/main/ipc/skill-handlers.test.ts
```

Expected: FAIL because skill channels and handlers are missing.

- [ ] **Step 4: Implement shared/preload contracts**

Parse every response again in preload using the shared skill schemas. `onChanged` parses a bounded invalidation DTO containing only `skillId`, event kind, and timestamp.

- [ ] **Step 5: Implement authenticated main handlers**

Use `BrowserWindow.getFocusedWindow()` and `dialog.showOpenDialog({ properties: ["openDirectory"] })`, matching existing repository import behavior. Register every channel with `requireAuthenticated`. Return `null` on canceled install.

Route the skill variant of `CODING_AGENT_SESSION_SEND` to `SkillService.invokeSkill`; route the ordinary variant to `sendAgentMessage`. Keep the handler thin.

- [ ] **Step 6: Initialize and reconcile skills in `main.ts`**

Construct layout from `app.getPath("userData")`, repository, installer, and service after `initDatabase()`. Inject:

- `getAgentKind` and agent version lookup;
- `configureCodingAgentSkillCatalog`;
- native skill send callback;
- safe logging callback.

Call `reconcileSkills()` before coding-agent discovery and dispose subscriptions during app shutdown. Do not read environment variables for the managed root.

- [ ] **Step 7: Run backend tests and typecheck**

Run:

```bash
npm test -- src/shared/ipc/schemas.test.ts src/main/ipc/skill-handlers.test.ts src/main-lifecycle.test.ts
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 8: Commit Task 8**

```bash
git add src/main/ipc/skill-handlers.ts src/main/ipc/skill-handlers.test.ts src/shared/ipc src/preload.ts src/main/ipc/index.ts src/main.ts src/main-lifecycle.test.ts
git commit -m "feat(skills): expose secure skill IPC" -m $'## Changes\n\n- Add authenticated list, detail, install, remove, and change channels.\n- Keep folder selection and managed paths inside the main process.\n- Initialize and reconcile the skill runtime during Electron startup.'
```

---

### Task 9: Marketplace aggregation with distinct Capability and Skill presentation

**Files:**

- Create: `src/renderer/features/marketplace/hooks/useMarketplace.ts`
- Create: `src/renderer/features/marketplace/hooks/useMarketplace.test.tsx`
- Create: `src/renderer/features/marketplace/components/MarketplaceRegistry.tsx`
- Create: `src/renderer/features/marketplace/components/MarketplaceRegistry.test.tsx`
- Create: `src/renderer/features/skills/components/SkillDetail.tsx`
- Create: `src/renderer/features/skills/components/SkillDetail.test.tsx`
- Create: `src/renderer/pages/Marketplace.tsx`
- Create: `src/renderer/pages/Marketplace.test.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/AppShell.tsx`
- Modify: `src/renderer/components/AppShell.visual.test.tsx`
- Modify: `src/renderer/features/capabilities/components/CapabilityPicker.tsx`
- Modify: `src/renderer/features/capabilities/components/CapabilityPicker.test.tsx`
- Delete after replacement: `src/renderer/pages/Capabilities.tsx`
- Delete after replacement: `src/renderer/pages/Capabilities.test.tsx`

**Interfaces:**

- Consumes: `MarketplaceItemDto`, capability API, skill API.
- Produces: `useMarketplace(runId?)` with combined items, selected detail, loading/error, capability actions, and skill install/remove actions.

- [ ] **Step 1: Add failing aggregation-hook tests**

Mock both APIs and assert one combined list with stable discriminants. Assert capability and skill change subscriptions trigger one coalesced refresh and cleanup independently.

- [ ] **Step 2: Add failing Marketplace tests**

Assert:

- `All`, `Capabilities`, `Skills` filters;
- visible `Capability` and `Skill` badges;
- skill detail has instruction preview and no permission ledger;
- capability detail still has permission ledger;
- install opens the skill API and remove asks for confirmation;
- empty search says `No marketplace items match.`.

- [ ] **Step 3: Run UI tests and verify RED**

Run:

```bash
npm test -- src/renderer/features/marketplace src/renderer/features/skills/components/SkillDetail.test.tsx src/renderer/pages/Marketplace.test.tsx
```

Expected: FAIL because the Marketplace files do not exist.

- [ ] **Step 4: Implement the combined hook and registry**

Use the shared union and branch on `item.kind`; do not create fake permissions or tools for skills. Reuse existing capability detail/setup components instead of copying their logic.

- [ ] **Step 5: Replace the route and navigation label**

Use `/marketplace` as the canonical route and keep:

```tsx
<Route path="/capabilities" element={<Navigate to="/marketplace" replace />} />
```

Update the AppShell label to `Marketplace`, full-bleed detection, and the CapabilityPicker link text to `Browse Marketplace`.

- [ ] **Step 6: Run UI tests, typecheck, lint, and package**

Run:

```bash
npm test -- src/renderer/features/marketplace src/renderer/features/skills/components/SkillDetail.test.tsx src/renderer/pages/Marketplace.test.tsx src/renderer/features/capabilities/components/CapabilityPicker.test.tsx src/renderer/components/AppShell.visual.test.tsx
npm run typecheck
npm run lint
npm run package
```

Expected: PASS and package completes.

- [ ] **Step 7: Commit Task 9**

```bash
git add src/renderer/App.tsx src/renderer/components/AppShell.tsx src/renderer/components/AppShell.visual.test.tsx src/renderer/features/marketplace src/renderer/features/skills/components/SkillDetail.tsx src/renderer/features/skills/components/SkillDetail.test.tsx src/renderer/features/capabilities/components/CapabilityPicker.tsx src/renderer/features/capabilities/components/CapabilityPicker.test.tsx src/renderer/pages
git commit -m "feat(marketplace): distinguish skills and capabilities" -m $'## Changes\n\n- Replace the Capability-only library with a shared Marketplace route.\n- Render Skill and Capability badges, filters, and type-specific details.\n- Preserve the previous route through a compatibility redirect.'
```

---

### Task 10: `/skill:` autocomplete and structured invocation chip

**Files:**

- Create: `src/renderer/features/coding-agent/lib/skill-commands.ts`
- Create: `src/renderer/features/coding-agent/lib/skill-commands.test.ts`
- Create: `src/renderer/features/skills/components/SkillCommandMenu.tsx`
- Create: `src/renderer/features/skills/components/SkillCommandMenu.test.tsx`
- Create: `src/renderer/features/skills/components/SkillInvocationChip.tsx`
- Create: `src/renderer/features/skills/components/SkillInvocationChip.test.tsx`
- Modify: `src/renderer/features/coding-agent/components/SessionComposer.tsx`
- Modify: `src/renderer/features/coding-agent/components/SessionComposer.test.tsx`

**Interfaces:**

- Produces: `findActiveSkillCommand(draft) -> { query, arguments } | undefined`.
- `SessionComposer` receives installed skills, controlled selected skill, `onSkillSelect`, `onSkillClear`, and a structured `onSend` callback.

- [ ] **Step 1: Add failing parser tests**

```ts
expect(findActiveSkillCommand("/skill:sec Review auth")).toEqual({
  query: "sec",
  arguments: "Review auth",
});
expect(findActiveSkillCommand("Please use /skill:sec")).toBeUndefined();
expect(findActiveSkillCommand("/skill: security")).toBeUndefined();
```

The parser activates only for the first token and returns the remainder exactly once as arguments.

- [ ] **Step 2: Add failing composer interaction tests**

Test filtering by ID/name, disabled incompatible rows, ArrowUp/ArrowDown, Enter/Tab selection, Escape dismissal, mouse selection, one chip maximum, chip removal, and file/slash palette priority.

```ts
fireEvent.change(textarea, { target: { value: "/skill:sec Review auth" } });
fireEvent.keyDown(textarea, { key: "Enter" });
expect(screen.getByRole("button", { name: "Remove Security Review skill" })).toBeTruthy();
expect(textarea.value).toBe("Review auth");
```

- [ ] **Step 3: Run composer tests and verify RED**

Run:

```bash
npm test -- src/renderer/features/coding-agent/lib/skill-commands.test.ts src/renderer/features/skills/components src/renderer/features/coding-agent/components/SessionComposer.test.tsx
```

Expected: FAIL because the parser, menu, and chip do not exist.

- [ ] **Step 4: Implement parsing and focused components**

Keep parsing in `skill-commands.ts`, list rendering in `SkillCommandMenu`, and chip rendering/removal in `SkillInvocationChip`. Do not add more branching directly to the already complex `SessionComposer` than the coordination required for palette priority.

- [ ] **Step 5: Integrate composer keyboard behavior**

Priority while a skill command is active:

1. Skill command menu;
2. existing slash commands;
3. file mentions;
4. ordinary Enter-to-send.

After selection, the textarea contains only arguments and the chip stores `{ id, version }`. Submission emits the skill union variant, never both fields.

- [ ] **Step 6: Run renderer tests, typecheck, lint, and package**

Run:

```bash
npm test -- src/renderer/features/coding-agent/lib/skill-commands.test.ts src/renderer/features/skills/components src/renderer/features/coding-agent/components/SessionComposer.test.tsx
npm run typecheck
npm run lint
npm run package
```

Expected: PASS.

- [ ] **Step 7: Commit Task 10**

```bash
git add src/renderer/features/coding-agent/lib/skill-commands.ts src/renderer/features/coding-agent/lib/skill-commands.test.ts src/renderer/features/skills/components/SkillCommandMenu.tsx src/renderer/features/skills/components/SkillCommandMenu.test.tsx src/renderer/features/skills/components/SkillInvocationChip.tsx src/renderer/features/skills/components/SkillInvocationChip.test.tsx src/renderer/features/coding-agent/components/SessionComposer.tsx src/renderer/features/coding-agent/components/SessionComposer.test.tsx
git commit -m "feat(skills): add explicit skill composer command" -m $'## Changes\n\n- Add `/skill:` parsing and accessible installed-skill autocomplete.\n- Represent one explicit skill as a removable structured chip.\n- Preserve existing slash-command and file-mention keyboard behavior.'
```

---

### Task 11: Session hook, successful-send semantics, and invocation timeline

**Files:**

- Modify: `src/renderer/features/coding-agent/hooks/useCodingAgentSession.ts`
- Create: `src/renderer/features/coding-agent/hooks/useCodingAgentSession.test.tsx`
- Modify: `src/renderer/features/coding-agent/views/CodingAgentSession.tsx`
- Modify: `src/renderer/features/coding-agent/views/CodingAgentSession.test.tsx`
- Modify: `src/shared/ipc/schemas.ts`
- Modify: `src/main/coding-agents/coding-agent-service.ts`
- Modify: `src/renderer/features/coding-agent/components/SessionMessages.tsx`
- Modify: `src/renderer/features/coding-agent/components/SessionMessages.test.tsx`

**Interfaces:**

- `useCodingAgentSession.send(turn)` returns `Promise<boolean>` and preserves selected skill/arguments after failure.
- Session snapshots include safe `skillInvocations` with no paths or full skill content.
- Timeline renders `Requested`, `Loaded`, or `Failed` only from persisted or provider-confirmed status.

- [ ] **Step 1: Inspect and preserve pre-existing local edits**

Run:

```bash
git status --short
git diff -- src/renderer/features/coding-agent/components/SessionMessages.tsx src/renderer/features/coding-agent/components/SessionMessages.test.tsx
```

Expected: understand and preserve any user changes before editing these known-overlap files. Do not reset, stash, or overwrite them.

- [ ] **Step 2: Add failing hook/view tests**

Assert the hook loads `window.api.skills.list()`, subscribes once, sends the exact union, returns `true` on accepted send, returns `false` on error, and does not clear the selected chip on failure.

- [ ] **Step 3: Add failing timeline tests**

```tsx
render(
  <SessionMessages
    agentName="Codex"
    messages={[]}
    busy={false}
    skillInvocations={[
      { id: "inv-1", skillId: "security-review", name: "Security Review", version: "1.0.0", mode: "explicit", status: "loaded", requestedAt: new Date(0).toISOString() },
    ]}
  />,
);
expect(screen.getByText("Loaded skill: Security Review")).toBeTruthy();
```

Repeat with `requested` and `failed` fixtures and assert their exact copy.

Do not create `loaded` UI from an inferred file-read event.

- [ ] **Step 4: Run focused tests and verify RED**

Run:

```bash
npm test -- src/renderer/features/coding-agent/hooks/useCodingAgentSession.test.tsx src/renderer/features/coding-agent/views/CodingAgentSession.test.tsx src/renderer/features/coding-agent/components/SessionMessages.test.tsx
```

Expected: FAIL because skill state and invocation snapshot data are absent.

- [ ] **Step 5: Expose safe invocation snapshots**

Extend the existing capability bridge pattern or add a focused skill bridge method `listSessionSkillInvocations(runId)`. Project only ID, name, version, mode, status, error code, and timestamps into shared schemas.

- [ ] **Step 6: Implement controlled selection and send clearing**

Keep selected skill state in `CodingAgentSession`. Clear draft and chip only after `send()` resolves `true`; preserve both on failure. Disable submission while a provider catalog synchronization is in progress, but do not tie it to capability MCP reload state unless both are active.

- [ ] **Step 7: Render honest timeline states**

Use persisted explicit invocation records. Add provider-confirmed automatic records only when an adapter emits a reliable normalized event; otherwise omit automatic timeline entries.

- [ ] **Step 8: Run renderer/backend tests, typecheck, lint, and package**

Run:

```bash
npm test -- src/renderer/features/coding-agent/hooks/useCodingAgentSession.test.tsx src/renderer/features/coding-agent/views/CodingAgentSession.test.tsx src/renderer/features/coding-agent/components/SessionMessages.test.tsx src/main/coding-agents/coding-agent-service.test.ts
npm run typecheck
npm run lint
npm run package
```

Expected: PASS.

- [ ] **Step 9: Commit Task 11 without staging unrelated user files**

```bash
git add src/renderer/features/coding-agent/hooks/useCodingAgentSession.ts src/renderer/features/coding-agent/hooks/useCodingAgentSession.test.tsx src/renderer/features/coding-agent/views/CodingAgentSession.tsx src/renderer/features/coding-agent/views/CodingAgentSession.test.tsx src/shared/ipc/schemas.ts src/main/coding-agents/coding-agent-service.ts
git add -p -- src/renderer/features/coding-agent/components/SessionMessages.tsx src/renderer/features/coding-agent/components/SessionMessages.test.tsx
```

At the interactive prompt, stage only skill-specific hunks. Verify with `git diff --cached` that pre-existing user hunks are not included, then commit:

```bash
git commit -m "feat(skills): surface structured skill turns" -m $'## Changes\n\n- Load installed skills into coding-agent sessions and preserve failed drafts.\n- Project safe invocation state into session snapshots.\n- Render requested, confirmed, and failed skill timeline events honestly.'
```

---

### Task 12: Real-provider smoke harness, authoring guide, and full verification

**Files:**

- Modify: `package.json`
- Create: `scripts/skill-smoke/driver.mjs`
- Create: `scripts/skill-smoke/driver.test.ts`
- Create: `scripts/skill-smoke/run.mjs`
- Create: `scripts/skill-smoke/run.test.ts`
- Create: `scripts/skill-smoke/fixtures/deterministic-review/SKILL.md`
- Create: `docs/capabilities/authoring-skills.md`
- Modify: `docs/capabilities/2026-09-01-skills-runtime-design.md` only for verified final provider minimums

**Interfaces:**

- Adds npm scripts `smoke:skills`, `smoke:skills:codex`, and `smoke:skills:opencode`.
- Reuses packaged Electron driver patterns without logging prompts or full skill bodies.

- [ ] **Step 1: Write failing smoke-runner unit tests**

Cover version parsing, missing configured provider, canceled install, explicit scenario, automatic scenario, coexistence with Web Search, and log redaction.

The deterministic fixture description must make relevance unambiguous and its body must require a stable marker such as `AW_SKILL_DETERMINISTIC_REVIEW` without requesting file or command execution.

- [ ] **Step 2: Run smoke unit tests and verify RED**

Run: `npm test -- scripts/skill-smoke`

Expected: FAIL because the harness does not exist.

- [ ] **Step 3: Implement the driver and scenarios**

Driver operations:

- launch packaged Electron;
- list configured agents and versions;
- temporarily replace `dialog.showOpenDialog` inside the owned Electron main process via Playwright `electronApplication.evaluate`, invoke the normal pathless `window.api.skills.install()` call, and restore the original dialog function immediately afterward;
- create a session;
- send explicit structured invocation;
- send a clearly relevant ordinary prompt for automatic invocation;
- wait for idle;
- read safe snapshots;
- remove the skill;
- inspect redacted process logs;
- close only the owned Electron process.

Do not use broad process termination.

- [ ] **Step 4: Add authoring documentation**

Document exact supported frontmatter, directory layout, text-only restrictions, `disable-model-invocation`, Marketplace installation, `/skill:<id>`, compatibility verification, and focused local commands.

- [ ] **Step 5: Run all static and automated verification**

Run in this order:

```bash
npm run typecheck
npm run lint
npm test
npm run package
```

Expected: every command exits 0.

- [ ] **Step 6: Run project-wide diagnostics**

Run `lens_diagnostics` with `mode=all`. Fix all blocking errors introduced by files edited on this branch. Then run `lens_diagnostics` with `mode=full`, bounded to the changed source and test paths if the project-wide scan is too expensive.

Expected: no blocking diagnostics attributable to the implementation.

- [ ] **Step 7: Run opt-in real provider smokes**

With `AW_SMOKE_EXECUTABLE` set to the packaged executable and verified local Codex/OpenCode installations:

```bash
npm run smoke:skills:codex
npm run smoke:skills:opencode
```

Expected: explicit invocation, automatic invocation, removal refresh, and MCP coexistence pass. Record the observed versions in `authoring-skills.md` and update the design's minimums only from this evidence.

- [ ] **Step 8: Review the final diff for secrets and artifacts**

Run:

```bash
git status --short
git diff --check
git diff --name-only --cached
git diff --name-only
```

Confirm `.env`, databases, package output, logs, coverage, skill staging data, and `graphify-out/` are not staged.

- [ ] **Step 9: Commit Task 12**

```bash
git add package.json package-lock.json scripts/skill-smoke docs/capabilities/authoring-skills.md docs/capabilities/2026-09-01-skills-runtime-design.md
git commit -m "test(skills): verify native provider compatibility" -m $'## Changes\n\n- Add deterministic explicit and automatic skill smoke scenarios.\n- Document supported Agent Skill authoring and security constraints.\n- Record provider compatibility only from packaged real-agent verification.'
```

---

## Final Completion Gate

Before declaring implementation complete, verify every statement below with fresh command output:

- [ ] `git branch --show-current` prints `feat/skills-runtime`.
- [ ] Every task commit contains only its declared files plus generated migration metadata.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run lint` exits 0.
- [ ] `npm test` exits 0.
- [ ] `npm run package` exits 0.
- [ ] Codex explicit and automatic skill smoke scenarios pass on the recorded minimum version.
- [ ] OpenCode explicit and automatic skill smoke scenarios pass on the recorded minimum version.
- [ ] A session can use an MCP capability and a skill together.
- [ ] Renderer IPC never receives a managed path or full skill body outside the sanitized detail preview.
- [ ] Unsafe package fixtures are generated only in temporary test directories and are not committed.
- [ ] Existing uncommitted user changes remain present and unmodified unless they were explicitly integrated in Task 11.
