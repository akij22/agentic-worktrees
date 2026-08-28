import { pathToFileURL } from "node:url";
import { createElectronCapabilitySmokeDriver } from "./lib/electron-capability-smoke-driver.mjs";

const minimums = { codex: "0.150.1", opencode: "1.18.23" };
function atLeast(actual, minimum) { const a=actual.split(/[.-]/).slice(0,3).map(Number); const b=minimum.split(".").map(Number); return b.every((part,index) => (a[index] ?? 0) === part) || ((a[0]??0)*1e6+(a[1]??0)*1e3+(a[2]??0) >= b[0]*1e6+b[1]*1e3+b[2]); }
function messages(snapshot) { if (!snapshot || typeof snapshot !== "object" || !("messages" in snapshot) || !Array.isArray(snapshot.messages)) return ""; return snapshot.messages.map((item) => item && typeof item === "object" && "content" in item ? String(item.content) : "").join("\n"); }

export async function runCapabilitySmoke(driver, { apiKey, timeoutMs = 120_000 } = {}) {
  const queryMarker = `agentic-worktrees-smoke-${Date.now()}`;
  await driver.launch();
  try {
    const agents = await driver.listConfiguredAgents();
    for (const kind of ["codex", "opencode"]) {
      const installed = agents.find((agent) => agent.kind === kind);
      if (!installed || !atLeast(installed.version, minimums[kind])) throw new Error(`${kind === "codex" ? "Codex CLI" : "OpenCode"} ${minimums[kind]} or newer is required.`);
    }
    const worktreeId = await driver.getFirstWorktreeId();
    await driver.configureKeylessWebSearch(apiKey);
    const snapshots = [];
    for (const agent of agents.filter((item) => item.kind === "codex" || item.kind === "opencode")) {
      const runId = await driver.createSession(agent.kind, worktreeId);
      await driver.sendMessage(runId, "Reply with the word ready."); await driver.waitForIdle(runId, timeoutMs);
      await driver.activateWebSearch(runId);
      await driver.sendMessage(runId, `Use web_search to find the official Electron website. Marker: ${queryMarker}`); await driver.waitForIdle(runId, timeoutMs);
      const snapshot = await driver.getSnapshot(runId); snapshots.push(snapshot);
      if (!/https?:\/\/[^\s]*exa|https?:\/\/www\.electronjs\.org/i.test(messages(snapshot))) throw new Error(`${agent.kind} did not return an attributed web search URL.`);
      await driver.deactivateWebSearch(runId);
      const deactivated = await driver.getSnapshot(runId);
      if (JSON.stringify(deactivated).includes('"state":"active"')) throw new Error(`${agent.kind} Web Search remained active after deactivation.`);
    }
    const logs = driver.readProcessLogs();
    for (const sensitive of [queryMarker, "Authorization", "exaApiKey", apiKey].filter(Boolean)) if (logs.includes(sensitive)) throw new Error("Sensitive capability data was found in application logs.");
    return snapshots;
  } finally { await driver.close(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCapabilitySmoke(createElectronCapabilitySmokeDriver(), { apiKey: process.env.EXA_API_KEY || undefined }).then(() => console.info("Capability smoke completed."), (error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
