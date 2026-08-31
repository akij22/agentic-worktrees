import { describe, expect, it } from "vitest";
import type { CapabilityDetailDto } from "../../../../shared/ipc/schemas";
import { capabilityConfigureRequest, initialCapabilityFormValues } from "./capability-form";

const base: CapabilityDetailDto = {
  id: "agentic-worktrees.web-search", name: "Web Search", version: "0.1.0", description: "Search", category: "web-browser",
  compatibility: { codex: "supported", opencode: "supported" }, state: "needs_setup", secretConfigured: true,
  sdkVersion: "^0.1.0", author: { name: "Agentic Worktrees" }, license: "MIT", permissions: { network: ["api.exa.ai"], secrets: ["exa-api-key"] },
  settings: [{ key: "providerMode", type: "string", default: "auto", enum: ["auto"] }, { key: "resultLimit", type: "integer", default: 5, min: 1, max: 20 }, { key: "exaApiKey", type: "secret", required: false }],
  reviewStatus: "bundled-reviewed", providedTools: ["web_search"], permissionDigest: "digest",
};
const urlFetch: CapabilityDetailDto = { ...base, id: "agentic-worktrees.url-fetch", name: "URL Fetch", secretConfigured: false, settings: [], permissions: { network: ["public-web"], secrets: [] }, providedTools: ["fetch_url"], permissionDigest: "url-digest" };

describe("capability form", () => {
  it("derives public defaults without exposing secrets", () => {
    expect(initialCapabilityFormValues(base)).toEqual({ providerMode: "auto", resultLimit: 5 });
  });
  it("builds a settings-free request", () => {
    expect(capabilityConfigureRequest(urlFetch, {}, {}, new Set())).toEqual({ capabilityId: urlFetch.id, acceptedPermissionDigest: "url-digest", settings: {}, secrets: {} });
  });
  it("sends replacements, clears configured secrets, and omits blank untouched secrets", () => {
    expect(capabilityConfigureRequest(base, { providerMode: "auto", resultLimit: 10 }, { exaApiKey: " new-key " }, new Set()).secrets).toEqual({ exaApiKey: " new-key " });
    expect(capabilityConfigureRequest(base, { providerMode: "auto", resultLimit: 5 }, {}, new Set(["exaApiKey"])).secrets).toEqual({ exaApiKey: null });
    expect(capabilityConfigureRequest({ ...base, secretConfigured: false }, { providerMode: "auto", resultLimit: 5 }, { exaApiKey: "  " }, new Set()).secrets).toEqual({});
  });
});
