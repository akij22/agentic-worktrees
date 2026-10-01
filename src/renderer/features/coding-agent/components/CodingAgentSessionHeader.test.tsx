// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodingAgentSessionHeader } from "./CodingAgentSessionHeader";
import { CodingAgentLayoutControls } from "./CodingAgentLayoutControls";
import { DropdownMenu } from "../../../components/ui/dropdown-menu";

const context = {
  repository: { name: "sito_mattia", fullName: "TYPESCRIPT/sito_mattia (/Users/developer/Documents/TYPESCRIPT/sito_mattia)" },
  worktree: { name: "worktree-long-session-name", branchName: "new-branch-with-a-long-descriptive-name", path: "/Users/developer/Documents/TYPESCRIPT/sito_mattia/worktrees/long-session-name" },
};
const setup = (overrides: Partial<React.ComponentProps<typeof CodingAgentSessionHeader>> = {}) => {
  const onEditor = vi.fn();
  const onModeChange = vi.fn();
  const onWorkspaceOpenChange = vi.fn();
  const user = userEvent.setup();
  render(<CodingAgentSessionHeader
    context={context}
    title="Coding Agent"
    editorAction={<DropdownMenu label="Open in editor" items={[{ id: "vscode", label: "Visual Studio Code" }]} onSelect={onEditor} />}
    layoutActions={<CodingAgentLayoutControls mode="single" onModeChange={onModeChange} workspaceOpen onWorkspaceOpenChange={onWorkspaceOpenChange} />}
    {...overrides}
  />);
  return { user, onEditor, onModeChange, onWorkspaceOpenChange };
};
afterEach(cleanup);

describe("CodingAgentSessionHeader", () => {
  it("keeps only the short repository and worktree in the closed header", () => {
    setup();
    expect(screen.getByText(context.repository.name)).toBeTruthy();
    expect(screen.getByRole("heading", { name: context.worktree.name })).toBeTruthy();
    expect(screen.queryByText(context.repository.fullName)).toBeNull();
    expect(screen.queryByText(context.worktree.branchName)).toBeNull();
    expect(screen.queryByText(context.worktree.path)).toBeNull();
    expect(screen.queryByText("URL Fetch")).toBeNull();
    expect(screen.getByRole("button", { name: "Open in editor" })).toBeTruthy();
  });

  it("keeps workspace details out of the header so they can live on the chat row", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Session details" })).toBeNull();
    expect(screen.queryByText(context.repository.fullName)).toBeNull();
    expect(screen.queryByText(context.worktree.branchName)).toBeNull();
  });

  it("keeps editor selection and every layout action available", async () => {
    const { user, onEditor, onModeChange, onWorkspaceOpenChange } = setup();
    await user.click(screen.getByRole("button", { name: "Open in editor" }));
    await user.click(screen.getByRole("menuitem", { name: "Visual Studio Code" }));
    expect(onEditor).toHaveBeenCalledWith("vscode");
    await user.click(screen.getByRole("button", { name: "Dual chat view" }));
    expect(onModeChange).toHaveBeenCalledWith("dual");
    await user.click(screen.getByRole("button", { name: "Single chat view" }));
    expect(onModeChange).toHaveBeenCalledWith("single");
    await user.click(screen.getByRole("button", { name: "Hide workspace panel" }));
    expect(onWorkspaceOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows editor errors without requiring disclosure, including when no editors are installed", () => {
    setup({ editorAction: null, editorError: "Could not retrieve available editors. Please try again." });
    expect(screen.getByRole("alert").textContent).toContain("Could not retrieve available editors");
  });
});
