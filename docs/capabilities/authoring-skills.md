# Authoring Agent Skills

Agentic Worktrees installs portable, provider-native Agent Skills. A skill is an instruction package, not an executable Capability.

## Layout

```text
security-review/
├── SKILL.md
└── references/
    └── checklist.md
```

`SKILL.md` must begin with YAML frontmatter:

```yaml
---
name: security-review
description: Reviews authentication and authorization boundaries.
disable-model-invocation: false
license: MIT
---
```

The directory and `name` must match. IDs use lowercase letters, digits, and single hyphens, are at most 64 characters, and cannot begin or end with a hyphen. Descriptions are required and limited to 1,024 characters.

Optional portable metadata (`license`, `compatibility`, `metadata`, and `allowed-tools`) is retained but never grants tools. Set `disable-model-invocation: true` to prevent automatic discovery while retaining explicit `/skill:<id>` selection.

## Security limits

The first runtime accepts `SKILL.md` and UTF-8 Markdown/text references only. It rejects scripts, executable or binary files, symlinks, hard links, traversal, absolute paths, more than 64 files, files over 256 KiB, packages over 1 MiB, and nesting deeper than eight directories.

Validated packages are copied to application-owned versioned storage. Renderer code never receives managed paths. Local versions are derived deterministically from the package digest.

## Installation and use

1. Open **Marketplace**.
2. Choose **Install skill** and select the skill directory.
3. Review compatibility and the sanitized instruction preview.
4. In a coding-agent composer, type `/skill:<id>` and select the skill. Only one explicit skill may be selected per turn.

Installed compatible skills are available to native provider discovery unless automatic invocation is disabled. Agentic Worktrees does not inject skill bodies into prompts and does not fall back to MCP when native skill support is unavailable.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run package
```

Packaged, opt-in provider checks require `AW_SMOKE_EXECUTABLE` and an already authenticated local provider; the harness never starts an interactive login:

```bash
npm run smoke:skills:codex
npm run smoke:skills:opencode
```
