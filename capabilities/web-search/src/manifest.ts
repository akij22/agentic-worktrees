import type { CapabilityManifest } from "@agentic-worktrees/capability-sdk";

export const webSearchManifest: CapabilityManifest = {
  id: "agentic-worktrees.web-search",
  name: "Web Search",
  version: "0.1.0",
  sdkVersion: "^0.1.0",
  description: "Search the web using Exa in automatic keyless mode.",
  category: "web-browser",
  author: { name: "Agentic Worktrees" },
  license: "MIT",
  compatibility: { codex: "supported", opencode: "supported" },
  provenance: {
    kind: "manual-port",
    source: "pi-extension",
    package: "pi-web-access",
    sourceVersion: "0.25.0",
    repository: "https://github.com/nicobailon/pi-web-access",
  },
  permissions: {
    network: ["mcp.exa.ai", "api.exa.ai"],
    secrets: ["exa-api-key"],
  },
  settings: {
    providerMode: { type: "string", enum: ["auto"], default: "auto" },
    exaApiKey: { type: "secret", required: false },
    resultLimit: { type: "integer", default: 5, min: 1, max: 20 },
  },
};
