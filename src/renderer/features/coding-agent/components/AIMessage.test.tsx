import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AIMessage } from "./AIMessage";

describe("AIMessage", () => {
  it("does not render a visual cursor while content is streaming", () => {
    const markup = renderToStaticMarkup(
      <AIMessage agentName="Codex" content="Working on it." isStreaming />,
    );

    expect(markup).not.toContain('aria-label="Streaming content"');
  });
});
