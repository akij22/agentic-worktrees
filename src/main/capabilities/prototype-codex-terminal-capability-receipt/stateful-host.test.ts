import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createStatefulReceiptHost } from "./stateful-host";

const active: Array<ReturnType<typeof createStatefulReceiptHost>> = [];
afterEach(async () => { await Promise.all(active.splice(0).map((host) => host.close())); });

async function connect(input: { stateful: boolean; jsonResponse: boolean }) {
  const token = randomBytes(32).toString("hex");
  const host = createStatefulReceiptHost({ token, ...input, timeoutMs: 50 });
  active.push(host);
  const port = await host.start();
  const baseHeaders = { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream", "Content-Type": "application/json" };
  const post = (body: unknown, sessionId?: string) => fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { ...baseHeaders, ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}) }, body: JSON.stringify(body) });
  const initialized = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
  const sessionId = initialized.headers.get("mcp-session-id") ?? undefined;
  await initialized.text();
  if (input.stateful) {
    expect(sessionId).toBeTruthy();
    await (await post({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionId)).text();
  }
  return { host, post, sessionId };
}

describe("terminal receipt diagnostic host", () => {
  it("returns a receipt from a stateful success call", async () => {
    const { post, sessionId } = await connect({ stateful: true, jsonResponse: false });
    const response = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "receipt_success", arguments: {} } }, sessionId);
    expect(await response.text()).toMatch(/AW_RECEIPT:[0-9a-f-]+:success/);
  });

  it("cancels exactly the active wait invocation", async () => {
    const { host, post, sessionId } = await connect({ stateful: true, jsonResponse: false });
    const pending = post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "receipt_wait", arguments: {} } }, sessionId);
    let invocationId: string | undefined;
    for (let attempt = 0; attempt < 100 && !invocationId; attempt++) {
      const entered = host.evidence.find((event) => event.type === "entered" && event.mode === "wait");
      invocationId = entered?.type === "entered" ? entered.invocationId : undefined;
      if (!invocationId) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(invocationId).toBeTruthy();
    expect(host.cancel(invocationId ?? "missing")).toBe("cancel_requested");
    expect(await (await pending).text()).toContain(`AW_RECEIPT:${invocationId}:cancelled`);
    expect(host.cancel(invocationId ?? "missing")).toBe("already_terminal");
  });

  it("supports stateless JSON calls", async () => {
    const { post } = await connect({ stateful: false, jsonResponse: true });
    const response = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "receipt_reported_error", arguments: {} } });
    expect(await response.text()).toMatch(/AW_RECEIPT:[0-9a-f-]+:reported_error/);
  });
});
