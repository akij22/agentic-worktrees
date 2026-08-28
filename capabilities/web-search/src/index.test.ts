import { describe, expect, it, vi } from "vitest";
import { createWebSearchCapability } from "./index";

describe("web search capability", () => {
  it("resolves the optional key at execution and returns attributed output", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ results: [{ title: "Electron", url: "https://exa.example/electron", text: "Desktop" }] })));
    const capability = createWebSearchCapability({ fetchImpl: fetchMock });
    const getOptional = vi.fn().mockResolvedValue("key");
    const result = await capability.tools[0].execute({ query: "electron" }, {
      signal: new AbortController().signal, settings: { resultLimit: 5 }, secrets: { get: vi.fn(), getOptional }, logger: { info: vi.fn(), error: vi.fn() },
    });
    expect(getOptional).toHaveBeenCalledWith("exaApiKey");
    expect(result.content[0]?.text).toContain("https://exa.example/electron");
  });
});
