import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CodingAgentToolCallDto } from "../../../../shared/ipc/schemas";
import { ToolCallGroup } from "./ToolCallGroup";

const tool = (
  overrides: Partial<CodingAgentToolCallDto> & { id: string },
): CodingAgentToolCallDto => ({
  tool: "bash",
  status: "running",
  title: "npm test",
  detail: "",
  ...overrides,
});

describe("ToolCallGroup", () => {
  it("renders every tool call with its command title", () => {
    const markup = renderToStaticMarkup(
      <ToolCallGroup
        tools={[
          tool({ id: "t1", title: "npm run lint" }),
          tool({ id: "t2", tool: "edit", title: "src/index.css" }),
        ]}
      />,
    );

    expect(markup).toContain("bash");
    expect(markup).toContain("npm run lint");
    expect(markup).toContain("edit");
    expect(markup).toContain("src/index.css");
    expect(markup).toContain("aria-label=");
  });

  it("marks running calls as in progress and completed calls as done", () => {
    const markup = renderToStaticMarkup(
      <ToolCallGroup
        tools={[
          tool({ id: "t1", status: "running" }),
          tool({ id: "t2", status: "completed", detail: "all green" }),
        ]}
      />,
    );

    expect(markup).toContain('aria-label="Running"');
    expect(markup).toContain('aria-label="Completed"');
  });

  it("exposes output details through an expandable control", () => {
    const markup = renderToStaticMarkup(
      <ToolCallGroup
        tools={[tool({ id: "t1", status: "completed", detail: "3 files changed" })]}
      />,
    );

    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("3 files changed");
  });

  it("keeps rows without output non-expandable", () => {
    const markup = renderToStaticMarkup(
      <ToolCallGroup tools={[tool({ id: "t1", detail: "   " })]} />,
    );

    expect(markup).toContain("disabled");
  });
});
