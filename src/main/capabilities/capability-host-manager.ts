import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import { CapabilityError } from "@agentic-worktrees/capability-sdk";
import { getBundledCapability } from "./catalog";
import { isHostToMainMessage, type HostToMainMessage, type MainToHostMessage } from "./host-protocol";

export interface CapabilityHostConnection {
  runId: string;
  serverName: string;
  url: string;
  bearerToken: string;
}

export interface CapabilityUtilityProcess {
  postMessage(message: MainToHostMessage): void;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: (code: number) => void): void;
  kill(): boolean;
}

export interface CapabilityHostManagerDependencies {
  launch(runId: string): CapabilityUtilityProcess;
  resolveSecret(capabilityId: string, settingKey: string): Promise<string | undefined>;
  startupTimeoutMs?: number;
  updateTimeoutMs?: number;
}

interface HostRecord {
  child: CapabilityUtilityProcess;
  token: string;
  connection?: CapabilityHostConnection;
  ready: Promise<CapabilityHostConnection>;
  resolveReady(connection: CapabilityHostConnection): void;
  rejectReady(error: Error): void;
  startupTimer?: ReturnType<typeof setTimeout>;
  activeCapabilityIds: Set<string>;
  pending: Map<string, {
    capabilityIds: string[];
    timer: ReturnType<typeof setTimeout>;
    resolve(toolNames: string[]): void;
    reject(error: Error): void;
  }>;
}

function isDeclaredSecret(capabilityId: string, settingKey: string): boolean {
  try {
    const manifest = getBundledCapability(capabilityId).manifest;
    const permissionName = settingKey.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    return manifest.settings[settingKey]?.type === "secret" && manifest.permissions.secrets.includes(permissionName);
  } catch {
    return false;
  }
}

export class CapabilityHostManager {
  private readonly hosts = new Map<string, HostRecord>();
  constructor(private readonly dependencies: CapabilityHostManagerDependencies) {}

  ensureHost(runId: string, activeCapabilityIds: string[] = [], settings: Record<string, Record<string, unknown>> = {}): Promise<CapabilityHostConnection> {
    const existing = this.hosts.get(runId);
    if (existing) return existing.ready;
    const child = this.dependencies.launch(runId);
    const token = randomBytes(32).toString("base64url");
    let resolveReady!: (connection: CapabilityHostConnection) => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<CapabilityHostConnection>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const record: HostRecord = {
      child,
      token,
      ready,
      resolveReady,
      rejectReady,
      activeCapabilityIds: new Set(activeCapabilityIds),
      pending: new Map(),
    };
    record.startupTimer = setTimeout(() => {
      if (!record.connection) {
        record.rejectReady(new CapabilityError("internal_error", "Capability host startup timed out."));
        this.stopHost(runId);
      }
    }, this.dependencies.startupTimeoutMs ?? 10_000);
    this.hosts.set(runId, record);

    child.onMessage((raw) => {
      if (this.hosts.get(runId) !== record) return;
      const value = raw && typeof raw === "object" && "data" in raw ? (raw as { data: unknown }).data : raw;
      if (!isHostToMainMessage(value)) return;
      this.handleMessage(runId, record, value);
    });
    child.onExit(() => {
      if (record.startupTimer) clearTimeout(record.startupTimer);
      if (this.hosts.get(runId) !== record) return;
      this.hosts.delete(runId);
      const error = new CapabilityError("internal_error", "Capability host stopped unexpectedly.");
      if (!record.connection) record.rejectReady(error);
      for (const request of record.pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      record.pending.clear();
    });
    child.postMessage({ type: "host.initialize", runId, token, activeCapabilityIds, settings });
    return ready;
  }

  async setActiveCapabilities(runId: string, capabilityIds: string[], settings: Record<string, Record<string, unknown>> = {}): Promise<string[]> {
    await this.ensureHost(runId);
    const record = this.hosts.get(runId);
    if (!record) throw new CapabilityError("internal_error", "Capability host is unavailable.");
    const requestId = randomUUID();
    return new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!record.pending.delete(requestId)) return;
        reject(new CapabilityError("activation_failed", "Capability host update timed out."));
      }, this.dependencies.updateTimeoutMs ?? 10_000);
      record.pending.set(requestId, { capabilityIds: [...capabilityIds], timer, resolve, reject });
      record.child.postMessage({ type: "host.capabilities.set", requestId, capabilityIds, settings });
    });
  }

  resolveSecret(capabilityId: string, settingKey: string): Promise<string | undefined> {
    return this.dependencies.resolveSecret(capabilityId, settingKey);
  }

  stopHost(runId: string): void {
    const record = this.hosts.get(runId);
    if (!record) return;
    this.hosts.delete(runId);
    if (record.startupTimer) clearTimeout(record.startupTimer);
    const error = new CapabilityError("cancelled", "Capability host stopped.");
    if (!record.connection) record.rejectReady(error);
    record.child.kill();
    for (const request of record.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    record.pending.clear();
  }

  async stopAll(): Promise<void> {
    for (const runId of [...this.hosts.keys()]) this.stopHost(runId);
  }

  private handleMessage(runId: string, record: HostRecord, message: HostToMainMessage): void {
    if (message.type === "host.ready") {
      if (message.runId !== runId) return;
      if (record.startupTimer) clearTimeout(record.startupTimer);
      const connection = { runId, serverName: "agentic_worktrees", url: `http://127.0.0.1:${message.port}/mcp`, bearerToken: record.token };
      record.connection = connection;
      record.resolveReady(connection);
    } else if (message.type === "host.secret.request") {
      if (!record.activeCapabilityIds.has(message.capabilityId) || !isDeclaredSecret(message.capabilityId, message.settingKey)) {
        record.child.postMessage({ type: "host.secret.result", requestId: message.requestId, errorCode: "missing_secret" });
        return;
      }
      void this.resolveSecret(message.capabilityId, message.settingKey).then(
        (value) => record.child.postMessage({ type: "host.secret.result", requestId: message.requestId, ...(value ? { value } : { errorCode: "missing_secret" }) }),
        () => record.child.postMessage({ type: "host.secret.result", requestId: message.requestId, errorCode: "missing_secret" }),
      );
    } else if (message.type === "host.capabilities.applied") {
      const pending = record.pending.get(message.requestId);
      if (!pending) return;
      record.pending.delete(message.requestId);
      clearTimeout(pending.timer);
      record.activeCapabilityIds = new Set(pending.capabilityIds);
      pending.resolve(message.toolNames);
    } else if (message.requestId) {
      const pending = record.pending.get(message.requestId);
      if (!pending) return;
      record.pending.delete(message.requestId);
      clearTimeout(pending.timer);
      pending.reject(new CapabilityError(message.code, message.message));
    }
  }
}

function adaptElectronUtilityProcess(child: UtilityProcess): CapabilityUtilityProcess {
  return {
    postMessage(message) { child.postMessage(message); },
    onMessage(listener) { child.on("message", listener); },
    onExit(listener) { child.on("exit", listener); },
    kill: () => child.kill(),
  };
}

export function createElectronCapabilityHostManager(resolveSecret: CapabilityHostManagerDependencies["resolveSecret"]): CapabilityHostManager {
  return new CapabilityHostManager({
    launch: (runId) => adaptElectronUtilityProcess(utilityProcess.fork(path.join(__dirname, "capability-host.js"), [], { serviceName: `Agentic Worktrees Capability Host ${runId}`, stdio: "pipe" })),
    resolveSecret,
  });
}
