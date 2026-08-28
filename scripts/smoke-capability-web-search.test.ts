import { describe, expect, it, vi } from "vitest";
import { runCapabilitySmoke } from "./smoke-capability-web-search.mjs";

const driver = (agents: Array<{kind:"codex"|"opencode";version:string}>) => ({ launch:vi.fn(), listConfiguredAgents:vi.fn().mockResolvedValue(agents), getFirstWorktreeId:vi.fn(), createSession:vi.fn(), sendMessage:vi.fn(), waitForIdle:vi.fn(), configureKeylessWebSearch:vi.fn(), activateWebSearch:vi.fn(), deactivateWebSearch:vi.fn(), getSnapshot:vi.fn(), readProcessLogs:vi.fn(() => ""), close:vi.fn() });
describe("capability smoke seam",()=>{it("reports exact missing CLI floors",async()=>{await expect(runCapabilitySmoke(driver([{kind:"opencode",version:"1.18.23"}]) as never)).rejects.toThrow("Codex CLI 0.150.1 or newer is required."); await expect(runCapabilitySmoke(driver([{kind:"codex",version:"0.150.1"}]) as never)).rejects.toThrow("OpenCode 1.18.23 or newer is required.");});});
