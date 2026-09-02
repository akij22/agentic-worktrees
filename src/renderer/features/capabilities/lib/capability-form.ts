import type { CapabilityConfigureRequest, CapabilityDetailDto } from "../../../../shared/ipc/schemas";

export type CapabilityFormValue = string | number | boolean;
export type CapabilityFormValues = Record<string, CapabilityFormValue>;

export function initialCapabilityFormValues(capability: CapabilityDetailDto): CapabilityFormValues {
  return Object.fromEntries(capability.settings.flatMap((setting) => {
    if (setting.type === "secret") return [];
    if (setting.default !== undefined) return [[setting.key, setting.default]];
    if (setting.type === "string" && setting.required) return [[setting.key, ""]];
    if (setting.type === "integer" && setting.required) return [[setting.key, setting.min ?? 0]];
    if (setting.type === "boolean") return [[setting.key, false]];
    return [];
  }));
}

export function capabilityConfigureRequest(
  capability: CapabilityDetailDto,
  values: CapabilityFormValues,
  secretValues: Record<string, string>,
  clearedSecrets: ReadonlySet<string>,
): CapabilityConfigureRequest {
  const settings: CapabilityConfigureRequest["settings"] = {};
  const secrets: CapabilityConfigureRequest["secrets"] = {};
  for (const definition of capability.settings) {
    if (definition.type !== "secret") {
      const value = values[definition.key];
      if (value !== undefined) settings[definition.key] = value;
      continue;
    }
    if (clearedSecrets.has(definition.key)) secrets[definition.key] = null;
    else if (secretValues[definition.key]?.trim()) secrets[definition.key] = secretValues[definition.key];
  }
  return { capabilityId: capability.id, acceptedPermissionDigest: capability.permissionDigest, settings, secrets };
}

export function capabilityNetworkPermissionLabel(permission: string): string {
  return permission === "public-web" ? "Public HTTP/HTTPS internet" : permission;
}
