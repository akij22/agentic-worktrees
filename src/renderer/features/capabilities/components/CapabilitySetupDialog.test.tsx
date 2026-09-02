// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapabilityDetailDto } from "../../../../shared/ipc/schemas";
import { CapabilitySetupDialog } from "./CapabilitySetupDialog";

afterEach(cleanup);
const webSearch: CapabilityDetailDto = {
  id: "agentic-worktrees.web-search", name: "Web Search", version: "0.1.0", description: "Search", category: "web-browser", compatibility: { codex: "supported", opencode: "supported" }, state: "needs_setup", secretConfigured: true,
  sdkVersion: "^0.1.0", author: { name: "Agentic Worktrees" }, license: "MIT", permissions: { network: ["api.exa.ai"], secrets: ["exa-api-key"] }, settings: [
    { key: "providerMode", type: "string", default: "auto", enum: ["auto"] }, { key: "resultLimit", type: "integer", default: 5, min: 1, max: 20 }, { key: "exaApiKey", type: "secret", required: false },
  ], reviewStatus: "bundled-reviewed", providedTools: ["web_search"], permissionDigest: "digest",
};
const urlFetch: CapabilityDetailDto = { ...webSearch, id: "agentic-worktrees.url-fetch", name: "URL Fetch", secretConfigured: false, permissions: { network: ["public-web"], secrets: [] }, settings: [], providedTools: ["fetch_url"], permissionDigest: "url-digest" };

describe("CapabilitySetupDialog", () => {
  it("renders manifest-driven Web Search fields and permissions", () => {
    render(<CapabilitySetupDialog open capability={webSearch} onOpenChange={vi.fn()} onConfigure={vi.fn()} />);
    expect((screen.getByLabelText("providerMode") as HTMLSelectElement).value).toBe("auto");
    expect((screen.getByLabelText("resultLimit") as HTMLInputElement).max).toBe("20");
    expect((screen.getByLabelText("exaApiKey") as HTMLInputElement).type).toBe("password");
    expect(screen.getByText("api.exa.ai")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear exaApiKey" })).toBeTruthy();
  });

  it("submits a settings-free capability after showing broad permission", async () => {
    const configure = vi.fn().mockResolvedValue({});
    render(<CapabilitySetupDialog open capability={urlFetch} onOpenChange={vi.fn()} onConfigure={configure} />);
    expect(screen.getByText("Public HTTP/HTTPS internet")).toBeTruthy();
    expect(screen.getByText("No additional settings are required.")).toBeTruthy();
    expect(screen.queryByLabelText("exaApiKey")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Accept and continue" }));
    expect(configure).toHaveBeenCalledWith({ capabilityId: urlFetch.id, acceptedPermissionDigest: "url-digest", settings: {}, secrets: {} });
  });
});
