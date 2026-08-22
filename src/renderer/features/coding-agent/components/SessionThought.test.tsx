import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionThought } from "./SessionThought";

describe("SessionThought", () => {
  it("renders the thinking label without a collapsible disclosure", () => {
    const markup = renderToStaticMarkup(
      <SessionThought agentName="OpenCode" text="Inspecting the repository." />,
    );

    expect(markup).toContain("was thinking");
    expect(markup).toContain("Inspecting the repository.");
    expect(markup).not.toContain("aria-expanded");
    expect(markup).not.toContain("Expand thinking");
    expect(markup).not.toContain("<button");
  });

  it("marks a streaming thought with the shimmer treatment", () => {
    const markup = renderToStaticMarkup(
      <SessionThought
        agentName="OpenCode"
        text="Reading the failing test."
        streaming
      />,
    );

    expect(markup).toContain("thought-shimmer");
    expect(markup).toContain("Reading the failing test.");
  });

  it("labels completed thoughts with the agent name", () => {
    const markup = renderToStaticMarkup(
      <SessionThought agentName="Codex" text="Verifying the build." />,
    );

    expect(markup).toContain("Codex was thinking");
    expect(markup).not.toContain("thought-shimmer");
  });

  it("renders long thoughts fully instead of collapsing them", () => {
    const markup = renderToStaticMarkup(
      <SessionThought agentName="Codex" text={"x".repeat(600)} />,
    );

    expect(markup).toContain("x".repeat(600));
    expect(markup).not.toContain("aria-expanded");
  });

  it("renders thought formatting as Markdown", () => {
    const markup = renderToStaticMarkup(
      <SessionThought
        agentName="Codex"
        text="**Focusing on global font changes**"
      />,
    );

    expect(markup).toContain(
      '<strong class="font-semibold text-muted-foreground not-italic">Focusing on global font changes</strong>',
    );
    expect(markup).not.toContain("**Focusing on global font changes**");
  });
});
