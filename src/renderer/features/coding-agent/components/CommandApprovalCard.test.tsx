import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CommandApprovalCard } from "./CommandApprovalCard";

describe("CommandApprovalCard", () => {
  it("shows the requested command and approval choices", () => {
    const markup = renderToStaticMarkup(
      <CommandApprovalCard
        agentName="Codex"
        permission={{
          id: "permission-1",
          title: "Codex wants to run a command",
          type: "command",
          metadata: {
            command: "npm run dev",
            cwd: "/workspace/project",
          },
        }}
        onRespond={() => undefined}
      />,
    );

    expect(markup).toContain("Command approval required");
    expect(markup).toContain("npm run dev");
    expect(markup).toContain("/workspace/project");
    expect(markup).toContain("Allow once");
    expect(markup).toContain("Always allow");
    expect(markup).toContain("Deny");
  });

  it("does not render an empty command field", () => {
    const markup = renderToStaticMarkup(
      <CommandApprovalCard
        agentName="OpenCode"
        permission={{
          id: "permission-2",
          title: "OpenCode requests permission",
          type: "bash",
          metadata: {},
        }}
        onRespond={() => undefined}
      />,
    );

    expect(markup).toContain("OpenCode requests permission");
    expect(markup).not.toContain("Command to run");
  });
});
