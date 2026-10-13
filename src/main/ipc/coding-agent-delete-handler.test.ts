import { afterEach, describe, expect, it, vi } from "vitest";
import { createCodingAgentDeleteHandler } from "./coding-agent-delete-handler";

afterEach(() => vi.restoreAllMocks());

describe("chat deletion IPC", () => {
  it("rejects malformed requests before reaching the service", async () => {
    const remove = vi.fn(async () => undefined);
    const handle = createCodingAgentDeleteHandler(remove);
    const result = await handle({}, { runId: " " });
    expect(result).toMatchObject({
      success: false,
      error: { code: "INVALID_REQUEST" },
    });
    expect(remove).not.toHaveBeenCalled();
  });
  it("returns success for a deleted chat", async () => {
    const handle = createCodingAgentDeleteHandler(async () => undefined);
    expect(await handle({}, { runId: "chat-1" })).toEqual({ success: true });
  });
  it("returns a public error without leaking internal failure details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handle = createCodingAgentDeleteHandler(async () => {
      throw new Error("/private/path token=secret");
    });
    const result = await handle({}, { runId: "chat-1" });
    expect(result).toMatchObject({
      success: false,
      error: { code: "DELETE_FAILED" },
    });
    expect(JSON.stringify(result)).not.toMatch(/private|secret/);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|secret/);
  });
});
