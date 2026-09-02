import AjvConstructor from "ajv";
import { CapabilityError } from "./errors";
import type { CapabilityDefinition, CapabilityTool } from "./types";

const CAPABILITY_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const TOOL_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
export const PUBLIC_WEB_NETWORK_PERMISSION = "public-web" as const;
const NETWORK_HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function defineTool<Input>(tool: CapabilityTool<Input>): CapabilityTool<Input> {
  return Object.freeze(tool);
}

export function defineCapability(definition: {
  manifest: CapabilityDefinition["manifest"];
  tools: readonly CapabilityTool<unknown>[];
}): CapabilityDefinition {
  return Object.freeze({
    manifest: Object.freeze(definition.manifest),
    tools: Object.freeze([...definition.tools]),
  });
}

export function validateCapabilityDefinition(definition: CapabilityDefinition): CapabilityDefinition {
  const { manifest } = definition;
  if (!CAPABILITY_ID.test(manifest.id)) {
    throw new CapabilityError("invalid_input", "Invalid manifest.id.");
  }
  if (!manifest.name || !manifest.version || !manifest.sdkVersion || !manifest.description) {
    throw new CapabilityError("invalid_input", "Invalid capability manifest.");
  }
  for (const kind of ["codex", "opencode"] as const) {
    if (!(["supported", "unsupported"] as const).includes(manifest.compatibility[kind])) {
      throw new CapabilityError("invalid_input", `Invalid manifest.compatibility.${kind}.`);
    }
  }
  const networkPermissions = new Set<string>();
  for (const permission of manifest.permissions.network) {
    if ((permission !== PUBLIC_WEB_NETWORK_PERMISSION && !NETWORK_HOST.test(permission)) || networkPermissions.has(permission)) {
      throw new CapabilityError("invalid_input", "Invalid or duplicate network permission.");
    }
    networkPermissions.add(permission);
  }
  const secretSettings = Object.entries(manifest.settings)
    .filter(([, setting]) => setting.type === "secret")
    .map(([key]) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));
  if (secretSettings.some((secret) => !manifest.permissions.secrets.includes(secret))) {
    throw new CapabilityError("permission_denied", "A secret setting is not declared in permissions.");
  }
  const ajv = new AjvConstructor({ strict: true, allErrors: true });
  const names = new Set<string>();
  for (const tool of definition.tools) {
    if (!TOOL_NAME.test(tool.name)) {
      throw new CapabilityError("invalid_input", "Invalid tool name.");
    }
    if (names.has(tool.name)) {
      throw new CapabilityError("invalid_input", "Duplicate tool name.");
    }
    names.add(tool.name);
    try {
      ajv.compile(tool.inputSchema);
    } catch {
      throw new CapabilityError("invalid_input", "Invalid tool input JSON Schema.");
    }
  }
  return definition;
}
