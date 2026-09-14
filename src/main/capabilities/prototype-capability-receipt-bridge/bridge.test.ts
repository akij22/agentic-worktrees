import { afterEach, describe, expect, it } from "vitest";
import { correlate, createReceiptBridgeHost, type ProviderEvidence } from "./bridge";

const hosts: Array<ReturnType<typeof createReceiptBridgeHost>> = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map((host) => host.close())); });

async function fixture() {
  const host = createReceiptBridgeHost({ lease: "A", token: "test-token", runtimeGeneration: "current", timeoutMs: 30 });
  hosts.push(host); const port = await host.start();
  const call = async (name: string) => fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }) }).then((response) => response.json()) as Promise<{ result: { isError: boolean; content: Array<{ text: string }> } }>;
  return { host, call };
}

describe("receipt bridge host", () => {
  it.each([
    ["receipt_success", "success", false],
    ["receipt_reported_error", "reported_error", true],
    ["receipt_throw", "thrown", true],
    ["receipt_timeout", "timeout", true],
  ] as const)("preserves one receipt for %s", async (tool, outcome, isError) => {
    const { host, call } = await fixture(); const response = await call(tool);
    const entered = host.evidence.find((event) => event.type === "host.invocation.entered");
    const completed = host.evidence.find((event) => event.type === "host.invocation.outcome");
    expect(entered?.invocationId).toBe(completed?.invocationId);
    expect(completed).toMatchObject({ outcome });
    expect(response.result.isError).toBe(isError);
    expect(response.result.content[0].text).toContain(`AW_RECEIPT:${entered?.invocationId}`);
  });

  it("cancels only the exact active invocation in the current runtime generation", async () => {
    const { host, call } = await fixture(); const pending = call("receipt_wait");
    while (!host.evidence.some((event) => event.type === "host.invocation.entered")) await new Promise((resolve) => setTimeout(resolve, 5));
    const entered = host.evidence.find((event) => event.type === "host.invocation.entered");
    expect(host.cancel(entered?.invocationId ?? "", "stale")).toBe("stale_generation");
    expect(host.cancel(entered?.invocationId ?? "", "current")).toBe("cancel_requested");
    const response = await pending;
    expect(response.result.content[0].text).toContain("AW_OUTCOME:cancelled");
  });
});

describe("receipt correlation", () => {
  const host = [
    { type: "host.invocation.entered" as const, invocationId: "inv", runtimeGeneration: "current", lease: "A" as const, resourceId: "resource", mode: "success" as const },
    { type: "host.invocation.outcome" as const, invocationId: "inv", runtimeGeneration: "current", outcome: "success" as const },
  ];
  const event: ProviderEvidence = { provider: "opencode", session: "B", expectedLease: "B", runtimeGeneration: "current", invocationId: "inv", server: "aw_a_receipt_success", eventIdentity: "event" };

  it("pairs the actual provider session and exposes a lease mismatch", () => {
    expect(correlate({ host, provider: [event], activeRuntimeGeneration: "current" })).toMatchObject({ pairs: [{ session: "B", leaseMismatch: true }], unknownSession: 0 });
  });

  it("deduplicates replay and rejects stale generations", () => {
    const result = correlate({ host, provider: [event, { ...event }, { ...event, eventIdentity: "stale", runtimeGeneration: "old" }], activeRuntimeGeneration: "current" });
    expect(result).toMatchObject({ duplicateEventsDeduplicated: 1, staleRejected: 1, pairs: [{ session: "B" }] });
  });

  it("quarantines conflicting sessions and keeps host-only execution unknown", () => {
    const conflict = correlate({ host, provider: [event, { ...event, eventIdentity: "other", session: "A" }], activeRuntimeGeneration: "current" });
    expect(conflict).toMatchObject({ pairs: [], conflicts: 1, unknownSession: 1 });
    expect(correlate({ host, provider: [], activeRuntimeGeneration: "current" })).toMatchObject({ pairs: [], unknownSession: 1 });
  });
});
