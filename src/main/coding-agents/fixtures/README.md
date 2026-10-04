# OpenCode protocol fixtures

`opencode-runtime-provider.mjs` is an application-owned, launched HTTP/event-stream fixture. It exercises the public SDK protocol without replacing application services with mocks.

The following public template fixtures are copied verbatim from the MIT-licensed [OpenCode v1.18.30 source](https://github.com/anomalyco/opencode/tree/v1.18.30):

- `opencode-1.18.30-customize.txt`: `packages/core/src/plugin/skill/customize-opencode.md`
- `opencode-1.18.30-initialize.txt`: `packages/opencode/src/command/template/initialize.txt`
- `opencode-1.18.30-review.txt`: `packages/opencode/src/command/template/review.txt`

The upstream license is reproduced in `OPENCODE-LICENSE.txt`. Runtime verification pins the content fingerprints; these files provide observable baseline parity in launched protocol tests. They contain public provider templates, not user prompts, Skill packages, or session data.

## Codex fixtures

`codex-runtime-provider.mjs` launches a deterministic JSON-RPC app-server boundary. `codex-runtime-evidence-fixture.ts` creates real database/evidence/attestation services as test arrangement. `codex-local-responses-fixture.ts` serves inert local Responses events to the actual pinned Codex binary; it discards request bodies and headers and never requires a user model credential.

The Responses event shapes follow the public [Codex rust-v0.154.0 test fixtures](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/tests/common/responses.rs). These fixtures are application-authored protocol data, with no copied provider templates or user captures. Temporary provider records contain only synthetic test inputs and stay outside the repository. The production parser's full native Skill envelope and private rollout schema are independently exercised by the pinned binary.
