import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionMessages } from "./SessionMessages";

describe("SessionMessages", () => {
  it("renders a transient context-compaction thought", () => {
    const markup = renderToStaticMarkup(
      <SessionMessages
        agentName="Codex"
        messages={[]}
        busy
        activity={undefined}
        transientThought="Compacting context..."
        permission={undefined}
        error={undefined}
        onRespondPermission={() => undefined}
      />,
    );

    expect(markup).toContain("Compacting context...");
  });
});
