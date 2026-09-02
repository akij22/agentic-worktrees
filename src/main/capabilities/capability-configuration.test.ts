import { webSearchManifest } from "@agentic-worktrees/web-search-capability";
import type { CapabilityManifest } from "@agentic-worktrees/capability-sdk";
import { describe, expect, it } from "vitest";
import { prepareCapabilityConfiguration } from "./capability-configuration";

const emptyManifest: CapabilityManifest = {
  ...webSearchManifest,
  id: "agentic-worktrees.empty",
  settings: {},
  permissions: { network: [], secrets: [] },
};

describe("prepareCapabilityConfiguration", () => {
  it("validates public settings and retains an omitted optional secret", () => {
    expect(prepareCapabilityConfiguration(webSearchManifest, {
      settings: { providerMode: "auto", resultLimit: 7 }, secrets: {},
    }, [{ key: "exaApiKey", secretRef: "existing-ref" }])).toEqual({
      values: [{ key: "providerMode", value: "auto" }, { key: "resultLimit", value: 7 }],
      secrets: [{ key: "exaApiKey", value: undefined, existingRef: "existing-ref" }],
    });
  });

  it("uses defaults and supports replacing and removing secrets", () => {
    expect(prepareCapabilityConfiguration(webSearchManifest, { settings: {}, secrets: { exaApiKey: "replacement" } }, [])).toEqual({
      values: [{ key: "providerMode", value: "auto" }, { key: "resultLimit", value: 5 }],
      secrets: [{ key: "exaApiKey", value: "replacement", existingRef: undefined }],
    });
    expect(prepareCapabilityConfiguration(webSearchManifest, { settings: {}, secrets: { exaApiKey: null } }, [{ key: "exaApiKey", secretRef: "old" }]).secrets).toEqual([
      { key: "exaApiKey", value: null, existingRef: "old" },
    ]);
  });

  it("rejects unknown, misplaced, and invalid settings", () => {
    expect(() => prepareCapabilityConfiguration(webSearchManifest, { settings: { resultLimit: 21 }, secrets: {} }, [])).toThrow("resultLimit");
    expect(() => prepareCapabilityConfiguration(webSearchManifest, { settings: { unknown: true }, secrets: {} }, [])).toThrow("Unknown capability setting");
    expect(() => prepareCapabilityConfiguration(webSearchManifest, { settings: { exaApiKey: "secret" }, secrets: {} }, [])).toThrow("exaApiKey");
    expect(() => prepareCapabilityConfiguration(webSearchManifest, { settings: {}, secrets: { resultLimit: "secret" } }, [])).toThrow("resultLimit");
  });

  it("supports settings-free capabilities and enforces required secrets", () => {
    expect(prepareCapabilityConfiguration(emptyManifest, { settings: {}, secrets: {} }, [])).toEqual({ values: [], secrets: [] });
    const requiredSecretManifest: CapabilityManifest = { ...emptyManifest, settings: { token: { type: "secret", required: true } }, permissions: { network: [], secrets: ["token"] } };
    expect(() => prepareCapabilityConfiguration(requiredSecretManifest, { settings: {}, secrets: {} }, [])).toThrow("token");
  });
});
