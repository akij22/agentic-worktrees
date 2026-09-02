# Authoring bundled capabilities

Agentic Worktrees capability SDK v0.1 is a deliberately small, provider-neutral contract for reviewed local capabilities. It supports metadata, compatibility, permissions, settings, optional secrets, and MCP tools. It does not support commands, events, renderer extensions, arbitrary package loading, or a public registry.

## 1. Create a workspace package

Use the repository-local starter kit:

```bash
npm run capability:create -- echo-text --tool echo_text
npm install
npm test -- capabilities/echo-text
npm run typecheck
```

The command creates `capabilities/echo-text`, adds separate reviewed metadata and executable registry entries, and starts Codex/OpenCode compatibility as `unsupported`. Enable compatibility only after adapter verification. This local command neither installs third-party code nor publishes a package; it is not yet a public packaging interface.

The generated package depends only on the local SDK:

```json
{
  "name": "@agentic-worktrees/echo-text-capability",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts",
  "dependencies": { "@agentic-worktrees/capability-sdk": "0.1.0" }
}
```

The root npm workspaces discover `capabilities/*`. Use `npm install`; never import Electron, database, renderer, or coding-agent modules from a capability. Narrowly scoped runtime dependencies may be added to the capability workspace only after review.

## 2. Declare the reviewed surface

A manifest needs a stable lowercase dotted ID, semantic version, SDK range, verified Codex/OpenCode compatibility, publisher/license, and provenance where code was ported. Permissions state the maximum reviewed network hosts and secrets. Prefer exact lowercase hostnames. The reserved `public-web` permission is only for reviewed broad HTTP/HTTPS capabilities that enforce public destination classification, DNS pinning, and redirect revalidation equivalent to URL Fetch. Every secret setting must correspond to a declared kebab-case secret permission. A permission or version change creates a new consent digest.

```ts
const manifest = {
  id: "agentic-worktrees.echo-text",
  name: "Echo Text",
  version: "0.1.0",
  sdkVersion: "^0.1.0",
  description: "Echo validated text.",
  category: "utility",
  author: { name: "Agentic Worktrees" },
  license: "MIT",
  compatibility: { codex: "supported", opencode: "supported" },
  permissions: { network: [], secrets: [] },
  settings: {},
} as const;
```

## 3. Define one JSON-Schema tool

```ts
import { defineCapability, defineTool } from "@agentic-worktrees/capability-sdk";

export default defineCapability({
  manifest,
  tools: [defineTool<{ text: string }>({
    name: "echo_text",
    description: "Echo text supplied by the coding agent.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", minLength: 1, maxLength: 2000 } },
      required: ["text"],
      additionalProperties: false,
    },
    async execute({ text }, context) {
      if (context.signal.aborted) throw new DOMException("Aborted", "AbortError");
      return { content: [{ type: "text", text }] };
    },
  })],
});
```

Tool names are lowercase snake case. Inputs are validated again in the utility host. Output is capped at 50 KiB and 2,000 lines. Honor `AbortSignal`, use stable `CapabilityError` codes, and return attributed source URLs for network-derived facts.

## 4. Test without real services

Inject `fetch` or another narrow transport dependency from a `createCapability({ fetchImpl })` factory. Test JSON and protocol variants, invalid input, cancellation, rate limits, malformed responses, and output bounds. Never put queries, results, bearer headers, API keys, endpoints, or decrypted values into logger fields or errors.

Run offline verification:

```bash
npm test -- capabilities/echo-text packages/capability-sdk
npm run typecheck
npm run lint
npm run build:capability-host
npm run package
```

## 5. Register for review

Add the immutable manifest to `src/main/capabilities/catalog.ts` and the executable definition to `src/main/capabilities/host-registry.ts`. These are separate reviews: renderer DTOs receive metadata only, while only the utility process can reach executable definitions. Do not resolve renderer-provided paths or third-party packages.

Use an authenticated fake MCP client against a loopback port and verify: no active tools initially, activation exposes only `echo_text`, invalid bearer tokens receive 401, execution is bounded, and deactivation removes the tool.

## 6. Optional real verification

Package first with `npm run package`, set `AW_SMOKE_EXECUTABLE` to the packaged executable, and authenticate supported Codex 0.150.1+ and OpenCode 1.18.23+. Real compatibility checks are opt-in:

```bash
npm run smoke:capabilities
npm run smoke:capabilities:web-search
npm run smoke:capabilities:url-fetch
```

The Web Search scenario is keyless by default. `EXA_API_KEY` is optional and passes through the encrypted configuration path. Never commit environment files, credentials, logs, package output, databases, fetched pages, or fetched content.
