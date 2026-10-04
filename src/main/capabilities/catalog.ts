import { createHash } from "node:crypto";
import {
  CapabilityError,
  type CapabilityManifest,
} from "@agentic-worktrees/capability-sdk";
// capability-kit:catalog-imports:start
import { urlFetchManifest } from "@agentic-worktrees/url-fetch-capability";
import { webSearchManifest } from "@agentic-worktrees/web-search";
// capability-kit:catalog-imports:end
import type {
  CapabilityDetailDto,
  CapabilityStateDto,
  CapabilitySummaryDto,
} from "../../shared/ipc/schemas";
import type { InstalledCapabilityCatalog } from "./installed-catalog";

export type CapabilityRuntimeDescriptor =
  | { kind: "bundled"; capabilityId: string; version: string }
  | {
      kind: "managed";
      capabilityId: string;
      packageName: string;
      version: string;
      packageRoot: string;
      manifest: string;
      entry: string;
      contentDigest: string;
    };
export interface CapabilityCatalogEntry {
  readonly manifest: CapabilityManifest;
  readonly reviewStatus:
    "bundled-reviewed" | "official-reviewed" | "unreviewed";
  readonly trust: "built-in" | "official" | "community";
  readonly source: "bundled" | "npm";
  readonly packageName?: string;
  readonly blocked?: boolean;
  readonly toolNames: readonly string[];
  readonly runtime: CapabilityRuntimeDescriptor;
}
export interface CapabilityCatalog {
  list(): readonly CapabilityCatalogEntry[];
  get(capabilityId: string, version?: string): CapabilityCatalogEntry;
  refresh(): Promise<void>;
}
export type BundledCapability = CapabilityCatalogEntry;

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>))
      deepFreeze(nested);
  }
  return value;
}
export function createBundledCapability(
  manifest: CapabilityManifest,
  toolNames: readonly string[],
): BundledCapability {
  return deepFreeze({
    manifest,
    reviewStatus: "bundled-reviewed" as const,
    trust: "built-in" as const,
    source: "bundled" as const,
    toolNames: [...toolNames],
    runtime: {
      kind: "bundled" as const,
      capabilityId: manifest.id,
      version: manifest.version,
    },
  });
}
const bundledCapabilityEntries = [
  // capability-kit:catalog-entries:start
  createBundledCapability(urlFetchManifest, ["fetch_url"]),
  createBundledCapability(webSearchManifest, ["web_search"]),
  // capability-kit:catalog-entries:end
] as const;
const bundledCapabilities = new Map(
  bundledCapabilityEntries.map((entry) => [entry.manifest.id, entry]),
);

export function createCapabilityCatalog(
  installed: InstalledCapabilityCatalog,
): CapabilityCatalog {
  const compose = (): readonly CapabilityCatalogEntry[] => {
    const entries: CapabilityCatalogEntry[] = [...bundledCapabilityEntries];
    for (const item of installed.list()) {
      const bundled = bundledCapabilities.get(item.record.itemId);
      if (bundled) {
        if (item.record.state === "blocked" && item.record.activeVersion === bundled.manifest.version) {
          const index = entries.findIndex(entry => entry.manifest.id === item.record.itemId);
          entries[index] = deepFreeze({ ...bundled, blocked: true });
        }
        continue;
      }
      const version = item.record.activeVersion;
      if (!version) continue;
      entries.push(
        deepFreeze({
          manifest: item.descriptor.manifest,
          reviewStatus: item.record.reviewStatus,
          trust: item.record.trust,
          source: "npm" as const,
          packageName: item.record.packageName,
          blocked: item.record.state === "blocked",
          toolNames: item.descriptor.tools.map((tool) => tool.name),
          runtime: {
            kind: "managed" as const,
            capabilityId: item.record.itemId,
            packageName: item.record.packageName,
            version,
            packageRoot: item.packageRoot,
            manifest: item.manifestRelativePath,
            entry: item.entryRelativePath,
            contentDigest: item.record.activeContentDigest!,
          },
        }),
      );
    }
    entries.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
    const ids = new Set<string>();
    const tools = new Set<string>();
    for (const entry of entries) {
      if (ids.has(entry.manifest.id))
        throw new CapabilityError("invalid_input", "Duplicate capability ID.");
      ids.add(entry.manifest.id);
      for (const tool of entry.toolNames) {
        if (tools.has(tool))
          throw new CapabilityError(
            "invalid_input",
            "Duplicate capability tool.",
          );
        tools.add(tool);
      }
    }
    return deepFreeze(entries);
  };
  return {
    list: compose,
    get(id, version) {
      const found = compose().find(
        (entry) =>
          entry.manifest.id === id &&
          (version === undefined || entry.manifest.version === version),
      );
      if (!found)
        throw new CapabilityError("invalid_input", "Unknown capability.");
      return found;
    },
    refresh: () => installed.refresh(),
  };
}
export function permissionDigest(manifest: CapabilityManifest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        permissions: manifest.permissions,
        version: manifest.version,
      }),
    )
    .digest("hex");
}
export function listBundledCapabilities(): readonly BundledCapability[] {
  return Object.freeze([...bundledCapabilities.values()]);
}
export function getBundledCapability(id: string): BundledCapability {
  const capability = bundledCapabilities.get(id);
  if (!capability)
    throw new CapabilityError("invalid_input", "Unknown capability.");
  return capability;
}
export function toCapabilitySummaryDto(
  capability: CapabilityCatalogEntry,
  state: CapabilityStateDto = "available",
  secretConfigured = false,
): CapabilitySummaryDto {
  const { manifest } = capability;
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    category: manifest.category,
    compatibility: manifest.compatibility,
    state: capability.blocked ? "unavailable" : state,
    secretConfigured,
    installationState: capability.blocked
      ? "blocked"
      : state === "needs_setup"
        ? "needs_setup"
        : "installed",
    source: capability.source,
    ...(capability.packageName ? { packageName: capability.packageName } : {}),
    trust: capability.trust,
    reviewStatus: capability.reviewStatus,
  };
}
export function toCapabilityDetailDto(
  capability: CapabilityCatalogEntry,
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
      const projected: CapabilityDetailDto["settings"][number] = {
        key,
        type: definition.type,
      };
      if ("required" in definition && definition.required !== undefined)
        projected.required = definition.required;
      if ("default" in definition && definition.default !== undefined)
        projected.default = definition.default;
      if (definition.type === "string" && definition.enum)
        projected.enum = [...definition.enum];
      if (definition.type === "integer") {
        if (definition.min !== undefined) projected.min = definition.min;
        if (definition.max !== undefined) projected.max = definition.max;
      }
      return projected;
    }),
    activeRunCount: 0,
    providedTools: [...capability.toolNames],
    permissionDigest: permissionDigest(manifest),
  };
}
