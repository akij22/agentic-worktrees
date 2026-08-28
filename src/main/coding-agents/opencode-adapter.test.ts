import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return {
    ...original,
    spawn: vi.fn(),
  };
});

vi.mock("node:crypto", () => ({
  randomBytes: vi.fn(() => Buffer.from("test-password")),
}));

vi.mock("./opencode-utils", async (importOriginal) => {
  const original = await importOriginal<typeof import("./opencode-utils")>();
  return {
    ...original,
    reserveLocalPort: vi.fn(async () => 4096),
  };
});

import { spawn } from "node:child_process";
import { OpenCodeAdapter, toOpenCodeRunStatus } from "./opencode-adapter";
import type { CodingAgentEvent } from "./types";

const createFakeChildProcess = (): ChildProcess => {
  const child = new EventEmitter() as EventEmitter & {
    exitCode: number | null;
    stderr: EventEmitter;
    stdout: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.exitCode = null;
  child.stderr = new EventEmitter();
  child.stdout = new EventEmitter();
  child.kill = vi.fn(() => {
    child.exitCode = 0;
    queueMicrotask(() => child.emit("exit", 0, null));
    return true;
  });
  return child as unknown as ChildProcess;
};

describe("toOpenCodeRunStatus", () => {
  it("maps an idle OpenCode session to an idle run", () => {
    expect(toOpenCodeRunStatus({ type: "idle" })).toBe("idle");
  });

  it.each([
    { type: "busy" as const },
    {
      type: "retry" as const,
      attempt: 2,
      message: "Provider is busy",
      next: Date.now() + 1_000,
    },
  ])("keeps active OpenCode status $type busy", (status) => {
    expect(toOpenCodeRunStatus(status)).toBe("busy");
  });

  it("treats a session omitted from the active status map as idle", () => {
    expect(toOpenCodeRunStatus(undefined)).toBe("idle");
  });
});

describe("OpenCode account usage", () => {
  it("reports that provider-independent account quota is unavailable", async () => {
    await expect(
      new OpenCodeAdapter().getAccountUsage("/repo", "session-1", {
        providerId: "anthropic",
        modelId: "claude-sonnet",
      }),
    ).resolves.toEqual({
      providerId: "anthropic",
      availability: "unavailable",
      message:
        "OpenCode does not expose a provider-independent account usage API.",
      windows: [],
    });
  });
});

describe("OpenCode event streaming", () => {
  it("normalizes current streaming and permission events and replies through the current API", async () => {
    const child = createFakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child);
    const originalFetch = globalThis.fetch;
    let eventAuthorization: string | null = null;
    let permissionReply: { path: string; body: unknown } | null = null;
    const permissionEvent = JSON.stringify({
      directory: "/repo",
      payload: {
        type: "permission.asked",
        properties: {
          id: "permission-1",
          sessionID: "session-1",
          permission: "bash",
          patterns: ["npm run typecheck"],
          metadata: { cwd: "/repo" },
          always: [],
        },
      },
    });
    const deltaEvent = JSON.stringify({
      directory: "/repo",
      payload: {
        type: "message.part.delta",
        properties: {
          sessionID: "session-1",
          messageID: "message-1",
          partID: "part-1",
          field: "text",
          delta: "Checking",
        },
      },
    });
    const eventStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${permissionEvent}\n\ndata: ${deltaEvent}\n\n`,
          ),
        );
      },
    });
    globalThis.fetch = vi.fn<typeof fetch>(async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname === "/global/health") {
        return Response.json({ healthy: true, version: "1.17.18" });
      }
      if (url.pathname === "/global/event") {
        eventAuthorization = request.headers.get("Authorization");
        return new Response(eventStream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      if (url.pathname === "/permission/permission-1/reply") {
        permissionReply = {
          path: url.pathname,
          body: await request.json(),
        };
        return Response.json(true);
      }
      throw new Error(`Unexpected OpenCode request: ${url.pathname}`);
    });

    const adapter = new OpenCodeAdapter();
    const events: CodingAgentEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    try {
      await adapter.start("/usr/local/bin/opencode", "/tmp");
      await vi.waitFor(() => {
        expect(events.map(({ type }) => type)).toEqual([
          "permission.updated",
          "message.part.updated",
        ]);
      });
      await adapter.respondPermission(
        "/repo",
        "session-1",
        "permission-1",
        "once",
      );

      expect(eventAuthorization).toBe(
        `Basic ${Buffer.from("opencode:dGVzdC1wYXNzd29yZA").toString("base64")}`,
      );
      expect(events[0]).toEqual({
        directory: "/repo",
        sessionId: "session-1",
        type: "permission.updated",
        properties: {
          id: "permission-1",
          sessionID: "session-1",
          title: "OpenCode requests permission",
          type: "bash",
          metadata: {
            command: "npm run typecheck",
            cwd: "/repo",
          },
        },
      });
      expect(permissionReply).toEqual({
        path: "/permission/permission-1/reply",
        body: { reply: "once" },
      });
    } finally {
      await adapter.stop();
      globalThis.fetch = originalFetch;
    }
  });

  it("reconnects after a global event stream closes normally", async () => {
    vi.useFakeTimers();
    const child = createFakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child);
    const originalFetch = globalThis.fetch;
    let eventRequests = 0;
    const eventPayload = JSON.stringify({
      directory: "/repo",
      payload: {
        type: "session.idle",
        properties: { sessionID: "session-1" },
      },
    });
    globalThis.fetch = vi.fn<typeof fetch>(async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname === "/global/health") {
        return Response.json({ healthy: true, version: "1.17.18" });
      }
      if (url.pathname === "/global/event") {
        eventRequests += 1;
        return new Response(`data: ${eventPayload}\n\n`, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      throw new Error(`Unexpected OpenCode request: ${url.pathname}`);
    });

    const adapter = new OpenCodeAdapter();

    try {
      await adapter.start("/usr/local/bin/opencode", "/tmp");
      await vi.advanceTimersByTimeAsync(1_000);

      expect(eventRequests).toBeGreaterThanOrEqual(2);
    } finally {
      await adapter.stop();
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    }
  });
});


describe("OpenCode capability reconfiguration", () => {
  const connection = { serverName: "aw_run_1", profileId: "aw_run_1", url: "http://127.0.0.1:1/mcp", authorizationHeader: "Bearer token" };
  it("checks every supplied session before restarting the shared process", async () => {
    const adapter = new OpenCodeAdapter();
    Object.assign(adapter as unknown as Record<string, unknown>, { executablePath: "/bin/opencode", startupDirectory: "/repo" });
    const getSession = vi.spyOn(adapter, "getSession").mockImplementation(async (_directory, sessionId) => ({ id: sessionId, status: sessionId === "busy" ? "busy" : "idle" }));
    const stop = vi.spyOn(adapter, "stop").mockResolvedValue();
    vi.spyOn(adapter, "start").mockResolvedValue("1.18.23");
    await expect(adapter.reconfigureCapabilities({ connections: [connection], sessions: [{ directory: "/one", sessionId: "idle" }, { directory: "/two", sessionId: "busy" }] })).rejects.toMatchObject({ code: "agent_reload_failed" });
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(stop).not.toHaveBeenCalled();
  });

  it("rejects prompts for every chat while reconfiguration is in flight", async () => {
    const adapter = new OpenCodeAdapter();
    Object.assign(adapter as unknown as Record<string, unknown>, { executablePath: "/bin/opencode", startupDirectory: "/repo" });
    let release!: () => void;
    let checks = 0;
    vi.spyOn(adapter, "getSession").mockImplementation(() => {
      checks += 1;
      if (checks > 1) return Promise.resolve({ id: "session", status: "idle" });
      return new Promise((resolve) => { release = () => resolve({ id: "session", status: "idle" }); });
    });
    vi.spyOn(adapter, "stop").mockResolvedValue();
    vi.spyOn(adapter, "start").mockResolvedValue("1.18.23");
    const reload = adapter.reconfigureCapabilities({ connections: [connection], sessions: [{ directory: "/repo", sessionId: "session" }] });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await expect(adapter.sendPrompt("/repo", "other", { content: "race", providerId: "p", modelId: "m" })).rejects.toMatchObject({ code: "agent_reload_failed" });
    release();
    await reload;
  });
});
