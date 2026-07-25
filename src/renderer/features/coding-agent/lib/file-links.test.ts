import { describe, expect, it } from "vitest";
import { getLinkedDiffFile } from "./file-links";

const files = ["src/renderer/App.tsx", "README.md"];
const worktreePath = "/Users/aki/projects/agentic-worktrees";

describe("getLinkedDiffFile", () => {
  it.each([
    ["src/renderer/App.tsx", "src/renderer/App.tsx"],
    ["./src/renderer/App.tsx:24", "src/renderer/App.tsx"],
    ["/Users/aki/projects/agentic-worktrees/src/renderer/App.tsx:24", "src/renderer/App.tsx"],
    ["file:///Users/aki/projects/agentic-worktrees/src/renderer/App.tsx#L24", "src/renderer/App.tsx"],
  ])("resolves a changed file link %s", (href, expected) => {
    expect(getLinkedDiffFile(href, files, worktreePath)).toBe(expected);
  });

  it("does not treat external or unchanged-file links as diff navigation", () => {
    expect(getLinkedDiffFile("https://example.com/src/renderer/App.tsx", files, worktreePath)).toBeUndefined();
    expect(getLinkedDiffFile("src/renderer/Missing.tsx", files, worktreePath)).toBeUndefined();
  });

  it("resolves a link when the diff reports absolute file paths", () => {
    const absoluteFile = `${worktreePath}/profile_ui_changes.md`;
    expect(
      getLinkedDiffFile(absoluteFile, [absoluteFile], worktreePath),
    ).toBe(absoluteFile);
  });
});
