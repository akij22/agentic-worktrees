# Capability Starter Kit and URL Fetch Design

**Date:** 2026-08-31
**Status:** Approved
**Scope:** Local capability generator, bundled URL Fetch capability, and reusable Codex/OpenCode smoke scenarios

## Objective

Turn the existing Web Search vertical slice into a repeatable capability-authoring flow without prematurely building a public CLI or marketplace.

The first increment delivers two things together:

1. a minimal repository-local command that creates a valid bundled capability skeleton and registers it through the existing review boundaries;
2. a second real capability, URL Fetch, created from that skeleton and verified with both Codex and OpenCode.

The local generator must be structured so its core and templates can later move into a public `@agentic-worktrees/capability-cli` package. The first release remains intentionally narrow: it creates bundled tool-based capabilities but does not implement public packaging, remote installation, dynamic discovery, or third-party execution.

## Product Decisions

- Use a minimal local CLI rather than a copy-only template or a complete public toolkit.
- Expose one initial command: `capability:create`.
- Keep metadata and executable registration separate.
- Do not discover or execute packages dynamically from `capabilities/*`.
- Generate provider-neutral MCP tool capabilities using the existing SDK v0.1 contract.
- Use URL Fetch as the first generated capability and the second bundled capability after Web Search.
- URL Fetch returns readable text from static HTML, plain text, or JSON.
- URL Fetch does not render JavaScript or use a browser.
- URL Fetch may access only public HTTP/HTTPS destinations and must enforce that restriction for the initial request and every redirect.
- Real Codex/OpenCode smoke tests are optional and separate from the normal offline test suite.
- The public CLI, marketplace, capability scopes, skills, commands, events, and renderer extensions remain outside this increment.

## Existing Foundation

The current implementation already provides:

- npm workspaces for `packages/*` and `capabilities/*`;
- `@agentic-worktrees/capability-sdk` with manifests, compatibility, permissions, settings, secrets, MCP tools, structured errors, cancellation, and output limits;
- a reviewed bundled metadata catalog in `src/main/capabilities/catalog.ts`;
- a separate executable registry in `src/main/capabilities/host-registry.ts`;
- a utility-process capability host and authenticated loopback MCP server;
- persisted configuration and session capability state;
- encrypted optional credentials through Electron `safeStorage`;
- typed capability IPC and preload APIs;
- capability activation, deactivation, recovery, and rollback;
- Codex MCP refresh and OpenCode coordinated reload;
- the Capability Library, setup flow, chat picker, and active-state UI;
- one bundled Web Search capability;
- offline tests and an optional real Web Search smoke harness.

The new work extends these boundaries instead of replacing them.

## Alternatives Considered

### Repository-local generator with an extraction-ready core

This is the chosen approach. A thin local CLI calls a reusable generation core, while a repository adapter owns the two explicit registration edits. It provides immediate developer value and preserves the current security review model.

### Build-time registry generation

A build step could scan capability descriptors and generate both registries. This reduces explicit edits but introduces generated source, a new build dependency, and less visible executable approval. It also moves too close to automatic discovery before third-party loading and sandboxing have been designed.

### Public capability CLI immediately

A standalone package could expose `create`, `validate`, `dev`, `test`, and `pack` from the start. This would require committing to external package layout, versioning, distribution, compatibility policy, and registry-independent packaging before a second capability has validated those assumptions.

## Architecture

The design has three independent areas:

```text
Local Starter Kit
      |
      v
Generated capability package
      |
      +---- reviewed metadata ----> Capability Library
      |
      +---- reviewed executable --> Capability Host --> Codex / OpenCode
```

### Local Starter Kit

The local implementation lives under `scripts/capability-kit/`:

```text
scripts/capability-kit/
├── cli.ts
├── create-capability.ts
├── naming.ts
├── repository-registration.ts
└── templates/
    ├── package.json.template
    └── src/
        ├── manifest.ts.template
        ├── index.ts.template
        └── index.test.ts.template
```

The exact template transport may use text files or typed render functions, but templates must remain isolated from CLI parsing and repository registration.

#### `cli.ts`

The CLI is a thin adapter. It:

- parses the slug and required tool name;
- resolves the repository root;
- calls the generation core;
- prints created files and next commands;
- maps expected failures to concise messages and a non-zero exit code.

It must not contain template bodies, registry-editing algorithms, or Electron dependencies.

#### `create-capability.ts`

The generation core accepts explicit options rather than reading global process state:

```text
rootDirectory
slug
capabilityId
packageName
visibleName
toolName
registrationAdapter
```

It validates the complete change, renders the package and asks the registration adapter for patched registry content. It returns a structured result containing created and modified paths.

The core must not import Electron, renderer, database, coding-agent, or capability-host modules. Its filesystem operations must be injectable or directed to an explicit root so tests can run in temporary fixtures and the core can later move to a standalone package.

#### `naming.ts`

Naming rules are centralized and deterministic:

- slug: lowercase kebab case, such as `url-fetch`;
- capability ID: `agentic-worktrees.<slug>`;
- workspace package: `@agentic-worktrees/<slug>-capability`;
- visible name: title-cased slug, with a small explicit acronym map for names such as URL and HTTP;
- tool name: lowercase snake case and supplied explicitly by `--tool`.

The generator does not silently repair invalid input. It reports the violated rule.

#### `repository-registration.ts`

This is the only generator component that knows the Agentic Worktrees repository layout. It updates:

- `src/main/capabilities/catalog.ts` for reviewed metadata;
- `src/main/capabilities/host-registry.ts` for executable definitions.

The files contain explicit insertion markers owned by the local kit. Imports and entries within those sections remain deterministic and sorted. The generated diff must continue to show two separate approvals: safe renderer metadata and utility-host executable code.

This adapter is intentionally not part of the future public core. A public CLI can replace it with validation and packaging adapters.

### Change Safety

Before writing anything, the generator validates that:

- the target package directory does not exist;
- the package name and capability ID are not registered;
- the tool name does not collide with a bundled tool;
- both registry marker sections exist exactly once;
- all destination paths remain inside the explicit repository root;
- the rendered registration changes are unambiguous.

It then stages all new and modified content in memory. Existing registry contents are retained for rollback. New package files are written into a temporary sibling directory before the package directory is renamed into place.

If any later registry write fails, the command restores original registry contents and removes only the temporary or newly created package directory that it owns. It never deletes or overwrites a pre-existing path.

A second invocation with the same slug fails without changing files. The generator does not attempt to merge or upgrade an existing capability.

## CLI Contract

The first command is:

```bash
npm run capability:create -- <slug> --tool <tool_name>
```

For URL Fetch:

```bash
npm run capability:create -- url-fetch --tool fetch_url
```

The first version supports only the required slug and tool name. Extra interactive prompts, custom publisher names, custom ID prefixes, multiple tools, and external output directories are deferred.

Successful output lists the affected paths and suggests:

```bash
npm install
npm test -- capabilities/<slug>
npm run typecheck
```

The generated manifest starts with both Codex and OpenCode compatibility set to `unsupported`. Compatibility is changed to `supported` only after implementation and adapter verification.

## Generated Capability Contract

A generated package initially contains:

```text
capabilities/<slug>/
├── package.json
└── src/
    ├── manifest.ts
    ├── index.ts
    └── index.test.ts
```

The skeleton:

- depends on the local capability SDK;
- declares immutable metadata, permissions, settings, and compatibility;
- defines one JSON-Schema tool with the requested tool name;
- calls `validateCapabilityDefinition`;
- uses `CapabilityError` for safe failures;
- honors `context.signal`;
- returns one bounded text result;
- injects external transports through a factory when needed;
- contains a passing structural test but no fake business behavior presented as complete.

The template is generic. URL Fetch-specific parsing, transport, permissions, or examples must not enter the reusable template.

## URL Fetch Capability

URL Fetch is a separate workspace package:

```text
capabilities/url-fetch/
├── package.json
└── src/
    ├── manifest.ts
    ├── url-policy.ts
    ├── transport.ts
    ├── html-to-text.ts
    ├── index.ts
    └── focused test files
```

The package uses `ipaddr.js` for IP classification and `htmlparser2` for static HTML parsing. Those reviewed dependencies remain local to URL Fetch and are bundled with the capability host. It must not import Electron, application services, renderer code, database code, or coding-agent adapters.

### Manifest

The initial manifest declares:

- ID: `agentic-worktrees.url-fetch`;
- name: `URL Fetch`;
- version: `0.1.0`;
- SDK compatibility: `^0.1.0`;
- category: `web-browser`;
- Codex and OpenCode support after verification;
- reviewed bundled provenance;
- network permission: `public-web`;
- no secrets;
- no user settings in the first release;
- provided tool: `fetch_url`.

No cookie, bearer token, custom header, proxy, or credential setting is exposed.

### Tool Input

The tool accepts only:

```json
{
  "url": "https://example.com/document"
}
```

The input schema requires one string, rejects additional properties, and applies a bounded maximum length. Runtime validation repeats URL-specific checks after JSON-Schema validation.

Options for timeout, output mode, headers, authentication, redirect policy, and content limits are not user-configurable in v0.1.

### Tool Output

The text result contains:

```text
Title: <title when available>
Requested URL: <original URL>
Final URL: <final URL after redirects>
Content-Type: <normalized media type>
Truncated: yes|no

<readable content>
```

Network-derived content always retains source attribution. Response bodies are not copied into structured error details.

The capability limits the downloaded representation before parsing and formats the result below the SDK-wide output cap. The host remains the final enforcement point for the SDK limit of 50 KiB and 2,000 lines.

### Supported Content

The first version accepts:

- `text/html`;
- `text/plain`;
- `application/json`.

Other media types fail safely. PDF, images, archives, audio, video, and arbitrary binary downloads are not supported.

HTML extraction is deterministic and does not execute JavaScript. It removes non-content elements such as scripts and styles while retaining useful structure:

- document title;
- headings;
- paragraphs;
- lists;
- preformatted text;
- link labels and resolved destinations.

It is not an article-ranking or browser-rendering system. Pages whose useful content exists only after JavaScript execution are reported as static content only; they are not escalated to a hidden browser flow.

## Public-Web Permission

The SDK continues to represent network permissions as `string[]`, but validation recognizes two forms:

- an exact reviewed hostname, such as `api.exa.ai`;
- the reserved token `public-web`.

`public-web` means outbound HTTP/HTTPS requests to globally routable public destinations under the restrictions in this design. It does not include localhost, private networks, local services, cloud metadata endpoints, Unix sockets, arbitrary protocols, or browser execution.

The Capability Library renders `public-web` as “Public HTTP/HTTPS internet” instead of exposing an unexplained internal token. Exact host permissions retain their current representation.

Adding this reserved token does not turn manifest permissions into a general sandbox. URL Fetch must enforce the restriction itself, and the UI must continue to describe process isolation honestly.

## URL and Network Policy

`url-policy.ts` owns pure validation and classification. `transport.ts` owns DNS resolution, connection, redirect handling, deadlines, streaming limits, and cancellation.

### Initial URL Validation

The capability rejects:

- schemes other than HTTP and HTTPS;
- URLs containing username or password fields;
- malformed hostnames or IP literals;
- missing hosts;
- non-default ports in the first release;
- fragments for transport purposes;
- hostnames explicitly representing localhost.

Fragments may be retained in the requested attribution if useful, but they are never sent over the network.

### Address Classification

The transport resolves hostnames with all available addresses. It rejects a destination if any returned address is not globally routable. The deny policy includes at minimum:

- IPv4 and IPv6 loopback;
- IPv4 private ranges;
- IPv6 unique-local ranges;
- link-local ranges;
- unspecified addresses;
- multicast and reserved ranges;
- carrier-grade NAT;
- IPv4-mapped IPv6 forms of blocked addresses;
- cloud metadata link-local destinations.

Literal IP hosts pass through the same classifier. Classification uses a reviewed IP-address library rather than ad hoc string-prefix checks.

### DNS Rebinding Protection

A preflight DNS check followed by an unrelated global `fetch` is insufficient because the hostname could resolve differently at connection time. The production transport therefore uses Node's asynchronous `http.request` and `https.request` with a per-request `lookup` callback that returns the already validated address. The request retains the original hostname, so Node preserves the correct HTTP `Host` header and HTTPS certificate/SNI verification while connecting only to the pinned address.

The transport does not use global `fetch` or automatic redirects. Every redirect target is parsed, resolved, classified, and pinned independently before connection.

### Redirect Policy

The capability follows at most five redirects. It rejects:

- redirects to unsupported schemes;
- redirects to blocked addresses;
- redirect responses without a valid `Location`;
- HTTPS-to-HTTP downgrade;
- redirect loops;
- chains beyond the limit.

Relative redirect locations resolve against the current public URL and pass through the same policy.

### Deadlines, Cancellation, and Size

Each execution has one 15-second overall deadline, including DNS, redirects, connection, and body streaming. The execution also observes `context.signal`; cancellation closes the owned request and stream promptly.

The response body is streamed and capped at 2 MiB before parsing. A larger response is stopped after the cap and marked truncated. A declared `Content-Length` above the cap does not permit unbounded buffering.

The transport must not block Electron's main process; it runs inside the existing utility process and uses asynchronous network APIs.

### HTTP Failures

- `429` maps to `rate_limited`.
- cancellation maps to `cancelled`.
- deadline, DNS, connection, and transient `5xx` failures map to `upstream_unavailable`.
- malformed redirects, invalid framing, and unsupported protocol behavior map to `upstream_protocol_error`.
- invalid input maps to `invalid_input`.
- blocked destinations map to `permission_denied`.

Safe errors do not include response bodies, authorization material, complete query strings, DNS internals, or private filesystem information. Full requested URLs and fetched content are excluded from application logs.

## Capability Registration

The generated URL Fetch package is registered through both explicit review surfaces.

### Metadata catalog

`catalog.ts` imports only the manifest and constructs a frozen `BundledCapability` entry with:

- review status;
- tool names;
- permission digest;
- renderer-safe metadata projection.

The catalog's manifest typing must become generic over `CapabilityManifest` rather than inheriting the concrete Web Search manifest type.

### Executable host registry

`host-registry.ts` imports the executable URL Fetch definition and adds it to the hosted definition map. The utility host remains the only process that resolves executable capability definitions.

No renderer-provided package path, module name, or capability code is resolved dynamically.

## Renderer Behavior

No new route, page, dashboard, or capability-specific setup UI is introduced.

The existing Capability Library and chat picker display URL Fetch from catalog DTOs. Since URL Fetch has no settings or secrets, it is immediately ready after installation and can be added to a session without a setup form.

The existing detail view receives one focused adjustment: the reserved `public-web` permission is rendered with a user-facing label that clearly communicates broad public internet access. Exact-host capabilities such as Web Search remain unchanged.

Activation, deactivation, active-state display, OpenCode reload messaging, and failure recovery continue through the current shared capability flow.

## Smoke Harness

The current Web Search smoke seam is refactored into a generic driver plus capability scenarios:

```text
scripts/capability-smoke/
├── driver.mjs
├── run.mjs
├── web-search-scenario.mjs
└── url-fetch-scenario.mjs
```

The driver owns application launch, configured-agent discovery, worktree selection, session creation, prompt delivery, idle waiting, generic capability configuration/activation/deactivation, snapshots, sanitized log inspection, and cleanup.

A scenario owns only capability-specific prompts and assertions. This boundary is the initial Codex/OpenCode compatibility harness and is designed for later extraction into the public toolkit.

The package scripts expose:

```bash
npm run smoke:capabilities:web-search
npm run smoke:capabilities:url-fetch
npm run smoke:capabilities
```

The aggregate command runs both scenarios. All real smoke commands require a packaged application and authenticated supported Codex/OpenCode installations. They are opt-in and excluded from normal CI.

### URL Fetch Scenario

For each supported agent, the scenario:

1. creates a session and completes an initial turn without URL Fetch;
2. activates URL Fetch after the session already has history;
3. requests content from a stable public static page;
4. verifies that the assistant used `fetch_url`;
5. verifies attributed page content and preserved prior history;
6. deactivates URL Fetch;
7. asks for a response that requires the removed tool;
8. verifies the tool is unavailable and the session remains usable.

Codex must observe the MCP refresh without history loss. OpenCode must complete its coordinated reload, resume the same history, and observe the tool on the next turn.

The scenario never stores fetched content, complete URLs with sensitive query values, credentials, or raw process logs in committed artifacts.

## Testing Strategy

### Starter Kit tests

Temporary repository fixtures verify:

- valid package generation;
- deterministic naming and rendering;
- metadata and executable registration;
- stable sorted entries;
- invalid slug and tool rejection;
- duplicate package, ID, and tool rejection;
- missing or duplicate marker rejection;
- path containment;
- idempotent failure on a second run;
- rollback after simulated write failures;
- structural SDK validation and TypeScript compatibility of generated output.

The tests call the generation core directly. CLI parsing and exit behavior receive focused wrapper tests.

### URL policy tests

Table-driven tests cover public and blocked IPv4/IPv6 ranges, mapped addresses, hostname normalization, credentials, ports, schemes, mixed DNS answers, and redirect targets.

### Transport tests

Injected resolver, connector, clock, and response seams verify:

- validated resolution is used for the actual connection;
- host and TLS identity remain the original hostname;
- each redirect is revalidated;
- redirect limit, loop, and downgrade handling;
- timeout and cancellation cleanup;
- streaming size enforcement;
- HTTP status mapping;
- no network access during unit tests.

### Content extraction tests

Fixtures cover title extraction, scripts and styles removal, headings, paragraphs, lists, links, preformatted text, malformed but parseable HTML, plain text, JSON, empty content, encoding defaults, and truncation messaging.

### Capability tests

An injected transport verifies the `fetch_url` schema, formatted attribution, cancellation propagation, safe errors, manifest permissions, compatibility, and SDK output bounds.

### Application integration tests

Existing catalog, host, service, IPC, preload, renderer, and adapter tests are updated to verify that:

- Web Search and URL Fetch are both listed;
- only safe metadata reaches the renderer;
- `fetch_url` is absent before activation;
- activation exposes only the selected capability tools;
- deactivation removes `fetch_url`;
- activation failure rolls back;
- both adapters consume the same MCP capability connection;
- URL Fetch appears in the Library and chat picker;
- `public-web` has a clear accessible label.

### Verification commands

The implementation is not complete until the relevant focused tests and the project checks pass:

```bash
npm test -- scripts/capability-kit capabilities/url-fetch packages/capability-sdk
npm run typecheck
npm run lint
npm test
npm run build:capability-host
npm run package
```

The renderer build performed by the Forge packaging flow verifies the catalog and permission-label changes. Real smoke commands run only when the required packaged executable and authenticated agents are available.

## Documentation

`docs/capabilities/authoring-capabilities.md` is updated to document:

- the local create command;
- generated naming and compatibility defaults;
- the two explicit review registrations;
- use of `public-web` versus exact hosts;
- mandatory SSRF protection for broad network capabilities;
- narrowly scoped, reviewed runtime dependencies;
- prohibition on importing Electron or internal application modules;
- offline tests and optional real compatibility smoke scenarios;
- the fact that the local generator is not yet a public packaging interface.

The generated package also contains concise comments or a README only where they provide actionable next steps; documentation is not duplicated across every template file.

## Future Extraction to a Public CLI

After the URL Fetch smoke scenarios pass reliably, the migration to approach 3 is expected to be:

1. move naming, rendering, validation orchestration, filesystem abstraction, and templates into `packages/capability-cli`;
2. add a package `bin` entry;
3. keep Agentic Worktrees registry editing as a repository-local adapter;
4. add public `validate`, `test`, and `pack` commands around the proven SDK and compatibility harness;
5. version the template and generated project contract;
6. define distribution metadata and package resolution separately from bundled review;
7. publish only after third-party execution, signatures, updates, and sandbox expectations have their own approved design.

The extraction must not require changes to generated capability business logic or the URL Fetch package. Only the invocation and final registration/packaging adapter should change.

## Out of Scope

This increment does not include:

- browser rendering or JavaScript execution;
- cookies, sessions, custom request headers, authentication, or proxies;
- binary files, PDF extraction, images, audio, or video;
- caching or persistent fetched content;
- worktree, project, or global capability scopes;
- skills, capability packs, commands, events, or renderer extensions;
- dynamic package discovery;
- installation from npm, GitHub, Pi, or OpenCode;
- a remote registry or public marketplace;
- publisher identity, signatures, lockfiles, updates, or revocation;
- a public CLI package;
- automatic plugin portability analysis or AI-assisted porting.

## Acceptance Criteria

The design is satisfied when:

1. `npm run capability:create -- <slug> --tool <name>` creates a valid generic capability skeleton.
2. The generator leaves no partial changes, never overwrites existing work, and does not duplicate registrations.
3. Metadata and executable registration remain separate and explicit.
4. Generator core and templates do not depend on Electron or the repository registry layout.
5. URL Fetch is a separate SDK-based workspace package and appears in the existing Capability Library and chat picker.
6. `fetch_url` retrieves supported static public content and returns readable, attributed, bounded text.
7. Private, local, reserved, mixed-resolution, rebinding, unsafe redirect, and HTTPS downgrade paths are blocked.
8. Timeouts, cancellation, response-size limits, redirects, content types, and safe errors are enforced.
9. URL Fetch crashes or upstream failures do not crash Electron or leave the agent session unusable.
10. Activation after a completed turn works for Codex and OpenCode, preserving history and exposing the tool on the next turn.
11. Deactivation removes the tool and preserves a usable session.
12. The smoke driver supports Web Search and URL Fetch as independent scenarios.
13. Offline focused tests, project typecheck, lint, full tests, capability-host build, and packaging pass.
14. Optional real URL Fetch smoke scenarios pass for authenticated supported Codex and OpenCode installations before public CLI extraction begins.
15. Authoring documentation explains the local workflow, permission model, dependency boundary, tests, and future public-CLI limitation.
