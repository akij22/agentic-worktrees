import { describe, expect, it, vi } from "vitest";
import { runCapabilitySmoke } from "./smoke-capability-web-search.mjs";

const versionDriver = (agents: Array<{kind:"codex"|"opencode";version:string}>) => ({ launch:vi.fn(), listConfiguredAgents:vi.fn().mockResolvedValue(agents), getFirstWorktreeId:vi.fn(), createSession:vi.fn(), sendMessage:vi.fn(), waitForIdle:vi.fn(), configureKeylessWebSearch:vi.fn(), activateWebSearch:vi.fn(), deactivateWebSearch:vi.fn(), getSnapshot:vi.fn(), readProcessLogs:vi.fn(() => ""), close:vi.fn() });

function successfulDriver() {
  const sent = new Map<string, string[]>();
  const deactivated = new Set<string>();
  let sequence = 0;
  return {
    launch: vi.fn(),
    listConfiguredAgents: vi.fn().mockResolvedValue([{ kind: "codex", version: "0.150.1" }, { kind: "opencode", version: "1.18.23" }]),
    getFirstWorktreeId: vi.fn().mockResolvedValue("worktree-1"),
    configureKeylessWebSearch: vi.fn(),
    createSession: vi.fn(async (kind: string) => { const id = `${kind}-${sequence++}`; sent.set(id, []); return id; }),
    sendMessage: vi.fn(async (runId: string, content: string) => { sent.get(runId)?.push(content); }),
    waitForIdle: vi.fn(),
    activateWebSearch: vi.fn(),
    deactivateWebSearch: vi.fn(async (runId: string) => { deactivated.add(runId); }),
    getSnapshot: vi.fn(async (runId: string) => {
      const prompts = sent.get(runId) ?? [];
      const searched = prompts.some((prompt) => prompt.includes("official Electron website"));
      return {
        messages: [
          ...prompts.map((content, index) => ({ id: String(index), content, tools: [] })),
          ...(searched ? [{ id: "search-result", content: "Result: https://www.electronjs.org", tools: [{ tool: "web_search" }] }] : []),
        ],
        capabilities: [{ id: "agentic-worktrees.web-search", state: deactivated.has(runId) ? "inactive" : "active" }],
      };
    }),
    readProcessLogs: vi.fn(() => ""),
    close: vi.fn(),
  };
}

describe("capability smoke seam", () => {
  it("reports exact missing CLI floors", async () => {
    await expect(runCapabilitySmoke(versionDriver([{kind:"opencode",version:"1.18.23"}]) as never)).rejects.toThrow("Codex CLI 0.150.1 or newer is required.");
    await expect(runCapabilitySmoke(versionDriver([{kind:"codex",version:"0.150.1"}]) as never)).rejects.toThrow("OpenCode 1.18.23 or newer is required.");
  });

  it("runs keyless first, then a complete optional keyed scenario", async () => {
    const driver = successfulDriver();
    await expect(runCapabilitySmoke(driver as never, { apiKey: "optional-key", timeoutMs: 10 })).resolves.toHaveLength(4);
    expect(driver.configureKeylessWebSearch.mock.calls).toEqual([[undefined], ["optional-key"]]);
    expect(driver.createSession).toHaveBeenCalledTimes(4);
    expect(driver.deactivateWebSearch).toHaveBeenCalledTimes(4);
    expect(driver.sendMessage.mock.calls.filter(([, content]) => content.includes("capability unavailable"))).toHaveLength(4);
    expect(driver.close).toHaveBeenCalledOnce();
  });
});
