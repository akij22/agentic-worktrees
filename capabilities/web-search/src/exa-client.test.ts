import { describe, expect, it, vi } from "vitest";
import { searchExaAuto } from "./exa-client";

const signal = new AbortController().signal;
const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const mcpPayload = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ results: [{ title: "Electron", url: "https://exa.example/electron", text: "Desktop apps" }] }) }] } };

describe("searchExaAuto", () => {
  it("uses hosted MCP without a key and parses JSON", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(mcpPayload));
    const output = await searchExaAuto({ query: "electron" }, { fetchImpl: fetchMock, signal });
    expect(fetchMock).toHaveBeenCalledWith("https://mcp.exa.ai/mcp?tools=web_search_exa", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Accept: "application/json, text/event-stream", "Content-Type": "application/json" }) }));
    expect(JSON.stringify(fetchMock.mock.calls[0])).not.toContain("apiKey");
    expect(output).toMatchObject({ provider: "exa-hosted", degraded: false, results: [{ url: "https://exa.example/electron" }] });
  });

  it("parses SSE responses", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(`event: message\ndata: ${JSON.stringify(mcpPayload)}\n\n`, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    await expect(searchExaAuto({ query: "electron" }, { fetchImpl: fetchMock, signal })).resolves.toMatchObject({ results: [{ title: "Electron" }] });
  });

  it("normalizes rate limit, malformed payload, and cancellation", async () => {
    const limited = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 429 }));
    await expect(searchExaAuto({ query: "electron" }, { fetchImpl: limited, signal })).rejects.toMatchObject({ code: "rate_limited" });
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response("not-json"));
    await expect(searchExaAuto({ query: "electron" }, { fetchImpl: malformed, signal })).rejects.toMatchObject({ code: "upstream_protocol_error" });
    const wrongShape = vi.fn<typeof fetch>().mockResolvedValue(new Response("[]"));
    await expect(searchExaAuto({ query: "electron" }, { fetchImpl: wrongShape, signal })).rejects.toMatchObject({ code: "upstream_protocol_error" });
    const aborted = vi.fn<typeof fetch>().mockRejectedValue(Object.assign(new Error("query secret"), { name: "AbortError" }));
    await expect(searchExaAuto({ query: "electron" }, { fetchImpl: aborted, signal })).rejects.toMatchObject({ code: "cancelled", message: "Web search was cancelled." });
  });

  it("degrades advanced hosted search to basic only", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("failed", { status: 500 }))
      .mockResolvedValueOnce(jsonResponse(mcpPayload));
    const output = await searchExaAuto({ query: "electron", domains: ["example.com"] }, { fetchImpl: fetchMock, signal });
    expect(output.degraded).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://mcp.exa.ai/mcp?tools=web_search_exa");
  });

  it("uses direct Exa search only when a key is provided", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ results: [{ title: "Electron", url: "https://exa.example/electron", text: "Desktop" }] }));
    const output = await searchExaAuto({ query: "electron" }, { apiKey: "key", fetchImpl: fetchMock, signal });
    expect(output.provider).toBe("exa-api");
    expect(fetchMock).toHaveBeenCalledWith("https://api.exa.ai/search", expect.objectContaining({ headers: expect.objectContaining({ "x-api-key": "key" }) }));
  });
});
