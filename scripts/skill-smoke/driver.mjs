import { _electron as electron } from "playwright";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/deterministic-review");
const minimumVersions = { codex: "0.144.0", opencode: "1.0.0" };
const versionParts = (value) => value.split(/[.-]/).slice(0, 3).map((part) => Number(part));
export function versionAtLeast(actual, minimum) {
  const left = versionParts(actual), right = versionParts(minimum);
  for (const index of [0, 1, 2]) {
    if ((left[index] ?? 0) > (right[index] ?? 0)) return true;
    if ((left[index] ?? 0) < (right[index] ?? 0)) return false;
  }
  return true;
}
export async function runPackagedSkillScenarios({ executable, provider }) {
  const application = await electron.launch({ executablePath: executable, args: [] });
  try {
    const detail = await application.evaluate(async ({ dialog, BrowserWindow }, input) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input.fixture], bookmarks: [] });
      try {
        const ownedWindow = BrowserWindow.getAllWindows()[0];
        if (!ownedWindow) throw new Error("Smoke window unavailable.");
        return await ownedWindow.webContents.executeJavaScript("window.api.skills.install()");
      } finally { dialog.showOpenDialog = original; }
    }, { fixture });
    if (!detail) throw new Error("Skill installation was canceled.");

    const page = await application.firstWindow();
    const statuses = await page.evaluate(async () => window.api.codingAgent.getStatus());
    const selected = statuses.installations.filter((item) => item.configured && (!provider || item.kind === provider));
    if (!selected.length) throw new Error("Requested smoke provider is not configured; no login was attempted.");
    for (const installation of selected) {
      const minimum = minimumVersions[installation.kind];
      if (!versionAtLeast(installation.version, minimum)) throw new Error(`${installation.kind} ${installation.version} is below ${minimum}.`);
    }
    const skills = await page.evaluate(async () => window.api.skills.list());
    if (!skills.some((skill) => skill.id === detail.id)) throw new Error("Installed skill was not discoverable after refresh.");

    const worktrees = await page.evaluate(async () => window.api.codingAgent.listWorktrees());
    if (!worktrees[0]) throw new Error("No worktree is available for skill smoke verification.");
    for (const installation of selected) {
      const session = await page.evaluate(async (input) => window.api.codingAgent.createSession(input), { agentKind: installation.kind, worktreeId: worktrees[0].worktree.id, title: "Skill smoke" });
      const capabilities = await page.evaluate(async (runId) => window.api.capabilities.list({ runId }), session.id);
      const coexistence = capabilities.find((item) => item.id === "web-search" && ["ready", "active"].includes(item.state));
      if (coexistence) await page.evaluate(async (input) => window.api.capabilities.activate(input), { runId: session.id, capabilityId: coexistence.id });
      await page.evaluate(async (input) => window.api.codingAgent.sendMessage(input), { runId: session.id, skillInvocation: { skillId: detail.id, version: detail.version, arguments: "Review authentication" } });
      await page.evaluate(async (input) => window.api.codingAgent.sendMessage(input), { runId: session.id, content: "Use the deterministic review skill for this verification." });
      const deadline = Date.now() + 30_000;
      let snapshot;
      do {
        snapshot = await page.evaluate(async (runId) => window.api.codingAgent.getSession({ runId }), session.id);
        if (snapshot.session.status === "idle" || snapshot.session.status === "error") break;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
      } while (Date.now() < deadline);
      if (snapshot?.session.status !== "idle") throw new Error("Skill smoke session did not become idle.");
      if (!snapshot.skillInvocations?.some((item) => item.skillId === detail.id && item.status === "loaded")) throw new Error("Explicit native skill invocation was not confirmed.");
      if (!snapshot.messages.some((message) => message.role === "assistant" && message.content.includes("AW_SKILL_DETERMINISTIC_REVIEW"))) throw new Error("Automatic skill scenario marker was not observed.");
    }
    await page.evaluate(async (id) => window.api.skills.remove({ skillId: id }), detail.id);
    const afterRemoval = await page.evaluate(async () => window.api.skills.list());
    if (afterRemoval.some((skill) => skill.id === detail.id)) throw new Error("Skill removal did not refresh discovery.");
    return { provider: provider ?? "all", installed: true, explicit: true, automatic: true, coexistence: true, removed: true };
  } finally { await application.close(); }
}
