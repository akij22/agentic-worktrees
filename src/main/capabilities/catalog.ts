import { createHash } from "node:crypto";
import { CapabilityError, type CapabilityManifest } from "@agentic-worktrees/capability-sdk";
// capability-kit:catalog-imports:start
import { urlFetchManifest } from "@agentic-worktrees/url-fetch-capability";
import { webSearchManifest } from "@agentic-worktrees/web-search-capability";
// capability-kit:catalog-imports:end
import type { CapabilityDetailDto, CapabilityStateDto, CapabilitySummaryDto } from "../../shared/ipc/schemas";

export interface BundledCapability {
  readonly manifest: CapabilityManifest;
  readonly reviewStatus: "bundled-reviewed";
  readonly toolNames: readonly string[];
}
function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested); }
  return value;
}
export function createBundledCapability(manifest: CapabilityManifest, toolNames: readonly string[]): BundledCapability {
  return Object.freeze({ manifest: deepFreeze(manifest), reviewStatus: "bundled-reviewed" as const, toolNames: Object.freeze([...toolNames]) });
}
const bundledCapabilityEntries = [
  // capability-kit:catalog-entries:start
  createBundledCapability(urlFetchManifest, ["fetch_url"]),
  createBundledCapability(webSearchManifest, ["web_search"]),
  // capability-kit:catalog-entries:end
] as const;
const bundledCapabilities = new Map<string, BundledCapability>(bundledCapabilityEntries.map((entry) => [entry.manifest.id, entry]));

export function permissionDigest(manifest: CapabilityManifest): string { return createHash("sha256").update(JSON.stringify({ permissions: manifest.permissions, version: manifest.version })).digest("hex"); }
export function listBundledCapabilities(): readonly BundledCapability[] { return Object.freeze([...bundledCapabilities.values()]); }
export function getBundledCapability(id: string): BundledCapability { const capability = bundledCapabilities.get(id); if (!capability) throw new CapabilityError("invalid_input", "Unknown capability."); return capability; }
export function toCapabilitySummaryDto(capability: BundledCapability, state: CapabilityStateDto = "available", secretConfigured = false): CapabilitySummaryDto {
  const { manifest } = capability; return { id: manifest.id, name: manifest.name, version: manifest.version, description: manifest.description, category: manifest.category, compatibility: manifest.compatibility, state, secretConfigured };
}
export function toCapabilityDetailDto(capability: BundledCapability, state: CapabilityStateDto = "available", secretConfigured = false): CapabilityDetailDto {
  const { manifest } = capability;
  return { ...toCapabilitySummaryDto(capability, state, secretConfigured), sdkVersion: manifest.sdkVersion, author: manifest.author, license: manifest.license, provenance: manifest.provenance, permissions: manifest.permissions,
    settings: Object.entries(manifest.settings).map(([key, definition]) => { const projected: CapabilityDetailDto["settings"][number] = { key, type: definition.type }; if ("required" in definition && definition.required !== undefined) projected.required = definition.required; if ("default" in definition && definition.default !== undefined) projected.default = definition.default; if (definition.type === "string" && definition.enum) projected.enum = [...definition.enum]; if (definition.type === "integer") { if (definition.min !== undefined) projected.min = definition.min; if (definition.max !== undefined) projected.max = definition.max; } return projected; }),
    reviewStatus: capability.reviewStatus, providedTools: [...capability.toolNames], permissionDigest: permissionDigest(manifest) };
}
