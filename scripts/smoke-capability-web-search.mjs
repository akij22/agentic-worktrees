import { pathToFileURL } from "node:url";
import { createElectronCapabilitySmokeDriver } from "./lib/electron-capability-smoke-driver.mjs";

const minimums = { codex: "0.150.1", opencode: "1.18.23" };
function atLeast(actual, minimum) { const a=actual.split(/[.-]/).slice(0,3).map(Number); const b=minimum.split(".").map(Number); return b.every((part,index) => (a[index] ?? 0) === part) || ((a[0]??0)*1e6+(a[1]??0)*1e3+(a[2]??0) >= b[0]*1e6+b[1]*1e3+b[2]); }
function snapshotMessages(snapshot) { if (!snapshot || typeof snapshot !== "object" || !("messages" in snapshot) || !Array.isArray(snapshot.messages)) return []; return snapshot.messages; }
function messages(snapshot) { return snapshotMessages(snapshot).map((item) => item && typeof item === "object" && "content" in item ? String(item.content) : "").join("\n"); }
function webSearchToolCalls(snapshot) { return snapshotMessages(snapshot).reduce((count, message) => {
  if (!message || typeof message !== "object" || !("tools" in message) || !Array.isArray(message.tools)) return count;
  return count + message.tools.filter((tool) => tool && typeof tool === "object" && "tool" in tool && tool.tool === "web_search").length;
}, 0); }

/**
 * @param {import("./lib/electron-capability-smoke-driver.mjs").CapabilitySmokeDriver} driver
 * @param {{apiKey?: string, timeoutMs?: number}} [options]
 */
export async function runCapabilitySmoke(driver, { apiKey, timeoutMs = 120_000 } = {}) {
  const markers = [];
  await driver.launch();
  try {
    const agents = await driver.listConfiguredAgents();
    for (const kind of ["codex", "opencode"]) {
      const installed = agents.find((agent) => agent.kind === kind);
      if (!installed || !atLeast(installed.version, minimums[kind])) throw new Error(`${kind === "codex" ? "Codex CLI" : "OpenCode"} ${minimums[kind]} or newer is required.`);
    }
    const supportedAgents = agents.filter((item) => item.kind === "codex" || item.kind === "opencode");
    const worktreeId = await driver.getFirstWorktreeId();
    const snapshots = [];
    const runScenario = async (key, mode) => {
      await driver.configureKeylessWebSearch(key);
      for (const agent of supportedAgents) {
        const runId = await driver.createSession(agent.kind, worktreeId);
        const baselineMarker = `aw-smoke-baseline-${mode}-${agent.kind}-${Date.now()}`;
        const queryMarker = `aw-smoke-query-${mode}-${agent.kind}-${Date.now()}`;
        markers.push(baselineMarker, queryMarker);
        await driver.sendMessage(runId, `Reply with ready and preserve this marker: ${baselineMarker}`);
        await driver.waitForIdle(runId, timeoutMs);
        const baseline = await driver.getSnapshot(runId);
        if (!messages(baseline).includes(baselineMarker)) throw new Error(`${agent.kind} did not persist the baseline message.`);
        await driver.activateWebSearch(runId);
        await driver.sendMessage(runId, `Use web_search to find the official Electron website. Marker: ${queryMarker}`);
        await driver.waitForIdle(runId, timeoutMs);
        const activated = await driver.getSnapshot(runId);
        snapshots.push(activated);
        if (!messages(activated).includes(baselineMarker)) throw new Error(`${agent.kind} lost chat history during capability reload.`);
        if (!/https?:\/\/[^\s]*exa|https?:\/\/www\.electronjs\.org/i.test(messages(activated))) throw new Error(`${agent.kind} did not return an attributed web search URL.`);
        const priorToolCalls = webSearchToolCalls(activated);
        if (priorToolCalls < 1) throw new Error(`${agent.kind} returned search text without invoking web_search.`);
        await driver.deactivateWebSearch(runId);
        const deactivated = await driver.getSnapshot(runId);
        if (JSON.stringify(deactivated).includes('"state":"active"')) throw new Error(`${agent.kind} Web Search remained active after deactivation.`);
        await driver.sendMessage(runId, "Try to call web_search once. If it is unavailable, reply exactly: capability unavailable.");
        await driver.waitForIdle(runId, timeoutMs);
        const afterDeactivation = await driver.getSnapshot(runId);
        if (webSearchToolCalls(afterDeactivation) !== priorToolCalls) throw new Error(`${agent.kind} still exposed web_search after deactivation.`);
      }
    };
    await runScenario(undefined, "keyless");
    if (apiKey) await runScenario(apiKey, "keyed");
    const logs = driver.readProcessLogs();
    for (const sensitive of [...markers, "Authorization", "exaApiKey", apiKey].filter(Boolean)) if (logs.includes(sensitive)) throw new Error("Sensitive capability data was found in application logs.");
    return snapshots;
  } finally { await driver.close(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCapabilitySmoke(createElectronCapabilitySmokeDriver(), { apiKey: process.env.EXA_API_KEY || undefined }).then(() => console.info("Capability smoke completed."), (error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
