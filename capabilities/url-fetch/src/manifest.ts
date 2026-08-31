import { PUBLIC_WEB_NETWORK_PERMISSION, type CapabilityManifest } from "@agentic-worktrees/capability-sdk";
export const urlFetchManifest: CapabilityManifest = {
  id: "agentic-worktrees.url-fetch", name: "URL Fetch", version: "0.1.0", sdkVersion: "^0.1.0",
  description: "Fetch readable text from a public HTTP or HTTPS URL.", category: "web-browser", author: { name: "Agentic Worktrees" }, license: "MIT",
  compatibility: { codex: "supported", opencode: "supported" },
  provenance: { kind: "first-party", source: "agentic-worktrees", package: "@agentic-worktrees/url-fetch-capability", sourceVersion: "0.1.0", repository: "https://github.com/akij22/Agentic-Worktrees" },
  permissions: { network: [PUBLIC_WEB_NETWORK_PERMISSION], secrets: [] }, settings: {},
};
