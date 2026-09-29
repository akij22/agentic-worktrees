// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodingAgentInstallationStatusDto } from "../../../../shared/ipc/schemas";
import { HarnessModelPicker } from "./HarnessModelPicker";

const installation = (
  overrides: Partial<CodingAgentInstallationStatusDto> &
    Pick<CodingAgentInstallationStatusDto, "kind" | "name" | "configured">,
): CodingAgentInstallationStatusDto => ({
  version: "1.0.0",
  executablePath: `/usr/local/bin/${overrides.kind}`,
  running: true,
  error: null,
  ...overrides,
});

afterEach(cleanup);

describe("HarnessModelPicker", () => {
  it("lists every harness as a single choice rather than separate fields", () => {
    render(
      <HarnessModelPicker
        installations={[
          installation({ kind: "codex", name: "Codex", configured: true }),
          installation({
            kind: "opencode",
            name: "OpenCode",
            configured: true,
          }),
        ]}
        selectedKind="opencode"
        onSelect={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Coding agent" });
    expect(trigger.textContent).toContain("OpenCode");

    fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: /Codex/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /OpenCode/ })).toBeTruthy();
  });

  it("reports the picked harness", () => {
    const onSelect = vi.fn();
    render(
      <HarnessModelPicker
        installations={[
          installation({ kind: "codex", name: "Codex", configured: true }),
          installation({
            kind: "opencode",
            name: "OpenCode",
            configured: true,
          }),
        ]}
        selectedKind="opencode"
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Coding agent" }));
    fireEvent.click(screen.getByRole("option", { name: /Codex/ }));
    expect(onSelect).toHaveBeenCalledWith("codex");
  });

  it("marks an unconfigured harness as unavailable and refuses to pick it", () => {
    const onSelect = vi.fn();
    render(
      <HarnessModelPicker
        installations={[
          installation({ kind: "codex", name: "Codex", configured: true }),
          installation({
            kind: "opencode",
            name: "OpenCode",
            configured: false,
          }),
        ]}
        selectedKind="codex"
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Coding agent" }));
    const unconfigured = screen.getByRole("option", { name: /OpenCode/ });
    expect(unconfigured.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(unconfigured);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("disables itself when nothing is configured", () => {
    render(
      <HarnessModelPicker
        installations={[
          installation({ kind: "codex", name: "Codex", configured: false }),
        ]}
        onSelect={vi.fn()}
      />,
    );

    expect(
      (
        screen.getByRole("button", {
          name: "Coding agent",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("prompts for a choice when nothing is selected yet", () => {
    render(
      <HarnessModelPicker
        installations={[
          installation({
            kind: "opencode",
            name: "OpenCode",
            configured: true,
          }),
        ]}
        onSelect={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Coding agent" }).textContent,
    ).toContain("Select a coding agent");
  });
});
