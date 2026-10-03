# OpenCode protocol fixtures

`opencode-runtime-provider.mjs` is an application-owned, launched HTTP/event-stream fixture. It exercises the public SDK protocol without replacing application services with mocks.

The following public template fixtures are copied verbatim from the MIT-licensed [OpenCode v1.18.30 source](https://github.com/anomalyco/opencode/tree/v1.18.30):

- `opencode-1.18.30-customize.txt`: `packages/core/src/plugin/skill/customize-opencode.md`
- `opencode-1.18.30-initialize.txt`: `packages/opencode/src/command/template/initialize.txt`
- `opencode-1.18.30-review.txt`: `packages/opencode/src/command/template/review.txt`

The upstream license is reproduced in `OPENCODE-LICENSE.txt`. Runtime verification pins the content fingerprints; these files provide observable baseline parity in launched protocol tests. They contain public provider templates, not user prompts, Skill packages, or session data.
