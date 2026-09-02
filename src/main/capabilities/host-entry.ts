import { randomUUID } from "node:crypto";
import { parentPort } from "node:worker_threads";
import { CapabilityError } from "@agentic-worktrees/capability-sdk";
import { createCapabilityHostServer, type CapabilityHostServer } from "./capability-host-server";
import { isMainToHostMessage, type HostToMainMessage } from "./host-protocol";

const port = process.parentPort ?? parentPort;
if (!port) throw new Error("Capability host requires a utility-process parent port.");

let server: CapabilityHostServer | undefined;
const secretRequests = new Map<string, { resolve(value: string | undefined): void; reject(error: Error): void }>();
const send = (message: HostToMainMessage) => port.postMessage(message);

port.on("message", async (event: unknown) => {
  const candidate = event && typeof event === "object" && "data" in event ? (event as { data: unknown }).data : event;
  if (!isMainToHostMessage(candidate)) return;
  try {
    if (candidate.type === "host.initialize") {
      if (server) return;
      server = createCapabilityHostServer({
        token: candidate.token,
        resolveSecret(capabilityId, settingKey) {
          const requestId = randomUUID();
          return new Promise((resolve, reject) => {
            secretRequests.set(requestId, { resolve, reject });
            send({ type: "host.secret.request", requestId, capabilityId, settingKey });
          });
        },
      });
      await server.setActiveCapabilities(candidate.activeCapabilityIds, candidate.settings);
      const boundPort = await server.start();
      send({ type: "host.ready", runId: candidate.runId, port: boundPort });
    } else if (candidate.type === "host.capabilities.set") {
      if (!server) throw new CapabilityError("internal_error", "Capability host is not initialized.");
      const toolNames = await server.setActiveCapabilities(candidate.capabilityIds, candidate.settings);
      send({ type: "host.capabilities.applied", requestId: candidate.requestId, toolNames });
    } else {
      const pending = secretRequests.get(candidate.requestId);
      if (!pending) return;
      secretRequests.delete(candidate.requestId);
      if (candidate.errorCode) pending.resolve(undefined);
      else pending.resolve(candidate.value);
    }
  } catch (error) {
    const safe = error instanceof CapabilityError ? error : new CapabilityError("internal_error", "Capability host operation failed.");
    send({ type: "host.error", ...(candidate.type === "host.capabilities.set" ? { requestId: candidate.requestId } : {}), code: safe.code, message: safe.message });
  }
});

process.once("exit", () => { void server?.close(); });
