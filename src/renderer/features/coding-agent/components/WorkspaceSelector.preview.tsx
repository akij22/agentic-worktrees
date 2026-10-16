// Standalone visual check: open /workspace-selector.preview.html through Vite.
import { createRoot } from "react-dom/client";
import "../../../../index.css";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import { WorkspaceSelector } from "./WorkspaceSelector";
import { useState } from "react";
const context = {
  repository: {
    id: "repo-a",
    githubRepoId: 1,
    ownerLogin: "owner",
    name: "agentic-worktrees",
    fullName: "owner/agentic-worktrees",
    defaultBranch: "main",
    isPrivate: true,
    isArchived: false,
    cloneUrl: "https://example.com/repository.git",
    sshUrl: null,
    htmlUrl: "https://example.com/repository",
    localRootPath: "/Users/example/agentic-worktrees",
    localCloneStatus: "ready",
    lastLocalScanAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastSyncedAt: null,
  },
  worktree: {
    id: "wt-1",
    repositoryId: "repo-a",
    name: "codex-ui",
    path: "/Users/example/agentic-worktrees/.worktrees/codex-ui",
    branchName: "feat/codex-ui",
    kind: "linked" as const,
    baseBranchName: "main",
    headCommitSha: null,
    status: "ready" as const,
    activeRunId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastSyncedAt: null,
  },
};

const Preview = () => {
  const [value, setValue] = useState("wt-1");
  return (
    <main className="grid min-h-screen place-items-center bg-background text-foreground">
      <section className="w-full max-w-xl p-4">
        <h1 className="mb-8 text-xl">What should we build?</h1>
        <textarea
          aria-label="Preview chat composer"
          placeholder="Describe a change…"
          className="mb-4 w-full rounded-xl border border-border bg-card p-4"
        />
        <WorkspaceSelector
          contexts={[
            context,
            {
              ...context,
              worktree: {
                ...context.worktree,
                id: "wt-2",
                name: "Main checkout",
                branchName: "main",
                kind: "primary",
              },
            },
            {
              ...context,
              repository: {
                ...context.repository,
                id: "repo-b",
                name: "search-engine",
              },
              worktree: {
                ...context.worktree,
                id: "wt-3",
                name: "search",
                branchName: "feat/search",
              },
            },
          ]}
          value={value}
          onChange={setValue}
        />
      </section>
    </main>
  );
};
const root = document.getElementById("root");
if (root) createRoot(root).render(<Preview />);
