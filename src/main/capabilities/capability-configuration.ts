import { CapabilityError, type CapabilityManifest } from "@agentic-worktrees/capability-sdk";
import type { CapabilityConfigureRequest } from "../../shared/ipc/schemas";
import type { CapabilitySettingRecord } from "./capability-repository";

export interface PreparedSecretChange {
  key: string;
  value: string | null | undefined;
  existingRef?: string;
}

export interface PreparedCapabilityConfiguration {
  values: CapabilitySettingRecord[];
  secrets: PreparedSecretChange[];
}

function invalid(key: string): never {
  throw new CapabilityError("invalid_input", `Invalid capability setting: ${key}.`);
}

export function prepareCapabilityConfiguration(
  manifest: CapabilityManifest,
  input: Pick<CapabilityConfigureRequest, "settings" | "secrets">,
  existing: readonly CapabilitySettingRecord[],
): PreparedCapabilityConfiguration {
  for (const key of Object.keys(input.settings)) {
    const definition = manifest.settings[key];
    if (!definition) throw new CapabilityError("invalid_input", `Unknown capability setting: ${key}.`);
    if (definition.type === "secret") invalid(key);
  }
  for (const key of Object.keys(input.secrets)) {
    const definition = manifest.settings[key];
    if (!definition) throw new CapabilityError("invalid_input", `Unknown capability setting: ${key}.`);
    if (definition.type !== "secret") invalid(key);
  }

  const values: CapabilitySettingRecord[] = [];
  const secrets: PreparedSecretChange[] = [];
  for (const [key, definition] of Object.entries(manifest.settings)) {
    if (definition.type === "secret") {
      const existingRef = existing.find((setting) => setting.key === key)?.secretRef;
      const value = input.secrets[key];
      if (definition.required && value === null) invalid(key);
      if (definition.required && value === undefined && !existingRef) invalid(key);
      secrets.push({ key, value, existingRef });
      continue;
    }

    let value: string | number | boolean | undefined = input.settings[key];
    if (value === undefined && "default" in definition) value = definition.default;
    if (value === undefined) {
      if (definition.required) invalid(key);
      continue;
    }
    if (definition.type === "string") {
      if (typeof value !== "string" || (definition.enum && !definition.enum.includes(value))) invalid(key);
    } else if (definition.type === "integer") {
      if (typeof value !== "number" || !Number.isInteger(value) || (definition.min !== undefined && value < definition.min) || (definition.max !== undefined && value > definition.max)) invalid(key);
    } else if (typeof value !== "boolean") invalid(key);
    values.push({ key, value });
  }
  return { values, secrets };
}
