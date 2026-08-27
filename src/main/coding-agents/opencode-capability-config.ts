import type { CodingAgentCapabilityConnection } from "./types";

export function normalizeOpenCodeIdentifier(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_");
  return normalized || "session";
}

export function buildOpenCodeRuntimeConfig(connections: readonly CodingAgentCapabilityConnection[]) {
  const mcp: Record<string, unknown> = {};
  const agent: Record<string, unknown> = {
    build: { permission: { bash: "ask" } },
  };
  for (const connection of connections) {
    const profileId = normalizeOpenCodeIdentifier(connection.profileId);
    const serverName = normalizeOpenCodeIdentifier(connection.serverName);
    mcp[serverName] = {
      type: "remote",
      url: connection.url,
      headers: { Authorization: connection.authorizationHeader },
    };
    agent[profileId] = {
      mode: "primary",
      permission: {
        bash: "ask",
        "aw_*": "deny",
        [`${serverName}_*`]: "allow",
      },
    };
  }
  return { ...(Object.keys(mcp).length ? { mcp } : {}), agent };
}
