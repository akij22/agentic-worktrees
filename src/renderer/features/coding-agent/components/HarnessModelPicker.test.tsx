// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CodingAgentInstallationStatusDto,
  CodingAgentModelDto,
} from "../../../../shared/ipc/schemas";
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

const model = (modelId: string, providerName: string): CodingAgentModelDto => ({
  providerId: providerName.toLowerCase(),
  providerName,
  modelId,
  modelName: modelId,
  reasoningVariants: [],
  isDefault: modelId === "gpt-5.4",
});

afterEach(cleanup);

describe("HarnessModelPicker", () => {
  it("groups each harness with its available models in one picker", () => {
    const codexModel = model("gpt-5.4", "OpenAI");
    const openCodeModel = model("claude-sonnet", "Anthropic");
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
        modelsByKind={{ codex: [codexModel], opencode: [openCodeModel] }}
        selectedKind="opencode"
        selectedModel={openCodeModel}
        onSelect={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Provider and model" });
    expect(trigger.textContent).toContain("OpenCode · claude-sonnet");

    fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: /Codex/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /OpenCode/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /OpenCode/ }));
    expect(screen.getByRole("option", { name: /claude-sonnet/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /gpt-5.4/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to provider selection" }));
    expect(screen.getByRole("option", { name: /Codex/ })).toBeTruthy();
  });

  it("reports the picked harness and model together", () => {
    const onSelect = vi.fn();
    const codexModel = model("gpt-5.4", "OpenAI");
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
        modelsByKind={{ codex: [codexModel] }}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Provider and model" }));
    fireEvent.click(screen.getByRole("option", { name: /Codex/ }));
    fireEvent.click(screen.getByRole("option", { name: /gpt-5.4/ }));
    expect(onSelect).toHaveBeenCalledWith("codex", codexModel);
  });

  it("does not offer an unconfigured harness", () => {
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
        modelsByKind={{ codex: [model("gpt-5.4", "OpenAI")] }}
        selectedKind="codex"
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Provider and model" }));
    expect(screen.getByRole("option", { name: /gpt-5.4/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /OpenCode/ })).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("disables itself when nothing is configured", () => {
    render(
      <HarnessModelPicker
        installations={[
          installation({ kind: "codex", name: "Codex", configured: false }),
        ]}
        modelsByKind={{}}
        onSelect={vi.fn()}
      />,
    );

    expect(
      (
        screen.getByRole("button", {
          name: "Provider and model",
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
        modelsByKind={{}}
        onSelect={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Provider and model" }).textContent,
    ).toContain("Choose provider and model");
  });
});
