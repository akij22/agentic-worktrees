import type { CapabilityDefinition } from "@agentic-worktrees/capability-sdk";
// capability-kit:host-imports:start
import webSearchCapability from "@agentic-worktrees/web-search-capability";
// capability-kit:host-imports:end

const hostedCapabilities = [
  // capability-kit:host-entries:start
  webSearchCapability,
  // capability-kit:host-entries:end
] as const;
const registry = new Map<string, CapabilityDefinition>(hostedCapabilities.map((capability) => [capability.manifest.id, capability]));
export function getHostedCapability(id: string): CapabilityDefinition | undefined { return registry.get(id); }
export function listHostedCapabilityIds(): readonly string[] { return Object.freeze([...registry.keys()]); }
