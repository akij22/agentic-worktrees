# Agentic Worktrees

Agentic Worktrees coordinates AI coding work in isolated worktrees and controls which reusable abilities can influence each worktree.

## Language

**Resource**:
The internal category containing both Capabilities and Skills. Keep this term internal when a user-facing label can name the concrete kind.
_Avoid_: Capability as an umbrella term, plugin

**Capability**:
An executable Resource that adds operational tools or integrations to coding agents.
_Avoid_: Skill, generic extension

**Skill**:
An instructional Resource that a coding agent loads through its native skill mechanism.
_Avoid_: Capability, prompt preset

**Managed Skill isolation**:
The guarantee that a Worktree can discover or load through managed Skill channels only the Resource Skills in its verified Assignment generation. It does not imply filesystem sandboxing or removal of instructions already present in conversation history.
_Avoid_: Filesystem isolation, Skill confidentiality

**Assignment**:
The persisted decision that makes one installed Resource available to one Worktree.
_Avoid_: Activation, installation

**Worktree Runtime**:
The provider process owned for one coding-agent kind and one Worktree, within which that Worktree's provider sessions execute.
_Avoid_: Global runtime, session process

**Installed**:
The Resource is present in the user's library but is not necessarily assigned to a Worktree.
_Avoid_: Enabled, active

**Applying**:
An Assignment change has been requested but its target runtime state has not yet been verified.
_Avoid_: Enabled, active

**Enabled**:
The assigned Resource has been applied and verified for the relevant coding-agent runtime of a Worktree.
_Avoid_: Installed, requested

**Used**:
Trusted runtime evidence confirms that a Capability executed or a Skill entered the session's model context.
_Avoid_: Requested, discovered, inferred use

**Activity attribution**:
The verified relationship between Resource-use evidence and its exact application session. It remains unknown when provider and host observations cannot be paired without inference.
_Avoid_: Worktree ownership, timing correlation

**Failed**:
The requested Assignment generation could not be applied, while a prior verified generation may still remain available.
_Avoid_: Disabled

**Recovery required**:
The application cannot verify either the requested Assignment generation or restoration of the previous generation, so new agent work for the affected Worktree is unavailable pending recovery.
_Avoid_: Failed, Enabled
