import { createHash } from "node:crypto";
import { CapabilityError } from "@agentic-worktrees/capability-sdk";
import { webSearchManifest } from "@agentic-worktrees/web-search-capability";
import type { CapabilityDetailDto, CapabilityStateDto, CapabilitySummaryDto } from "../../shared/ipc/schemas";

export interface BundledCapability {
  readonly manifest: typeof webSearchManifest;
  readonly reviewStatus: "bundled-reviewed";
  readonly toolNames: readonly string[];
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

const entry: BundledCapability = Object.freeze({
  manifest: deepFreeze(webSearchManifest),
  reviewStatus: "bundled-reviewed" as const,
  toolNames: Object.freeze(["web_search"]),
});
const bundledCapabilities = new Map<string, BundledCapability>([[webSearchManifest.id, entry]]);

export function permissionDigest(manifest = webSearchManifest): string {
  return createHash("sha256").update(JSON.stringify({ permissions: manifest.permissions, version: manifest.version })).digest("hex");
}

export function listBundledCapabilities(): readonly BundledCapability[] {
  return Object.freeze([...bundledCapabilities.values()]);
}

export function getBundledCapability(id: string): BundledCapability {
  const capability = bundledCapabilities.get(id);
  if (!capability) throw new CapabilityError("invalid_input", "Unknown capability.");
  return capability;
}

export function toCapabilitySummaryDto(
  capability: BundledCapability,
  state: CapabilityStateDto = "available",
  secretConfigured = false,
): CapabilitySummaryDto {
  const { manifest } = capability;
  return {
    id: manifest.id, name: manifest.name, version: manifest.version,
    description: manifest.description, category: manifest.category,
    compatibility: manifest.compatibility, state, secretConfigured,
  };
}

export function toCapabilityDetailDto(
  capability: BundledCapability,
  state: CapabilityStateDto = "available",
  secretConfigured = false,
): CapabilityDetailDto {
  const { manifest } = capability;
  return {
    ...toCapabilitySummaryDto(capability, state, secretConfigured),
    sdkVersion: manifest.sdkVersion,
    author: manifest.author,
    license: manifest.license,
    provenance: manifest.provenance,
    permissions: manifest.permissions,
    settings: Object.entries(manifest.settings).map(([key, definition]) => {
      const projected: CapabilityDetailDto["settings"][number] = { key, type: definition.type };
      if ("required" in definition && definition.required !== undefined) projected.required = definition.required;
      if ("default" in definition && definition.default !== undefined) projected.default = definition.default;
      if (definition.type === "string" && definition.enum) projected.enum = [...definition.enum];
      if (definition.type === "integer") {
        if (definition.min !== undefined) projected.min = definition.min;
        if (definition.max !== undefined) projected.max = definition.max;
      }
      return projected;
    }),
    reviewStatus: capability.reviewStatus,
    providedTools: [...capability.toolNames],
    permissionDigest: permissionDigest(manifest),
  };
}
