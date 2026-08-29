// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapabilityDetailDto, CapabilitySummaryDto } from "../../../../shared/ipc/schemas";
import { CapabilityPicker } from "./CapabilityPicker";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const summary = (state: CapabilitySummaryDto["state"], compatibility: CapabilitySummaryDto["compatibility"] = { codex: "supported", opencode: "supported" }): CapabilitySummaryDto => ({ id: `cap-${state}`, name: `Web Search ${state}`, version: "0.1.0", description: "Search", category: "web-browser", compatibility, state, secretConfigured: false });
const detail: CapabilityDetailDto = { ...summary("needs_setup"), sdkVersion: "^0.1.0", author: { name: "Agentic Worktrees" }, license: "MIT", permissions: { network: ["mcp.exa.ai"], secrets: [] }, settings: [], reviewStatus: "bundled-reviewed", providedTools: ["web_search"], permissionDigest: "digest" };

function renderPicker(capabilities: CapabilitySummaryDto[], onActivate = vi.fn().mockResolvedValue({}), onDeactivate = vi.fn().mockResolvedValue({})) {
  render(<MemoryRouter><CapabilityPicker runId="run-1" agentKind="codex" capabilities={capabilities} onActivate={onActivate} onDeactivate={onDeactivate} /></MemoryRouter>);
  return { onActivate, onDeactivate };
}

describe("CapabilityPicker", () => {
  it("groups capabilities and activates ready or failed entries", async () => {
    const incompatible = { ...summary("ready", { codex: "unsupported", opencode: "supported" }), id: "cap-incompatible" };
    const { onActivate } = renderPicker([summary("active"), summary("ready"), summary("needs_setup"), summary("activation_failed"), incompatible]);
    await userEvent.click(screen.getByRole("button", { name: "Capabilities" }));
    for (const group of ["Active", "Ready", "Needs setup", "Incompatible"]) expect(screen.getByText(group, { selector: "p" })).toBeTruthy();
    await userEvent.click(screen.getByRole("option", { name: /Web Search activation_failed.*Retry/i }));
    expect(onActivate).toHaveBeenCalledWith("cap-activation_failed");
  });

  it("configures keyless setup and then activates", async () => {
    const configure = vi.fn().mockResolvedValue(detail);
    Object.defineProperty(window, "api", { configurable: true, value: { capabilities: { get: vi.fn().mockResolvedValue(detail), configure } } });
    const { onActivate } = renderPicker([summary("needs_setup")]);
    await userEvent.click(screen.getByRole("button", { name: "Capabilities" }));
    await userEvent.click(screen.getByRole("option", { name: /Web Search needs_setup/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Accept and continue" }));
    expect(configure).toHaveBeenCalledWith(expect.objectContaining({ capabilityId: "cap-needs_setup" }));
    expect(onActivate).toHaveBeenCalledWith("cap-needs_setup");
  });

  it("confirms removal and prevents incompatible activation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const incompatible = summary("ready", { codex: "unsupported", opencode: "supported" });
    const { onActivate, onDeactivate } = renderPicker([summary("active"), incompatible]);
    await userEvent.click(screen.getByRole("button", { name: "Capabilities" }));
    expect((screen.getByRole("option", { name: /Web Search ready/i }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("option", { name: /Web Search active/i }));
    expect(onDeactivate).toHaveBeenCalledWith("cap-active");
    expect(onActivate).not.toHaveBeenCalled();
  });
});
