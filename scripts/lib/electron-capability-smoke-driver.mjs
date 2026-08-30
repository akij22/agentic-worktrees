import { _electron as electron } from "@playwright/test";

/** @typedef {"codex" | "opencode"} AgentKind */
/**
 * @typedef {Object} CapabilitySmokeDriver
 * @property {() => Promise<void>} launch
 * @property {() => Promise<Array<{kind: AgentKind, version: string}>>} listConfiguredAgents
 * @property {() => Promise<string>} getFirstWorktreeId
 * @property {(agentKind: AgentKind, worktreeId: string) => Promise<string>} createSession
 * @property {(runId: string, content: string) => Promise<void>} sendMessage
 * @property {(runId: string, timeoutMs: number) => Promise<void>} waitForIdle
 * @property {(apiKey?: string) => Promise<void>} configureKeylessWebSearch
 * @property {(runId: string) => Promise<void>} activateWebSearch
 * @property {(runId: string) => Promise<void>} deactivateWebSearch
 * @property {(runId: string) => Promise<unknown>} getSnapshot
 * @property {() => string} readProcessLogs
 * @property {() => Promise<void>} close
 */

/** @param {string} status */
export function smokeSessionIsIdle(status) {
  if (status === "error") throw new Error("Coding-agent smoke session entered error state.");
  if (status === "unavailable") throw new Error("Coding-agent smoke session became unavailable.");
  return status === "idle";
}

/** @returns {CapabilitySmokeDriver} */
export function createElectronCapabilitySmokeDriver(executablePath = process.env.AW_SMOKE_EXECUTABLE) {
  let application; let page; const logs = [];
  const evaluate = async (callback, argument) => { if (!page) throw new Error("Smoke driver is not launched."); return page.evaluate(callback, argument); };
  return {
    async launch() {
      if (!executablePath) throw new Error("AW_SMOKE_EXECUTABLE is required.");
      application = await electron.launch({ executablePath });
      page = await application.firstWindow();
      const child = application.process();
      child?.stdout?.on("data", (chunk) => logs.push(chunk.toString("utf8")));
      child?.stderr?.on("data", (chunk) => logs.push(chunk.toString("utf8")));
    },
    listConfiguredAgents: () => evaluate(async () => { const status = await window.api.codingAgent.getStatus(); return status.installations.filter((item) => item.configured && item.version).map((item) => ({ kind: item.kind, version: item.version })); }),
    getFirstWorktreeId: async () => { const id = await evaluate(async () => (await window.api.worktrees.listAll())[0]?.id); if (!id) throw new Error("At least one worktree is required."); return id; },
    createSession: (agentKind, worktreeId) => evaluate(async ({ agentKind: kind, worktreeId: id }) => (await window.api.codingAgent.createSession({ agentKind: kind, worktreeId: id, title: `Capability smoke: ${kind}` })).id, { agentKind, worktreeId }),
    sendMessage: (runId, content) => evaluate(({ runId: id, content: text }) => window.api.codingAgent.sendMessage({ runId: id, content: text }), { runId, content }),
    async waitForIdle(runId, timeoutMs) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { const status = await evaluate(async (id) => (await window.api.codingAgent.getSession({ runId: id })).session.status, runId); if (smokeSessionIsIdle(status)) return; await new Promise((resolve) => setTimeout(resolve, 250)); } throw new Error("Coding-agent smoke session timed out."); },
    configureKeylessWebSearch: (apiKey) => evaluate(async (key) => { const detail = await window.api.capabilities.get({ capabilityId: "agentic-worktrees.web-search" }); await window.api.capabilities.configure({ capabilityId: detail.id, acceptedPermissionDigest: detail.permissionDigest, settings: { providerMode: "auto", resultLimit: 5 }, exaApiKey: key ?? "" }); }, apiKey),
    activateWebSearch: (runId) => evaluate((id) => window.api.capabilities.activate({ runId: id, capabilityId: "agentic-worktrees.web-search" }), runId),
    deactivateWebSearch: (runId) => evaluate((id) => window.api.capabilities.deactivate({ runId: id, capabilityId: "agentic-worktrees.web-search" }), runId),
    getSnapshot: (runId) => evaluate((id) => window.api.codingAgent.getSession({ runId: id }), runId),
    readProcessLogs: () => logs.join(""),
    async close() { await application?.close(); application = undefined; page = undefined; },
  };
}
