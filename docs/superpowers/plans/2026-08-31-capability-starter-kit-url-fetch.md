# Capability Starter Kit and URL Fetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an extraction-ready local capability generator and a bundled, SSRF-safe `fetch_url` capability verified through the existing Codex and OpenCode capability lifecycle.

**Architecture:** A repository-local CLI delegates generation to a reusable core and a repository-specific adapter that updates the reviewed metadata and executable registries separately. URL Fetch remains a provider-neutral SDK package: a policy layer validates public destinations, a pinned Node HTTP transport enforces that policy across redirects, and a static parser produces bounded attributed text. Existing capability configuration and smoke seams become generic enough to support both Web Search and settings-free capabilities without introducing dynamic package loading.

**Tech Stack:** TypeScript 5.9, Node 22 `http`/`https`/`dns`, Electron utility processes, React 19, Zod 4, Vitest 4, Playwright Electron, MCP SDK, `tsx`, `ipaddr.js`, `htmlparser2`, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-31-capability-starter-kit-url-fetch-design.md`

## Global Constraints

- Use `npm` exclusively for dependency and project commands.
- Keep all network, filesystem, credential, process, and capability execution in the Electron main/utility-process side; the renderer receives typed DTOs only.
- Keep metadata registration in `src/main/capabilities/catalog.ts` separate from executable registration in `src/main/capabilities/host-registry.ts`.
- Do not discover packages dynamically from `capabilities/*` and do not resolve renderer-provided module paths.
- The generator must never overwrite a pre-existing package or leave partial registry changes after a failed write.
- Generated manifests start with Codex and OpenCode compatibility set to `unsupported`.
- URL Fetch supports only HTTP/HTTPS on default ports, with no credentials, cookies, custom headers, proxies, browser execution, or JavaScript rendering.
- URL Fetch accepts only `text/html`, `text/plain`, and `application/json`.
- Enforce a 15-second overall deadline, five redirects, a 2 MiB downloaded-body cap, and the SDK output cap of 50 KiB/2,000 lines.
- Reject localhost, private, link-local, non-global, mixed public/private DNS answers, unsafe redirects, DNS rebinding, and HTTPS-to-HTTP downgrade.
- Use `ipaddr.js` for IP classification and `htmlparser2` for static HTML parsing; keep both dependencies local to the URL Fetch workspace.
- Preserve the optional encrypted Web Search secret and all existing capability rollback/recovery behavior while generalizing configuration.
- Real Codex/OpenCode smoke tests stay opt-in and outside normal CI.
- Follow TDD for every behavioral change: observe the focused test fail before writing production code.
- Run `npm run typecheck` after each TypeScript task and run the renderer/package verification after UI, routing, or styling changes.

---

## Planned File Structure

### Capability configuration foundation

- Create `src/main/capabilities/capability-configuration.ts` — validate manifest-driven public settings and secret mutations.
- Create `src/main/capabilities/capability-configuration.test.ts` — focused validation/default/secret tests.
- Modify `src/shared/ipc/schemas.ts` — replace Web Search-specific configuration input with bounded generic settings and secrets.
- Modify `src/shared/ipc/schemas.test.ts` — prove generic input acceptance and secret stripping.
- Modify `src/main/capabilities/capability-service.ts` — delegate configuration preparation and remove the Exa-specific main-process probe.
- Modify `src/main/capabilities/capability-service.test.ts` — verify generic Web Search configuration, secret retention/removal, and settings-free configuration after URL Fetch exists.

### Generic setup UI and permission presentation

- Create `src/renderer/features/capabilities/lib/capability-form.ts` — derive initial values and typed configure requests from `CapabilityDetailDto`.
- Create `src/renderer/features/capabilities/lib/capability-form.test.ts` — pure form/request tests.
- Modify `src/renderer/features/capabilities/components/CapabilitySetupDialog.tsx` — render manifest-driven string, integer, boolean, and secret settings.
- Modify `src/renderer/features/capabilities/components/CapabilitySetupDialog.test.tsx` — cover Web Search and a settings-free capability.
- Modify `src/renderer/features/capabilities/components/CapabilityDetail.tsx` — label `public-web` clearly.
- Modify `src/renderer/pages/Capabilities.test.tsx` and `src/renderer/features/capabilities/components/CapabilityPicker.test.tsx` — preserve library and chat setup behavior.

### SDK permission and reviewed registries

- Modify `packages/capability-sdk/src/schema.ts` — validate exact-host and reserved `public-web` network declarations.
- Modify `packages/capability-sdk/src/schema.test.ts` — cover accepted and rejected network declarations.
- Modify `packages/capability-sdk/src/index.ts` — export the reserved permission constant from `schema.ts`.
- Modify `src/main/capabilities/catalog.ts` — make manifests generic, add deterministic generator markers, and expose a reusable entry helper.
- Modify `src/main/capabilities/catalog.test.ts` — verify immutable Web Search behavior before generated URL Fetch registration.
- Modify `src/main/capabilities/host-registry.ts` — add deterministic executable registration markers.
- Create `src/main/capabilities/host-registry.test.ts` — verify explicit hosted IDs and unknown lookup behavior.

### Local Starter Kit

- Create `scripts/capability-kit/types.ts` — generator names, options, filesystem port, and result types.
- Create `scripts/capability-kit/naming.ts` and `naming.test.ts` — deterministic names and validation.
- Create `scripts/capability-kit/templates/index.ts` and `templates.test.ts` — generic package rendering.
- Create `scripts/capability-kit/repository-registration.ts` and `repository-registration.test.ts` — deterministic marker patching.
- Create `scripts/capability-kit/create-capability.ts` and `create-capability.test.ts` — staged writes, rollback, and path containment.
- Create `scripts/capability-kit/cli.ts` and `cli.test.ts` — command parsing and exit behavior.
- Modify `package.json` and `package-lock.json` — add `tsx` and the `capability:create` command.

### URL Fetch package

- Create `capabilities/url-fetch/package.json`.
- Create `capabilities/url-fetch/src/manifest.ts`.
- Create `capabilities/url-fetch/src/url-policy.ts` and `url-policy.test.ts`.
- Create `capabilities/url-fetch/src/transport.ts` and `transport.test.ts`.
- Create `capabilities/url-fetch/src/html-to-text.ts` and `html-to-text.test.ts`.
- Create `capabilities/url-fetch/src/index.ts` and `index.test.ts`.
- Modify `src/main/capabilities/catalog.ts` and `host-registry.ts` through the generator's repository adapter.
- Modify catalog, host, service, renderer, and adapter tests for the second bundled capability.

### Reusable smoke harness and documentation

- Create `scripts/capability-smoke/driver.mjs`.
- Create `scripts/capability-smoke/run.mjs`.
- Create `scripts/capability-smoke/web-search-scenario.mjs`.
- Create `scripts/capability-smoke/url-fetch-scenario.mjs`.
- Create focused tests under `scripts/capability-smoke/*.test.ts`.
- Delete `scripts/smoke-capability-web-search.mjs`, `scripts/smoke-capability-web-search.test.ts`, and `scripts/lib/electron-capability-smoke-driver.mjs` after equivalent coverage moves.
- Modify `package.json` smoke scripts.
- Modify `docs/capabilities/authoring-capabilities.md`.

---

### Task 1: Generalize Capability Configuration in IPC and Main Process

**Files:**
- Create: `src/main/capabilities/capability-configuration.ts`
- Create: `src/main/capabilities/capability-configuration.test.ts`
- Modify: `src/shared/ipc/schemas.ts: capabilityConfigureRequestSchema`
- Modify: `src/shared/ipc/schemas.test.ts: capability IPC schemas`
- Modify: `src/main/capabilities/capability-service.ts: CapabilityServiceDependencies, configureCapability`
- Modify: `src/main/capabilities/capability-service.test.ts`

**Interfaces:**
- Consumes: `CapabilityManifest`, `CapabilitySettingRecord`, and `CapabilityConfigureRequest`.
- Produces:

```ts
export interface PreparedSecretChange {
  key: string;
  value: string | null | undefined;
  existingRef?: string;
}

export interface PreparedCapabilityConfiguration {
  values: CapabilitySettingRecord[];
  secrets: PreparedSecretChange[];
}

export function prepareCapabilityConfiguration(
  manifest: CapabilityManifest,
  input: Pick<CapabilityConfigureRequest, "settings" | "secrets">,
  existing: readonly CapabilitySettingRecord[],
): PreparedCapabilityConfiguration;
```

`undefined` secret input means retain an existing reference, a string means store/replace it, and `null` means remove it.

- [ ] **Step 1: Write failing generic IPC schema tests**

Add tests proving a bounded generic request is accepted and arbitrary top-level secret fields are stripped:

```ts
expect(capabilityConfigureRequestSchema.parse({
  capabilityId: "agentic-worktrees.web-search",
  acceptedPermissionDigest: "digest",
  settings: { providerMode: "auto", resultLimit: 5 },
  secrets: { exaApiKey: null },
  bearerToken: "must-not-cross-ipc",
})).toEqual({
  capabilityId: "agentic-worktrees.web-search",
  acceptedPermissionDigest: "digest",
  settings: { providerMode: "auto", resultLimit: 5 },
  secrets: { exaApiKey: null },
});

expect(() => capabilityConfigureRequestSchema.parse({
  capabilityId: "agentic-worktrees.url-fetch",
  acceptedPermissionDigest: "digest",
  settings: { nested: { unsafe: true } },
  secrets: {},
})).toThrow();
```

- [ ] **Step 2: Run the IPC schema test and verify it fails**

Run:

```bash
npm test -- src/shared/ipc/schemas.test.ts
```

Expected: FAIL because the current schema requires `providerMode`/`resultLimit` and has no generic `secrets` object.

- [ ] **Step 3: Replace the Web Search-specific request schema**

Use bounded scalar records:

```ts
const capabilitySettingValueSchema = z.union([
  z.string().max(4_096),
  z.number().finite(),
  z.boolean(),
]);
const capabilitySecretValueSchema = z.union([z.string().max(4_096), z.null()]);
const capabilityConfigurationKeySchema = z.string().regex(/^[a-z][A-Za-z0-9]{0,63}$/);

export const capabilityConfigureRequestSchema = z.object({
  capabilityId: capabilityIdSchema,
  acceptedPermissionDigest: z.string().min(1),
  settings: z.record(capabilityConfigurationKeySchema, capabilitySettingValueSchema),
  secrets: z.record(capabilityConfigurationKeySchema, capabilitySecretValueSchema).default({}),
});
```

Keep Zod's default object stripping so undeclared top-level fields never reach the service.

- [ ] **Step 4: Run the IPC schema test and verify it passes**

Run:

```bash
npm test -- src/shared/ipc/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing manifest-driven configuration tests**

Cover defaults, unknown keys, type/range/enum failures, optional secret retention, replacement, explicit removal, and required secrets:

```ts
expect(prepareCapabilityConfiguration(webSearchManifest, {
  settings: { providerMode: "auto", resultLimit: 7 },
  secrets: {},
}, [{ key: "exaApiKey", secretRef: "existing-ref" }])).toEqual({
  values: [
    { key: "providerMode", value: "auto" },
    { key: "resultLimit", value: 7 },
  ],
  secrets: [{ key: "exaApiKey", value: undefined, existingRef: "existing-ref" }],
});

expect(() => prepareCapabilityConfiguration(webSearchManifest, {
  settings: { providerMode: "auto", resultLimit: 21 },
  secrets: {},
}, [])).toThrow("resultLimit");

expect(() => prepareCapabilityConfiguration(webSearchManifest, {
  settings: { providerMode: "auto", resultLimit: 5, unknown: true },
  secrets: {},
}, [])).toThrow("Unknown capability setting");
```

Also define a test-only manifest with no settings and assert `{ settings: {}, secrets: {} }` produces empty arrays.

- [ ] **Step 6: Run the configuration helper test and verify it fails**

Run:

```bash
npm test -- src/main/capabilities/capability-configuration.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 7: Implement exact setting and secret validation**

For each manifest setting:

- string: require a string and enforce `enum`;
- integer: require `Number.isInteger` and enforce `min`/`max`;
- boolean: require a boolean;
- missing public setting: use `default`, reject when `required`, otherwise omit;
- secret: reject it from `settings`, read it only from `secrets`, retain omitted existing refs, remove on `null`, and reject missing required secrets;
- reject every input key absent from the manifest or present in the wrong public/secret record.

Throw only safe `CapabilityError` messages naming the manifest setting key, never its value.

- [ ] **Step 8: Run the helper tests and verify they pass**

Run:

```bash
npm test -- src/main/capabilities/capability-configuration.test.ts
```

Expected: PASS.

- [ ] **Step 9: Write failing service tests for generic secret persistence**

Update Web Search calls to use:

```ts
{
  capabilityId: id,
  acceptedPermissionDigest: permissionDigest(getBundledCapability(id).manifest),
  settings: { providerMode: "auto", resultLimit: 5 },
  secrets: {},
}
```

Change the explicit clear test to `secrets: { exaApiKey: null }`, then assert replacement compensation still removes a newly stored secret when repository persistence fails.

Remove assertions for the Exa availability warning; configuration must not perform provider-specific network calls from the main process.

- [ ] **Step 10: Run the service test and verify it fails**

Run:

```bash
npm test -- src/main/capabilities/capability-service.test.ts
```

Expected: FAIL because `configureCapability` still reads `input.exaApiKey`, persists hard-coded fields, and performs the Exa probe.

- [ ] **Step 11: Delegate service configuration to the new helper**

In `configureCapability`:

1. validate the permission digest;
2. call `prepareCapabilityConfiguration` with repository settings;
3. create or remove secrets through `CapabilityCredentialStore` according to each prepared change;
4. save public values and final secret references in one repository transaction;
5. compensate newly stored secrets if persistence fails;
6. remove replaced/cleared old references only after persistence succeeds;
7. return `getCapability(input.capabilityId)` without an Exa network probe.

Delete the optional `probe` dependency and the configuration-only `warningCode` branch. Keep existing activation rollback and host-setting projection unchanged.

- [ ] **Step 12: Run focused backend tests and typecheck**

Run:

```bash
npm test -- src/shared/ipc/schemas.test.ts src/main/capabilities/capability-configuration.test.ts src/main/capabilities/capability-service.test.ts
npm run typecheck
```

Expected: all commands PASS.

- [ ] **Step 13: Commit the generic configuration foundation**

```bash
git add src/shared/ipc/schemas.ts src/shared/ipc/schemas.test.ts src/main/capabilities/capability-configuration.ts src/main/capabilities/capability-configuration.test.ts src/main/capabilities/capability-service.ts src/main/capabilities/capability-service.test.ts
git commit -m "refactor(capabilities): generalize manifest configuration"
```

---

### Task 2: Make Capability Setup Manifest-Driven

**Files:**
- Create: `src/renderer/features/capabilities/lib/capability-form.ts`
- Create: `src/renderer/features/capabilities/lib/capability-form.test.ts`
- Modify: `src/renderer/features/capabilities/components/CapabilitySetupDialog.tsx`
- Modify: `src/renderer/features/capabilities/components/CapabilitySetupDialog.test.tsx`
- Modify: `src/renderer/features/capabilities/components/CapabilityDetail.tsx`
- Modify: `src/renderer/pages/Capabilities.test.tsx`
- Modify: `src/renderer/features/capabilities/components/CapabilityPicker.test.tsx`

**Interfaces:**
- Consumes: `CapabilityDetailDto` and generic `CapabilityConfigureRequest` from Task 1.
- Produces:

```ts
export type CapabilityFormValue = string | number | boolean;
export type CapabilityFormValues = Record<string, CapabilityFormValue>;

export function initialCapabilityFormValues(
  capability: CapabilityDetailDto,
): CapabilityFormValues;

export function capabilityConfigureRequest(
  capability: CapabilityDetailDto,
  values: CapabilityFormValues,
  secretValues: Record<string, string>,
  clearedSecrets: ReadonlySet<string>,
): CapabilityConfigureRequest;
```

- [ ] **Step 1: Write failing pure form tests**

Use a Web Search detail fixture and a settings-free URL Fetch fixture:

```ts
expect(initialCapabilityFormValues(webSearchDetail)).toEqual({
  providerMode: "auto",
  resultLimit: 5,
});

expect(capabilityConfigureRequest(urlFetchDetail, {}, {}, new Set())).toEqual({
  capabilityId: "agentic-worktrees.url-fetch",
  acceptedPermissionDigest: "url-digest",
  settings: {},
  secrets: {},
});

expect(capabilityConfigureRequest(
  webSearchDetail,
  { providerMode: "auto", resultLimit: 10 },
  { exaApiKey: "new-key" },
  new Set(),
).secrets).toEqual({ exaApiKey: "new-key" });
```

Add one test proving a cleared configured secret emits `{ exaApiKey: null }`, while an untouched blank secret is omitted.

- [ ] **Step 2: Run the pure form test and verify it fails**

Run:

```bash
npm test -- src/renderer/features/capabilities/lib/capability-form.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement form initialization and request construction**

Derive public values from each setting's declared default. For required strings without a default use `""`; for required integers use `min ?? 0`; for booleans use `default ?? false`. Never place secret values in the public values record.

Construct `settings` only from non-secret definitions and construct `secrets` only from secret definitions. Trim secret input only to detect emptiness; preserve the exact non-empty value sent to storage.

- [ ] **Step 4: Run the pure form test and verify it passes**

Run:

```bash
npm test -- src/renderer/features/capabilities/lib/capability-form.test.ts
```

Expected: PASS.

- [ ] **Step 5: Replace the hard-coded dialog test with generic interaction tests**

Assert that Web Search still renders:

- `providerMode` with `auto`;
- `resultLimit` as a bounded number;
- `exaApiKey` as a password;
- declared network permissions before acceptance.

Assert that URL Fetch renders no settings inputs, shows `Public HTTP/HTTPS internet`, and submits:

```ts
{
  capabilityId: "agentic-worktrees.url-fetch",
  acceptedPermissionDigest: "url-digest",
  settings: {},
  secrets: {},
}
```

- [ ] **Step 6: Run the dialog test and verify it fails**

Run:

```bash
npm test -- src/renderer/features/capabilities/components/CapabilitySetupDialog.test.tsx
```

Expected: FAIL because the component is Web Search-specific.

- [ ] **Step 7: Implement manifest-driven controls**

In `CapabilitySetupDialog`:

- reset public/secret/clear state whenever `capability.id` or `open` changes;
- render enum strings with a native accessible `<select>`;
- render unrestricted strings with `Input`;
- render integers with numeric `Input` and declared bounds;
- render booleans with an accessible checkbox;
- render secrets with password `Input` and an explicit clear action when `secretConfigured` is true;
- show a permission summary before the form;
- show “No additional settings are required.” for an empty settings list;
- use `capabilityConfigureRequest` for submission;
- replace Exa-specific failure copy with “Could not save capability configuration.”

Keep the existing dialog and button components and visible focus behavior.

- [ ] **Step 8: Add a shared permission display helper**

Add a local renderer helper in `capability-form.ts`:

```ts
export function capabilityNetworkPermissionLabel(permission: string): string {
  return permission === "public-web" ? "Public HTTP/HTTPS internet" : permission;
}
```

Use it in both `CapabilitySetupDialog` and `CapabilityDetail`. Do not change the DTO value or permission digest.

- [ ] **Step 9: Run capability UI tests and typecheck**

Run:

```bash
npm test -- src/renderer/features/capabilities
npm test -- src/renderer/pages/Capabilities.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit the generic setup UI**

```bash
git add src/renderer/features/capabilities/lib/capability-form.ts src/renderer/features/capabilities/lib/capability-form.test.ts src/renderer/features/capabilities/components/CapabilitySetupDialog.tsx src/renderer/features/capabilities/components/CapabilitySetupDialog.test.tsx src/renderer/features/capabilities/components/CapabilityDetail.tsx src/renderer/features/capabilities/components/CapabilityPicker.test.tsx src/renderer/pages/Capabilities.test.tsx
git commit -m "refactor(renderer): render capability setup from manifests"
```

---

### Task 3: Add the `public-web` Contract and Prepare Explicit Registries

**Files:**
- Modify: `packages/capability-sdk/src/schema.ts`
- Modify: `packages/capability-sdk/src/schema.test.ts`
- Modify: `packages/capability-sdk/src/index.ts`
- Modify: `src/main/capabilities/catalog.ts`
- Modify: `src/main/capabilities/catalog.test.ts`
- Modify: `src/main/capabilities/host-registry.ts`
- Create: `src/main/capabilities/host-registry.test.ts`

**Interfaces:**
- Produces:

```ts
export const PUBLIC_WEB_NETWORK_PERMISSION = "public-web" as const;

export function createBundledCapability(
  manifest: CapabilityManifest,
  toolNames: readonly string[],
): BundledCapability;
```

- Produces four exact insertion regions:
  - `capability-kit:catalog-imports`
  - `capability-kit:catalog-entries`
  - `capability-kit:host-imports`
  - `capability-kit:host-entries`

- [ ] **Step 1: Write failing SDK permission tests**

```ts
expect(() => validateCapabilityDefinition(defineCapability({
  manifest: { ...manifest, permissions: { network: ["public-web"], secrets: [] } },
  tools: [],
}))).not.toThrow();

for (const permission of ["https://example.com", "*.example.com", "Example.com", "example.com/path", "public-*", ""]) {
  expect(() => validateCapabilityDefinition(defineCapability({
    manifest: { ...manifest, permissions: { network: [permission], secrets: [] } },
    tools: [],
  }))).toThrow("network permission");
}
```

Also reject duplicate network permissions.

- [ ] **Step 2: Run the SDK schema test and verify it fails**

Run:

```bash
npm test -- packages/capability-sdk/src/schema.test.ts
```

Expected: FAIL because network permissions are not validated.

- [ ] **Step 3: Implement and export the reserved permission**

Use an exact lowercase hostname expression and the reserved token:

```ts
export const PUBLIC_WEB_NETWORK_PERMISSION = "public-web" as const;
const NETWORK_HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
```

In `validateCapabilityDefinition`, reject every network value that is neither `public-web` nor an exact host matching `NETWORK_HOST`, and reject duplicates. Export the constant through `index.ts`.

- [ ] **Step 4: Run the SDK schema test and verify it passes**

Run:

```bash
npm test -- packages/capability-sdk/src/schema.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing generic catalog and host-registry tests**

Assert the catalog manifest is typed and projected generically, Web Search remains frozen, host IDs are frozen, and unknown IDs return `undefined`:

```ts
expect(listHostedCapabilityIds()).toEqual(["agentic-worktrees.web-search"]);
expect(Object.isFrozen(listHostedCapabilityIds())).toBe(true);
expect(getHostedCapability("unknown.capability")).toBeUndefined();
```

- [ ] **Step 6: Run the registry tests and verify the new host test fails**

Run:

```bash
npm test -- src/main/capabilities/catalog.test.ts src/main/capabilities/host-registry.test.ts
```

Expected: FAIL because the host-registry test and generic helper do not exist.

- [ ] **Step 7: Refactor the catalog around explicit marker sections**

Use `CapabilityManifest` rather than `typeof webSearchManifest`:

```ts
export interface BundledCapability {
  readonly manifest: CapabilityManifest;
  readonly reviewStatus: "bundled-reviewed";
  readonly toolNames: readonly string[];
}

// capability-kit:catalog-imports:start
import { webSearchManifest } from "@agentic-worktrees/web-search-capability";
// capability-kit:catalog-imports:end

const bundledCapabilityEntries = [
  // capability-kit:catalog-entries:start
  createBundledCapability(webSearchManifest, ["web_search"]),
  // capability-kit:catalog-entries:end
] as const;
```

Make `permissionDigest` require an explicit `CapabilityManifest`; remove its Web Search default. Build the map from `bundledCapabilityEntries` and retain deep freezing and safe DTO projection.

- [ ] **Step 8: Add host registry marker sections**

```ts
// capability-kit:host-imports:start
import webSearchCapability from "@agentic-worktrees/web-search-capability";
// capability-kit:host-imports:end

const hostedCapabilities = [
  // capability-kit:host-entries:start
  webSearchCapability,
  // capability-kit:host-entries:end
] as const;

const registry = new Map<string, CapabilityDefinition>(
  hostedCapabilities.map((capability) => [capability.manifest.id, capability]),
);
```

Keep `getHostedCapability` and `listHostedCapabilityIds` as the only public accessors.

- [ ] **Step 9: Run focused registry tests and typecheck**

Run:

```bash
npm test -- packages/capability-sdk/src/schema.test.ts src/main/capabilities/catalog.test.ts src/main/capabilities/host-registry.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit SDK permission and registry preparation**

```bash
git add packages/capability-sdk/src/schema.ts packages/capability-sdk/src/schema.test.ts packages/capability-sdk/src/index.ts src/main/capabilities/catalog.ts src/main/capabilities/catalog.test.ts src/main/capabilities/host-registry.ts src/main/capabilities/host-registry.test.ts
git commit -m "feat(capability-sdk): define public web permission"
```

---

### Task 4: Build the Extraction-Ready Local Generator

**Files:**
- Create: `scripts/capability-kit/types.ts`
- Create: `scripts/capability-kit/naming.ts`
- Create: `scripts/capability-kit/naming.test.ts`
- Create: `scripts/capability-kit/templates/index.ts`
- Create: `scripts/capability-kit/templates.test.ts`
- Create: `scripts/capability-kit/repository-registration.ts`
- Create: `scripts/capability-kit/repository-registration.test.ts`
- Create: `scripts/capability-kit/create-capability.ts`
- Create: `scripts/capability-kit/create-capability.test.ts`
- Create: `scripts/capability-kit/cli.ts`
- Create: `scripts/capability-kit/cli.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

```ts
export interface CapabilityNames {
  slug: string;
  capabilityId: string;
  packageName: string;
  visibleName: string;
  symbolName: string;
  manifestSymbol: string;
  toolName: string;
}

export interface CreateCapabilityOptions {
  rootDirectory: string;
  slug: string;
  toolName: string;
}

export interface CreateCapabilityResult {
  created: readonly string[];
  modified: readonly string[];
}

export interface CapabilityFileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string, options: { recursive: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
}

export interface CreateCapabilityDependencies {
  filesystem: CapabilityFileSystem;
  temporarySuffix(): string;
}

export function deriveCapabilityNames(slug: string, toolName: string): CapabilityNames;
export function renderCapabilityPackage(names: CapabilityNames): ReadonlyMap<string, string>;
export function createRepositoryRegistrationPatches(
  rootDirectory: string,
  names: CapabilityNames,
  readFile: (path: string) => Promise<string>,
): Promise<ReadonlyMap<string, string>>;
export function createCapability(
  options: CreateCapabilityOptions,
  dependencies?: Partial<CreateCapabilityDependencies>,
): Promise<CreateCapabilityResult>;
```

- [ ] **Step 1: Install the TypeScript script runner**

Run:

```bash
npm install --save-dev tsx
```

Expected: `package.json` and `package-lock.json` add `tsx` without changing unrelated dependency versions.

- [ ] **Step 2: Write failing naming tests**

```ts
expect(deriveCapabilityNames("url-fetch", "fetch_url")).toEqual({
  slug: "url-fetch",
  capabilityId: "agentic-worktrees.url-fetch",
  packageName: "@agentic-worktrees/url-fetch-capability",
  visibleName: "URL Fetch",
  symbolName: "urlFetch",
  manifestSymbol: "urlFetchManifest",
  toolName: "fetch_url",
});

for (const slug of ["URL-fetch", "url_fetch", "../escape", "-fetch", "fetch-"]) {
  expect(() => deriveCapabilityNames(slug, "fetch_url")).toThrow("slug");
}
expect(() => deriveCapabilityNames("url-fetch", "FetchUrl")).toThrow("tool name");
```

- [ ] **Step 3: Run naming tests and verify they fail**

Run:

```bash
npm test -- scripts/capability-kit/naming.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Implement deterministic naming**

Use exact kebab/snake expressions, split the slug on `-`, use the acronym map `{ url: "URL", http: "HTTP", https: "HTTPS", api: "API" }` for visible names, and lower camel case for symbols. Reject path separators and reserved empty segments before deriving paths.

- [ ] **Step 5: Run naming tests and verify they pass**

Run:

```bash
npm test -- scripts/capability-kit/naming.test.ts
```

Expected: PASS.

- [ ] **Step 6: Write failing template rendering tests**

Assert the returned map contains exactly:

```text
package.json
src/manifest.ts
src/index.ts
src/index.test.ts
```

Parse `package.json` as JSON and assert the package name, private ESM package, export, and SDK dependency. Assert the generated manifest has no permissions/settings and both agents unsupported. Assert `index.ts` exports the manifest, validates the definition, honors an already-aborted signal, and returns an explicit scaffold message rather than claiming real behavior.

- [ ] **Step 7: Implement typed template renderers**

Render files from `CapabilityNames`. The generated tool execution must be transparent:

```ts
async execute(_input, context) {
  if (context.signal.aborted) {
    throw new CapabilityError("cancelled", "Capability execution was cancelled.");
  }
  return {
    content: [{
      type: "text",
      text: "Generated capability scaffold. Implement this reviewed tool before enabling agent compatibility.",
    }],
  };
}
```

The generated structural test validates the definition and exact tool name. Do not include URL Fetch-specific code.

- [ ] **Step 8: Run template tests and verify they pass**

Run:

```bash
npm test -- scripts/capability-kit/templates.test.ts
```

Expected: PASS.

- [ ] **Step 9: Write failing repository patch tests**

Use temporary catalog/host fixtures containing the exact Task 3 markers. Assert generated imports and entries are inserted alphabetically, each marker remains once, and a duplicate ID/tool/package or missing/duplicate marker throws before returning any patch.

Expected catalog additions for URL Fetch:

```ts
import { urlFetchManifest } from "@agentic-worktrees/url-fetch-capability";
createBundledCapability(urlFetchManifest, ["fetch_url"]),
```

Expected host additions:

```ts
import urlFetchCapability from "@agentic-worktrees/url-fetch-capability";
urlFetchCapability,
```

- [ ] **Step 10: Run repository patch tests and verify they fail**

Run:

```bash
npm test -- scripts/capability-kit/repository-registration.test.ts
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 11: Implement exact marker patching**

Read both files, validate marker cardinality, parse the text within owned regions, insert the two exact lines, sort by package specifier/capability symbol, and return patched content without writing it. Scan existing owned regions and generated package paths for collisions. Never evaluate or import source files.

- [ ] **Step 12: Run repository patch tests and verify they pass**

Run:

```bash
npm test -- scripts/capability-kit/repository-registration.test.ts
```

Expected: PASS.

- [ ] **Step 13: Write failing generation transaction tests**

In a temporary repository fixture, assert:

- the four package files are created;
- both registries are modified;
- returned paths are repository-relative;
- a second call changes nothing and rejects;
- a target symlink/path escape rejects;
- a simulated failure on the second registry write restores the first registry and removes the owned temporary/new package directory.

- [ ] **Step 14: Implement staged creation and rollback**

Use `path.resolve` plus `path.relative` containment checks. Render package and registry changes before writing. Write package files under `capabilities/.tmp-<slug>-<random>`, rename to `capabilities/<slug>`, then write registries. Retain original registry bytes and restore them in reverse order on failure. Remove only paths created by the current invocation.

Do not invoke Git, npm install, typecheck, or tests from the generator.

- [ ] **Step 15: Run generation tests and verify they pass**

Run:

```bash
npm test -- scripts/capability-kit/create-capability.test.ts
```

Expected: PASS.

- [ ] **Step 16: Write and implement CLI parsing tests**

Cover:

```text
url-fetch --tool fetch_url  -> success
url-fetch                   -> usage error
url-fetch --tool            -> usage error
url-fetch --tool fetch_url extra -> usage error
```

`cli.ts` exports `runCapabilityCreateCli(argv, io)` for tests and executes it only when launched directly. It prints affected paths and the three next commands from the design.

- [ ] **Step 17: Add the npm command and run the complete kit suite**

Add:

```json
"capability:create": "tsx scripts/capability-kit/cli.ts"
```

Run:

```bash
npm test -- scripts/capability-kit
npm run typecheck
```

Expected: PASS.

- [ ] **Step 18: Commit the local Starter Kit**

```bash
git add package.json package-lock.json scripts/capability-kit
git commit -m "feat(capabilities): add local capability starter kit"
```

---

### Task 5: Generate URL Fetch and Enforce the Public URL Policy

**Files:**
- Create through generator: `capabilities/url-fetch/package.json`
- Create through generator, then modify: `capabilities/url-fetch/src/manifest.ts`
- Create through generator, then modify: `capabilities/url-fetch/src/index.ts`
- Create through generator: `capabilities/url-fetch/src/index.test.ts`
- Create: `capabilities/url-fetch/src/url-policy.ts`
- Create: `capabilities/url-fetch/src/url-policy.test.ts`
- Modify through generator: `src/main/capabilities/catalog.ts`
- Modify through generator: `src/main/capabilities/host-registry.ts`
- Modify: `package-lock.json`

**Interfaces:**

```ts
export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface PublicTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

export type ResolveAddresses = (
  hostname: string,
  signal: AbortSignal,
) => Promise<readonly ResolvedAddress[]>;

export function parsePublicWebUrl(raw: string): URL;
export function assertPublicAddress(address: string): void;
export async function resolvePublicTarget(
  url: URL,
  signal: AbortSignal,
  resolveAddresses?: ResolveAddresses,
): Promise<PublicTarget>;
```

- [ ] **Step 1: Run the generator against the real repository**

Run:

```bash
npm run capability:create -- url-fetch --tool fetch_url
```

Expected: the workspace package is created and both explicit registry sections gain one URL Fetch entry. Review the diff and confirm no lines outside the owned marker regions changed in either registry.

- [ ] **Step 2: Install reviewed URL Fetch dependencies**

Run:

```bash
npm install --workspace @agentic-worktrees/url-fetch-capability ipaddr.js htmlparser2
```

Expected: dependencies appear only in `capabilities/url-fetch/package.json` and the root lockfile workspace graph.

- [ ] **Step 3: Replace the generated manifest with the reviewed URL Fetch manifest**

Declare ID `agentic-worktrees.url-fetch`, name `URL Fetch`, version `0.1.0`, SDK `^0.1.0`, category `web-browser`, author `Agentic Worktrees`, license `MIT`, no settings or secrets, network `PUBLIC_WEB_NETWORK_PERMISSION`, and tool `fetch_url`. Record first-party provenance with package `@agentic-worktrees/url-fetch-capability`, source/version `agentic-worktrees`/`0.1.0`, and repository `https://github.com/akij22/Agentic-Worktrees`. Keep both agents `unsupported` until Task 8 integration verification.

- [ ] **Step 4: Write failing syntactic URL tests**

```ts
expect(parsePublicWebUrl("https://example.com/docs").href).toBe("https://example.com/docs");
for (const value of [
  "file:///etc/passwd",
  "ftp://example.com/file",
  "https://user:pass@example.com",
  "https://example.com:8443",
  "http://localhost",
  "http://localhost.",
  "not a url",
]) {
  expect(() => parsePublicWebUrl(value)).toThrow();
}
```

Use a maximum input length of 4,096 characters.

- [ ] **Step 5: Write failing address classification tests**

Table-test blocked IPv4/IPv6 classes, including:

```text
127.0.0.1
10.0.0.1
172.16.0.1
192.168.0.1
100.64.0.1
169.254.169.254
0.0.0.0
224.0.0.1
::
::1
fc00::1
fe80::1
::ffff:127.0.0.1
```

Assert representative global addresses pass. Use `CapabilityError` code `permission_denied` for every blocked destination.

- [ ] **Step 6: Write failing DNS resolution tests**

```ts
await expect(resolvePublicTarget(
  new URL("https://example.com"),
  new AbortController().signal,
  async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ],
)).rejects.toMatchObject({ code: "permission_denied" });
```

Also cover empty answers, resolver cancellation, literal public IPs without DNS, and deterministic selection of the first global result when all answers are global.

- [ ] **Step 7: Run URL policy tests and verify they fail**

Run:

```bash
npm test -- capabilities/url-fetch/src/url-policy.test.ts
```

Expected: FAIL because the policy module does not exist.

- [ ] **Step 8: Implement URL parsing, IP classification, and all-address DNS validation**

Use WHATWG `URL`, normalize hostnames, strip transport fragments, and enforce default ports (`80` for HTTP and `443` for HTTPS). Use `ipaddr.js` range classification and explicitly treat IPv4-mapped IPv6 addresses as their IPv4 value.

Use `node:dns/promises.lookup(hostname, { all: true, verbatim: true })` in the default resolver. Race the lookup with the caller/deadline abort signal, and discard late results so cancellation can return even though Node cannot cancel an individual `lookup` call. Reject the entire hostname when any answer is blocked; this prevents mixed-answer fallback to a private destination.

Map malformed user input to `invalid_input`, blocked destinations to `permission_denied`, cancellation to `cancelled`, and DNS failure/empty answers to `upstream_unavailable` without including the full URL or DNS response in the safe message.

- [ ] **Step 9: Run policy tests, SDK tests, and typecheck**

Run:

```bash
npm test -- capabilities/url-fetch/src/url-policy.test.ts packages/capability-sdk/src/schema.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit the generated package and URL policy**

```bash
git add capabilities/url-fetch src/main/capabilities/catalog.ts src/main/capabilities/host-registry.ts package-lock.json
git commit -m "feat(capabilities): scaffold URL Fetch with public URL policy"
```

---

### Task 6: Implement the Pinned HTTP Transport

**Files:**
- Create: `capabilities/url-fetch/src/transport.ts`
- Create: `capabilities/url-fetch/src/transport.test.ts`

**Interfaces:**

```ts
export interface RawHttpResponse {
  statusCode: number;
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  body: AsyncIterable<Uint8Array>;
  close(): void;
}

export type RequestOnce = (
  target: PublicTarget,
  signal: AbortSignal,
) => Promise<RawHttpResponse>;

export interface FetchedResource {
  requestedUrl: string;
  finalUrl: string;
  contentType: "text/html" | "text/plain" | "application/json";
  body: Uint8Array;
  truncated: boolean;
}

export interface UrlTransport {
  fetch(url: string, signal: AbortSignal): Promise<FetchedResource>;
}

export function requestResolvedTarget(
  target: PublicTarget,
  signal: AbortSignal,
): Promise<RawHttpResponse>;

export function createUrlTransport(dependencies?: {
  resolveTarget?: typeof resolvePublicTarget;
  requestOnce?: RequestOnce;
  timeoutMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
}): UrlTransport;
```

- [ ] **Step 1: Write failing pinned-request adapter tests**

Inject fake `http.request`/`https.request` factories or an internal request factory seam and assert production options preserve:

```ts
expect(options.hostname).toBe("example.com");
expect(options.servername).toBe("example.com");
expect(options.lookup("example.com", {}, callback)).toBeUndefined();
expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
```

Also assert no caller-supplied headers/cookies/authorization are accepted and the request uses `GET`.

- [ ] **Step 2: Write failing redirect orchestration tests**

With injected `resolveTarget` and `requestOnce`, cover:

- relative redirect resolution;
- re-resolution on every hop;
- rejection of HTTPS-to-HTTP downgrade;
- loop detection;
- missing/invalid `Location`;
- more than five redirects;
- blocked redirected destination propagated as `permission_denied`.

Assert `requestOnce` receives the `PublicTarget.address` returned for that exact hop.

- [ ] **Step 3: Write failing stream/deadline/error tests**

Cover:

- 2 MiB exact body accepted;
- larger body stopped and returned with `truncated: true`;
- `Content-Length` does not allocate beyond the cap;
- unsupported content type rejected before body accumulation;
- `429` -> `rate_limited`;
- `5xx`, DNS, connection, and deadline -> `upstream_unavailable`;
- caller abort -> `cancelled`;
- response/request `close()` called on abort, truncation, redirect, and errors.

- [ ] **Step 4: Run transport tests and verify they fail**

Run:

```bash
npm test -- capabilities/url-fetch/src/transport.test.ts
```

Expected: FAIL because the transport module does not exist.

- [ ] **Step 5: Implement the production pinned request**

Use asynchronous `http.request`/`https.request` with:

- the original hostname and path;
- `servername` equal to the original hostname for HTTPS;
- a per-request `lookup` callback returning only the validated address/family;
- `method: "GET"`;
- fixed safe headers: `Accept` for the three supported media types and a constant Agentic Worktrees user agent;
- no automatic redirects;
- response exposed as an async iterable;
- abort listener that destroys the request with a non-sensitive error.

Do not use global `fetch` in production transport.

- [ ] **Step 6: Implement redirect and body orchestration**

Create one `AbortController` for the 15-second overall deadline and combine it with the caller signal using explicit listeners or `AbortSignal.any`. Parse and validate each URL through Task 5, call `resolvePublicTarget`, then call `requestOnce` with the pinned result.

Treat only `301`, `302`, `303`, `307`, and `308` as redirects. For those statuses, close the current body, resolve against the current URL, reject downgrade/loops, and repeat. Map `400`–`499` other than `429` to `upstream_protocol_error`. For a final `200`–`299` response, normalize the media type by removing charset parameters, stream chunks up to 2 MiB, close after truncation, and return `FetchedResource`.

- [ ] **Step 7: Run transport and policy tests**

Run:

```bash
npm test -- capabilities/url-fetch/src/url-policy.test.ts capabilities/url-fetch/src/transport.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit the pinned transport**

```bash
git add capabilities/url-fetch/src/transport.ts capabilities/url-fetch/src/transport.test.ts
git commit -m "feat(url-fetch): add SSRF-safe pinned transport"
```

---

### Task 7: Extract Readable Content and Complete `fetch_url`

**Files:**
- Create: `capabilities/url-fetch/src/html-to-text.ts`
- Create: `capabilities/url-fetch/src/html-to-text.test.ts`
- Modify: `capabilities/url-fetch/src/index.ts`
- Modify: `capabilities/url-fetch/src/index.test.ts`

**Interfaces:**

```ts
export interface ReadableResource {
  title?: string;
  text: string;
}

export function extractReadableResource(
  contentType: FetchedResource["contentType"],
  body: Uint8Array,
  finalUrl: string,
): ReadableResource;

export function createUrlFetchCapability(dependencies?: {
  transport?: UrlTransport;
}): CapabilityDefinition;
```

- [ ] **Step 1: Write failing HTML extraction tests**

Use a fixture containing title, headings, paragraphs, nested lists, links, preformatted text, comments, script, style, navigation, and malformed closing tags. Assert:

```ts
expect(result.title).toBe("Example documentation");
expect(result.text).toContain("# Install");
expect(result.text).toContain("- First step");
expect(result.text).toContain("Project site (https://example.com/project)");
expect(result.text).not.toContain("window.secret");
expect(result.text).not.toContain("display: none");
```

Resolve relative links against `finalUrl`, collapse excessive blank lines, and omit empty anchors.

- [ ] **Step 2: Write failing plain-text and JSON tests**

Assert UTF-8 plain text is normalized without HTML parsing. Parse valid JSON and pretty-print it with two-space indentation; preserve invalid JSON as bounded text rather than throwing a protocol error.

- [ ] **Step 3: Run extraction tests and verify they fail**

Run:

```bash
npm test -- capabilities/url-fetch/src/html-to-text.test.ts
```

Expected: FAIL because the extraction module does not exist.

- [ ] **Step 4: Implement deterministic static extraction**

Use `htmlparser2` callbacks and an explicit element stack. Ignore `script`, `style`, `noscript`, `template`, and comments. Emit stable delimiters for headings, paragraphs, lists, line breaks, and preformatted blocks. Capture the first `<title>`. Resolve only HTTP/HTTPS anchor targets and omit unsafe schemes.

Decode as UTF-8 with replacement for invalid bytes. Do not evaluate scripts, load subresources, inspect CSS, or rank article content.

- [ ] **Step 5: Run extraction tests and verify they pass**

Run:

```bash
npm test -- capabilities/url-fetch/src/html-to-text.test.ts
```

Expected: PASS.

- [ ] **Step 6: Replace the scaffold test with failing capability tests**

Test the exact schema and output using an injected fake transport:

```ts
const capability = createUrlFetchCapability({
  transport: {
    fetch: vi.fn().mockResolvedValue({
      requestedUrl: "https://example.com/docs",
      finalUrl: "https://example.com/docs",
      contentType: "text/html",
      body: new TextEncoder().encode("<title>Docs</title><p>Hello</p>"),
      truncated: false,
    }),
  },
});
```

Assert the result contains title, requested/final URL, content type, truncation status, and readable content. Also assert:

- blank or invalid URL -> `invalid_input`;
- caller cancellation reaches transport;
- transport `CapabilityError` code is preserved;
- tool input rejects additional properties;
- no body or query value appears in safe thrown errors;
- the SDK output limiter bounds oversized extracted text.

- [ ] **Step 7: Run the capability test and verify it fails**

Run:

```bash
npm test -- capabilities/url-fetch/src/index.test.ts
```

Expected: FAIL because `index.ts` still contains the generated scaffold.

- [ ] **Step 8: Implement `createUrlFetchCapability` and `fetch_url`**

Use an input schema with one required URL string, maximum length 4,096, and `additionalProperties: false`. Call the injected/default transport with `context.signal`, extract content, and format:

```text
Title: Docs
Requested URL: https://example.com/docs
Final URL: https://example.com/docs
Content-Type: text/html
Truncated: no

Hello
```

Apply a capability-owned budget of 48 KiB and 1,990 lines to the readable body before assembling the headers, leaving room below the host's final SDK cap. If either the network body or this readable-body budget shortens content, report `Truncated: yes`. Keep structured `details` limited to sanitized URL/media/truncation metadata; never include fetched body content.

Export `urlFetchManifest`, factory, transport/public types needed by tests, and a validated default definition.

- [ ] **Step 9: Run the complete URL Fetch suite and typecheck**

Run:

```bash
npm test -- capabilities/url-fetch packages/capability-sdk
npm run typecheck
npm run build:capability-host
```

Expected: PASS.

- [ ] **Step 10: Commit the completed tool**

```bash
git add capabilities/url-fetch/src
git commit -m "feat(url-fetch): return bounded readable page content"
```

---

### Task 8: Verify Application Integration and Enable Agent Compatibility

**Files:**
- Modify: `capabilities/url-fetch/src/manifest.ts`
- Modify: `src/main/capabilities/catalog.test.ts`
- Modify: `src/main/capabilities/host-registry.test.ts`
- Modify: `src/main/capabilities/capability-host-server.test.ts`
- Modify: `src/main/capabilities/capability-service.test.ts`
- Modify: `src/renderer/pages/Capabilities.test.tsx`
- Modify: `src/renderer/features/capabilities/components/CapabilityPicker.test.tsx`
- Modify: `src/main/coding-agents/codex-adapter.test.ts`
- Modify: `src/main/coding-agents/opencode-adapter.test.ts`

**Interfaces:**
- Consumes: URL Fetch default capability and generic setup/configuration flows.
- Produces: reviewed URL Fetch manifest with `{ codex: "supported", opencode: "supported" }`.

- [ ] **Step 1: Write failing catalog and host expectations**

```ts
expect(listBundledCapabilities().map((item) => item.manifest.id)).toEqual([
  "agentic-worktrees.url-fetch",
  "agentic-worktrees.web-search",
]);
expect(getBundledCapability("agentic-worktrees.url-fetch").toolNames).toEqual(["fetch_url"]);
expect(listHostedCapabilityIds()).toEqual([
  "agentic-worktrees.url-fetch",
  "agentic-worktrees.web-search",
]);
```

Use the deterministic order selected by the generator and keep test expectations aligned with it.

- [ ] **Step 2: Add a settings-free service configuration test**

Configure URL Fetch with accepted digest, `settings: {}`, and `secrets: {}`. Assert state becomes `ready`, no credential-store method is called, activation asks the host for `fetch_url`, and deactivation returns to `inactive`.

- [ ] **Step 3: Add host MCP exposure coverage**

Use the real host registry or a URL Fetch test definition with injected transport. Assert no tools before activation, only `fetch_url` after URL Fetch activation, both tools when both IDs are active, and removal after deactivation. Do not perform real outbound network access.

- [ ] **Step 4: Add renderer integration coverage**

In Library and picker tests, assert URL Fetch:

- appears with compatible Codex/OpenCode grouping after compatibility is enabled;
- opens a permission-only setup dialog from `available`;
- submits empty settings/secrets;
- becomes activatable after configuration;
- displays `Public HTTP/HTTPS internet`;
- does not render Web Search fields.

- [ ] **Step 5: Run integration tests and verify they fail where compatibility remains unsupported**

Run:

```bash
npm test -- src/main/capabilities src/renderer/features/capabilities src/renderer/pages/Capabilities.test.tsx
```

Expected: FAIL on compatibility/grouping or missing two-capability expectations.

- [ ] **Step 6: Enable reviewed agent compatibility and complete test updates**

Set:

```ts
compatibility: { codex: "supported", opencode: "supported" }
```

Do not add provider-specific URL Fetch code to either adapter. Both agents must receive `fetch_url` through the existing MCP connection and expected-tool verification path.

- [ ] **Step 7: Run backend, renderer, adapter, and build verification**

Run:

```bash
npm test -- src/main/capabilities src/renderer/features/capabilities src/renderer/pages/Capabilities.test.tsx src/main/coding-agents
npm run typecheck
npm run lint
npm run build:capability-host
npm run package
```

Expected: PASS. Packaging must build the renderer and include the URL Fetch package in the capability host bundle.

- [ ] **Step 8: Commit integrated URL Fetch support**

```bash
git add capabilities/url-fetch/src/manifest.ts src/main/capabilities/catalog.test.ts src/main/capabilities/host-registry.test.ts src/main/capabilities/capability-host-server.test.ts src/main/capabilities/capability-service.test.ts src/renderer/pages/Capabilities.test.tsx src/renderer/features/capabilities/components/CapabilityPicker.test.tsx src/main/coding-agents/codex-adapter.test.ts src/main/coding-agents/opencode-adapter.test.ts
git commit -m "feat(capabilities): integrate URL Fetch with agent sessions"
```

---

### Task 9: Generalize the Real Capability Smoke Harness

**Files:**
- Create: `scripts/capability-smoke/driver.mjs`
- Create: `scripts/capability-smoke/run.mjs`
- Create: `scripts/capability-smoke/web-search-scenario.mjs`
- Create: `scripts/capability-smoke/url-fetch-scenario.mjs`
- Create: `scripts/capability-smoke/driver.test.ts`
- Create: `scripts/capability-smoke/run.test.ts`
- Create: `scripts/capability-smoke/web-search-scenario.test.ts`
- Create: `scripts/capability-smoke/url-fetch-scenario.test.ts`
- Delete: `scripts/smoke-capability-web-search.mjs`
- Delete: `scripts/smoke-capability-web-search.test.ts`
- Delete: `scripts/lib/electron-capability-smoke-driver.mjs`
- Modify: `package.json`

**Interfaces:**

```js
/**
 * @typedef {Object} CapabilitySmokeDriver
 * @property {() => Promise<void>} launch
 * @property {() => Promise<Array<{kind:"codex"|"opencode",version:string}>>} listConfiguredAgents
 * @property {() => Promise<string>} getFirstWorktreeId
 * @property {(agentKind:"codex"|"opencode",worktreeId:string) => Promise<string>} createSession
 * @property {(runId:string,content:string) => Promise<void>} sendMessage
 * @property {(runId:string,timeoutMs:number) => Promise<void>} waitForIdle
 * @property {(capabilityId:string,settings:Record<string,unknown>,secrets?:Record<string,string|null>) => Promise<void>} configureCapability
 * @property {(runId:string,capabilityId:string) => Promise<void>} activateCapability
 * @property {(runId:string,capabilityId:string) => Promise<void>} deactivateCapability
 * @property {(runId:string) => Promise<unknown>} getSnapshot
 * @property {() => string} readProcessLogs
 * @property {() => Promise<void>} close
 */
```

Each scenario exports the following shape:

```js
/**
 * @typedef {Object} CapabilitySmokeContext
 * @property {Array<{kind:"codex"|"opencode",version:string}>} agents
 * @property {string} worktreeId
 * @property {number} timeoutMs
 * @property {string | undefined} apiKey
 *
 * @typedef {Object} CapabilitySmokeScenario
 * @property {"web-search" | "url-fetch"} id
 * @property {(driver:CapabilitySmokeDriver,context:CapabilitySmokeContext) => Promise<unknown[]>} run
 */

export declare function runCapabilitySmokes(
  driver: CapabilitySmokeDriver,
  scenarios: readonly CapabilitySmokeScenario[],
  options?: {
    selectedScenarioIds?: readonly ("web-search" | "url-fetch")[];
    timeoutMs?: number;
    apiKey?: string;
  },
): Promise<unknown[]>;
```

- [ ] **Step 1: Write failing generic driver tests**

Verify `configureCapability` first reads capability details and submits the generic accepted digest/settings/secrets request. Verify generic activate/deactivate methods use supplied IDs. Retain idle/error/unavailable behavior and owned app cleanup tests.

- [ ] **Step 2: Write failing runner tests**

Using fake scenarios, assert `runCapabilitySmokes`:

- launches once;
- enforces Codex `0.150.1+` and OpenCode `1.18.23+`;
- runs only selected scenario IDs or all scenarios;
- closes in `finally`;
- rejects markers/authorization/secret values found in process logs.

- [ ] **Step 3: Run smoke harness tests and verify they fail**

Run:

```bash
npm test -- scripts/capability-smoke
```

Expected: FAIL because the new harness does not exist.

- [ ] **Step 4: Move the Electron driver behind generic methods**

Reuse the current Playwright Electron launch, first-window evaluation, agent discovery, first-worktree lookup, session creation, message sending, polling, snapshot, log capture, and cleanup. Replace Web Search-specific methods with the generic capability methods in the interface above.

Never return bearer tokens, credentials, environment variables, or filesystem paths from renderer evaluation.

- [ ] **Step 5: Implement shared runner/version/log checks**

Move version comparison, snapshot message extraction, assistant-message extraction, and tool-call counting into `run.mjs` exports used by both scenarios. Accept scenario selection from `--scenario web-search`, `--scenario url-fetch`, or no flag for all.

- [ ] **Step 6: Port Web Search as a scenario with equivalent coverage**

Preserve keyless and optional keyed modes, baseline history marker, attributed result, `web_search` call count, deactivation, exact unavailability reply, and sensitive-log checks. Use generic configure/activate/deactivate methods.

- [ ] **Step 7: Write the URL Fetch scenario and its fake-driver test**

For each agent:

1. send a baseline marker and wait for idle;
2. configure URL Fetch with `{}` settings/secrets;
3. activate `agentic-worktrees.url-fetch`;
4. ask the agent to call `fetch_url` on `https://example.com/` and report the attributed title “Example Domain”;
5. assert baseline history remains, at least one `fetch_url` tool call exists, and the public URL/title is present;
6. deactivate URL Fetch;
7. ask for one `fetch_url` call and require the exact reply `capability unavailable.` when absent;
8. assert the tool-call count did not increase.

The test uses fake snapshots and no real network.

- [ ] **Step 8: Add scripts and remove superseded files**

Set:

```json
"smoke:capabilities": "node scripts/capability-smoke/run.mjs",
"smoke:capabilities:web-search": "node scripts/capability-smoke/run.mjs --scenario web-search",
"smoke:capabilities:url-fetch": "node scripts/capability-smoke/run.mjs --scenario url-fetch"
```

Delete the old Web Search-only runner, test, and driver only after all assertions have equivalent new coverage.

- [ ] **Step 9: Run offline smoke seam tests and project checks**

Run:

```bash
npm test -- scripts/capability-smoke
npm run typecheck
npm run lint
```

Expected: PASS without `AW_SMOKE_EXECUTABLE` or authenticated agents.

- [ ] **Step 10: Optionally run real smoke scenarios**

When a packaged executable and authenticated compatible agents are available:

```bash
AW_SMOKE_EXECUTABLE="/absolute/path/to/packaged/executable" npm run smoke:capabilities:url-fetch
AW_SMOKE_EXECUTABLE="/absolute/path/to/packaged/executable" npm run smoke:capabilities:web-search
```

Expected: both commands PASS for Codex and OpenCode. If the environment is unavailable, record the smoke tests as not run rather than weakening or faking them.

- [ ] **Step 11: Commit the reusable smoke harness**

```bash
git add package.json scripts/capability-smoke scripts/smoke-capability-web-search.mjs scripts/smoke-capability-web-search.test.ts scripts/lib/electron-capability-smoke-driver.mjs
git commit -m "test(capabilities): generalize Codex and OpenCode smoke scenarios"
```

---

### Task 10: Document Authoring and Run Final Verification

**Files:**
- Modify: `docs/capabilities/authoring-capabilities.md`

If verification exposes a defect, return to the task that owns that behavior, add a failing regression test there, fix it, rerun that task's commands, and commit the fix before continuing this final task.

**Interfaces:**
- Consumes: final generator command, permission contract, package layout, and smoke commands.
- Produces: an author-facing workflow that distinguishes bundled local creation from future public packaging.

- [ ] **Step 1: Update the authoring guide with exact local commands**

Document:

```bash
npm run capability:create -- echo-text --tool echo_text
npm install
npm test -- capabilities/echo-text
npm run typecheck
```

Explain generated unsupported compatibility, the two explicit reviewed registrations, and that the local command does not install or publish third-party code.

- [ ] **Step 2: Document permissions and dependency boundaries**

State that exact hostnames are preferred; `public-web` is reserved for reviewed broad HTTP/HTTPS capabilities and requires destination/redirect enforcement equivalent to URL Fetch. Document that narrowly scoped reviewed runtime dependencies are allowed inside a capability package, while Electron and internal app modules remain prohibited.

- [ ] **Step 3: Document offline and optional real verification**

Include focused tests, host build, package command, three smoke commands, required `AW_SMOKE_EXECUTABLE`, optional `EXA_API_KEY`, and the prohibition on committing credentials, logs, package output, databases, or fetched content.

- [ ] **Step 4: Run all focused tests**

```bash
npm test -- scripts/capability-kit capabilities/url-fetch packages/capability-sdk src/main/capabilities src/renderer/features/capabilities scripts/capability-smoke
```

Expected: PASS.

- [ ] **Step 5: Run project-wide verification in order**

```bash
npm run typecheck
npm run lint
npm test
npm run build:capability-host
npm run package
```

Expected: every command exits 0. Do not run `npm run make` or `npm run publish`.

- [ ] **Step 6: Inspect package and repository safety**

Confirm:

```bash
git status --short
git diff --check
git diff --name-only
```

Expected: no `.env`, credentials, logs, databases, fetched pages, `.vite`, `out`, coverage, or packaged artifacts are staged. Confirm both registries contain only reviewed static imports and entries.

- [ ] **Step 7: Run active diagnostics before completion**

Run LSP diagnostics on all changed TypeScript/TSX files and `lens_diagnostics mode=all`. Fix only findings caused by this feature and add a regression test for behavioral fixes.

- [ ] **Step 8: Commit the authoring documentation**

```bash
git add docs/capabilities/authoring-capabilities.md
git commit -m "docs(capabilities): document local authoring and verification"
```

Any code fixes found during verification must already have been handled and committed through their owning task before this documentation-only commit.

- [ ] **Step 9: Record final evidence for handoff**

Report:

- every modified file and its purpose;
- focused and project-wide commands with pass/fail status;
- whether each optional real smoke scenario ran;
- the exact packaged executable used for smoke without exposing sensitive paths in committed files;
- remaining risk: static pages only, public network breadth, external site variability, and no third-party sandbox/public packaging yet.
