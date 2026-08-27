import webSearchCapability from "@agentic-worktrees/web-search-capability";
import type { CapabilityDefinition } from "@agentic-worktrees/capability-sdk";

const registry = new Map<string, CapabilityDefinition>([[webSearchCapability.manifest.id, webSearchCapability]]);

export function getHostedCapability(id: string): CapabilityDefinition | undefined {
  return registry.get(id);
}

export function listHostedCapabilityIds(): readonly string[] {
  return Object.freeze([...registry.keys()]);
}
