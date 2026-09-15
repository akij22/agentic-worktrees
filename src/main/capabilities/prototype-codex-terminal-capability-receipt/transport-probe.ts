import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createStatefulReceiptHost, type TerminalProbeEvidence } from "./stateful-host";

type Rpc = { id?: number | string; method?: string; result?: unknown; error?: unknown; params?: Record<string, unknown> };
type CodexThread = { thread: { id: string } };
type CodexTurn = { turn?: { id?: string } };

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const receiptPattern = /AW_RECEIPT:[0-9a-f-]+:(?:success|reported_error|thrown|timeout|cancelled)/i;

function hasReceipt(value: unknown) { return receiptPattern.test(JSON.stringify(value)); }
function classifyError(value: unknown) {
  const text = (JSON.stringify(value) ?? "").toLowerCase();
  if (text.includes("not found") || text.includes("unknown tool")) return "not_found";
  if (text.includes("timed out") || text.includes("timeout")) return "timeout";
  if (text.includes("approval") || text.includes("permission")) return "approval";
  if (text.includes("connection") || text.includes("transport")) return "transport";
  return value === undefined || value === null ? "none" : "other_redacted";
}
function methodOf(event: TerminalProbeEvidence) { return event.type === "request" ? event.method : undefined; }

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  await Promise.race([exited, pause(1500)]);
  if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "aw-codex-terminal-receipt-"));
  const children = new Set<ChildProcess>();
  const variants: Array<{ name: string; stateful: boolean; jsonResponse: boolean }> = [
    { name: "stateless_sse", stateful: false, jsonResponse: false },
    { name: "stateless_json", stateful: false, jsonResponse: true },
    { name: "stateful_sse", stateful: true, jsonResponse: false },
    { name: "stateful_json", stateful: true, jsonResponse: true },
  ];

  const namespace = async (name: string) => {
    const base = join(root, name);
    const codexHome = join(base, "codex");
    const cwd = join(base, "work");
    await mkdir(codexHome, { recursive: true, mode: 0o700 });
    await mkdir(cwd, { recursive: true, mode: 0o700 });
    if (process.argv.includes("--existing-auth")) {
      const source = join(homedir(), ".codex", "auth.json");
      await access(source);
      await symlink(source, join(codexHome, "auth.json"));
    }
    return { cwd, env: { PATH: process.env.PATH, HOME: join(base, "home"), CODEX_HOME: codexHome, TMPDIR: root } as NodeJS.ProcessEnv };
  };

  const launch = (cwd: string, env: NodeJS.ProcessEnv) => {
    const child = spawn("codex", ["app-server"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    children.add(child);
    child.stderr?.resume();
    child.once("exit", () => children.delete(child));
    if (!child.stdin || !child.stdout) throw new Error("codex_pipes_unavailable");
    let id = 0;
    const pending = new Map<number, (message: Rpc) => void>();
    const events: Rpc[] = [];
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const message = JSON.parse(line) as Rpc;
        if (typeof message.id === "number" && !message.method && pending.has(message.id)) { pending.get(message.id)?.(message); pending.delete(message.id); }
        else if (message.method) {
          events.push(message);
          if (message.id !== undefined && message.method.endsWith("/requestApproval")) child.stdin?.write(`${JSON.stringify({ id: message.id, result: { decision: "accept" } })}\n`);
        }
      } catch { /* Ignore non-protocol output. */ }
    });
    const call = async <T>(method: string, params: unknown, timeoutMs = 30_000): Promise<T> => {
      const requestId = ++id;
      const response = new Promise<Rpc>((resolve) => pending.set(requestId, resolve));
      child.stdin?.write(`${JSON.stringify({ id: requestId, method, params })}\n`);
      const settled = await Promise.race([response, pause(timeoutMs).then(() => ({ error: "timeout" } as Rpc))]);
      if (settled.error) throw new Error("codex_rpc_failed");
      return settled.result as T;
    };
    return { child, events, call };
  };

  const initialize = (client: ReturnType<typeof launch>) => client.call("initialize", { clientInfo: { name: "codex_terminal_receipt_probe", version: "1" }, capabilities: { experimentalApi: true } });

  const results = [];
  try {
    for (const variant of variants) {
      const token = randomBytes(32).toString("hex");
      const host = createStatefulReceiptHost({ token, stateful: variant.stateful, jsonResponse: variant.jsonResponse, timeoutMs: 500 });
      const port = await host.start();
      const ns = await namespace(variant.name);
      let client = launch(ns.cwd, ns.env);
      let liveRead: unknown;
      let replayRead: unknown;
      let providerTerminal = false;
      let providerReceipt = false;
      let turnTerminal = false;
      let terminalItem: Record<string, unknown> | undefined;
      try {
        await initialize(client);
        const thread = await client.call<CodexThread>("thread/start", {
          cwd: ns.cwd,
          approvalPolicy: "never",
          sandbox: "read-only",
          config: { mcp_servers: { receipt_probe: { url: `http://127.0.0.1:${port}/mcp`, http_headers: { Authorization: `Bearer ${token}` }, default_tools_approval_mode: "approve" } } },
        });
        const eventStart = client.events.length;
        const turn = await client.call<CodexTurn>("turn/start", {
          threadId: thread.thread.id,
          input: [{ type: "text", text: "Call mcp__receipt_probe__receipt_success exactly once and then stop. Do not call any other tool.", text_elements: [] }],
        });
        const deadline = Date.now() + 45_000;
        while (Date.now() < deadline) {
          const recent = client.events.slice(eventStart);
          const completedItems = recent.filter((event) => event.method === "item/completed").map((event) => event.params?.item).filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && (item as Record<string, unknown>).type === "mcpToolCall");
          terminalItem = completedItems.find((item) => item.server === "receipt_probe" && item.tool === "receipt_success");
          providerTerminal = Boolean(terminalItem);
          providerReceipt = Boolean(terminalItem && hasReceipt(terminalItem));
          turnTerminal = recent.some((event) => event.method === "turn/completed");
          if (providerTerminal || turnTerminal) break;
          await pause(50);
        }
        liveRead = await client.call("thread/read", { threadId: thread.thread.id, includeTurns: true }).catch(() => undefined);
        if (!providerTerminal && turn.turn?.id) await client.call("turn/interrupt", { threadId: thread.thread.id, turnId: turn.turn.id }).catch(() => undefined);
        await stop(client.child);
        client = launch(ns.cwd, ns.env);
        await initialize(client);
        replayRead = await client.call("thread/read", { threadId: thread.thread.id, includeTurns: true }).catch(() => undefined);
      } finally {
        await stop(client.child);
        await host.close();
      }
      const entered = host.evidence.filter((event) => event.type === "entered").length;
      const outcomes = host.evidence.filter((event) => event.type === "outcome").length;
      results.push({
        variant: variant.name,
        statefulSessionEstablished: host.evidence.some((event) => event.type === "request" && event.hadSession),
        methods: [...new Set(host.evidence.map(methodOf).filter((method): method is string => Boolean(method)))],
        hostEntered: entered > 0,
        hostOutcome: outcomes > 0,
        providerItemTerminal: providerTerminal,
        providerItemStatus: typeof terminalItem?.status === "string" ? terminalItem.status : "none",
        providerResultPresent: terminalItem?.result !== undefined,
        providerErrorClass: classifyError(terminalItem?.error),
        providerReceiptLive: providerReceipt || hasReceipt(liveRead),
        providerReceiptAfterRestart: hasReceipt(replayRead),
        turnTerminal,
      });
    }
    console.log(JSON.stringify({
      kind: "codex-terminal-capability-receipt-probe",
      version: execFileSync("codex", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),
      results,
      privacy: { prompts: false, outputs: false, credentials: false, paths: false, sessionIds: false, receipts: false },
    }, null, 2));
  } finally {
    for (const child of children) await stop(child);
    await rm(root, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({ kind: "codex-terminal-capability-receipt-probe", status: error instanceof Error ? error.message : "failed" }));
  process.exitCode = 1;
});
