// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodingAgentSessionHeader } from "./CodingAgentSessionHeader";
import { CodingAgentLayoutControls } from "./CodingAgentLayoutControls";
import { DropdownMenu } from "../../../components/ui/dropdown-menu";

const context = {
  repository: { name: "sito_mattia", fullName: "TYPESCRIPT/sito_mattia (/Users/developer/Documents/TYPESCRIPT/sito_mattia)" },
  worktree: { name: "worktree-long-session-name", branchName: "new-branch-with-a-long-descriptive-name", path: "/Users/developer/Documents/TYPESCRIPT/sito_mattia/worktrees/long-session-name" },
};
const capabilities = [
  { id: "fetch", name: "URL Fetch", state: "active" },
  { id: "search", name: "Web Search", state: "active" },
  { id: "disabled", name: "Inactive tool", state: "inactive" },
];
const setup = (overrides: Partial<React.ComponentProps<typeof CodingAgentSessionHeader>> = {}) => {
  const onRemoveCapability = vi.fn();
  const onEditor = vi.fn();
  const onModeChange = vi.fn();
  const onWorkspaceOpenChange = vi.fn();
  const user = userEvent.setup();
  render(<CodingAgentSessionHeader
    context={context}
    title="Coding Agent"
    capabilities={capabilities}
    onRemoveCapability={onRemoveCapability}
    editorAction={<DropdownMenu label="Open in editor" items={[{ id: "vscode", label: "Visual Studio Code" }]} onSelect={onEditor} />}
    layoutActions={<CodingAgentLayoutControls mode="single" onModeChange={onModeChange} workspaceOpen onWorkspaceOpenChange={onWorkspaceOpenChange} />}
    {...overrides}
  />);
  return { user, onRemoveCapability, onEditor, onModeChange, onWorkspaceOpenChange };
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

  it("reveals complete context and capability removal by keyboard, and restores focus on Escape", async () => {
    const { user, onRemoveCapability } = setup();
    const trigger = screen.getByRole("button", { name: "Session details" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const popup = await screen.findByRole("dialog", { name: "Session details" });
    for (const value of [context.repository.fullName, context.worktree.name, context.worktree.branchName, context.worktree.path]) {
      expect(within(popup).getByText(value)).toBeTruthy();
    }
    expect(within(popup).queryByText("Inactive tool")).toBeNull();
    await user.click(within(popup).getByRole("button", { name: "Remove URL Fetch" }));
    expect(onRemoveCapability).toHaveBeenCalledWith("fetch");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
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

  it("shows editor errors without requiring disclosure, including when no editors are installed", async () => {
    const { user } = setup({ editorAction: null, editorError: "Could not retrieve available editors. Please try again.", capabilities: [] });
    expect(screen.getByRole("alert").textContent).toContain("Could not retrieve available editors");
    await user.click(screen.getByRole("button", { name: "Session details" }));
    expect(await screen.findByText("No active capabilities.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close session details" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("does not offer removal for capabilities that are reloading", async () => {
    const { user } = setup({ capabilities: [{ ...capabilities[0], state: "reloading" }] });
    await user.click(screen.getByRole("button", { name: "Session details" }));
    expect(await screen.findByText("No active capabilities.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove URL Fetch" })).toBeNull();
  });

  it("prevents duplicate removal while pending and offers retry after failure", async () => {
    let rejectRemoval: (error: Error) => void = () => undefined;
    const pending = new Promise<void>((_resolve, reject) => { rejectRemoval = reject; });
    const remove = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(undefined);
    const { user } = setup({ onRemoveCapability: remove });
    await user.click(screen.getByRole("button", { name: "Session details" }));
    const button = await screen.findByRole("button", { name: "Remove URL Fetch" });
    await user.dblClick(button);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Removing capability…");
    rejectRemoval(new Error("internal failure that must not appear"));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not remove capability. Please try again.");
    expect(button.hasAttribute("disabled")).toBe(false);
    await user.click(button);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
