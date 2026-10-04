import type { CapabilityHostObservation } from "./capability-receipt";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import { CapabilityError } from "@agentic-worktrees/capability-sdk";
import {
  getBundledCapability,
  type CapabilityCatalog,
  type CapabilityRuntimeDescriptor,
} from "./catalog";
import {
  isHostToMainMessage,
  type HostToMainMessage,
  type MainToHostMessage,
} from "./host-protocol";

export interface CapabilityHostConnection {
  runId: string;
  serverName: string;
  url: string;
  bearerToken: string;
}

export interface CapabilityUtilityProcess {
  postMessage(message: MainToHostMessage): void;
  onMessage(listener: (message: unknown) => void): (() => void) | void;
  onExit(listener: (code: number) => void): (() => void) | void;
  removeMessageListener?(listener: (message: unknown) => void): void;
  removeExitListener?(listener: (code: number) => void): void;
  kill(): boolean;
}

export interface CapabilityHostManagerDependencies {
  launch(runId: string): CapabilityUtilityProcess;
  resolveSecret(
    capabilityId: string,
    settingKey: string,
  ): Promise<string | undefined>;
  onObservation?(
    ownerId: string,
    runtimeGenerationId: string,
    observation: CapabilityHostObservation,
  ): void;
  startupTimeoutMs?: number;
  updateTimeoutMs?: number;
  catalog?: CapabilityCatalog;
  createToken?(): string;
  logError?(code: "capability_host_listener_cleanup_failed"): void;
}

interface HostRecord {
  runtimeGenerationId?: string;
  cancellations: Map<
    string,
    {
      invocationId: string;
      timer: ReturnType<typeof setTimeout>;
      resolve(accepted: boolean): void;
      reject(error: Error): void;
    }
  >;
  child: CapabilityUtilityProcess;
  token: string;
  connection?: CapabilityHostConnection;
  ready: Promise<CapabilityHostConnection>;
  resolveReady(connection: CapabilityHostConnection): void;
  rejectReady(error: Error): void;
  startupTimer?: ReturnType<typeof setTimeout>;
  activeCapabilityIds: Set<string>;
  disposeListeners: (() => void)[];
  pending: Map<
    string,
    {
      capabilityIds: string[];
      timer: ReturnType<typeof setTimeout>;
      resolve(toolNames: string[]): void;
      reject(error: Error): void;
    }
  >;
}

function catalogEntry(
  dependencies: CapabilityHostManagerDependencies,
  capabilityId: string,
) {
  return (
    dependencies.catalog?.get(capabilityId) ??
    getBundledCapability(capabilityId)
  );
}
function runtimeDescriptors(
  dependencies: CapabilityHostManagerDependencies,
  ids: readonly string[],
): CapabilityRuntimeDescriptor[] {
  return ids.map((id) => catalogEntry(dependencies, id).runtime);
}
function isDeclaredSecret(
  dependencies: CapabilityHostManagerDependencies,
  capabilityId: string,
  settingKey: string,
): boolean {
  try {
    const manifest = catalogEntry(dependencies, capabilityId).manifest;
    const permissionName = settingKey.replace(
      /[A-Z]/g,
      (letter) => `-${letter.toLowerCase()}`,
    );
    return (
      manifest.settings[settingKey]?.type === "secret" &&
      manifest.permissions.secrets.includes(permissionName)
    );
  } catch {
    return false;
  }
}

export class CapabilityHostManager {
  private readonly hosts = new Map<string, HostRecord>();
  constructor(
    private readonly dependencies: CapabilityHostManagerDependencies,
  ) {}

  ensureHost(
    runId: string,
    activeCapabilityIds: string[] = [],
    settings: Record<string, Record<string, unknown>> = {},
    runtimeGenerationId?: string,
  ): Promise<CapabilityHostConnection> {
    const capabilities = runtimeDescriptors(
      this.dependencies,
      activeCapabilityIds,
    );
    const existing = this.hosts.get(runId);
    if (existing) {
      if (
        runtimeGenerationId &&
        runtimeGenerationId !== existing.runtimeGenerationId
      )
        return Promise.reject(
          new Error("Capability host generation mismatch."),
        );
      return existing.ready;
    }
    const ownedToken = runtimeGenerationId ? (this.dependencies.createToken?.() ?? randomBytes(32).toString("base64url")) : undefined;
    const child = this.dependencies.launch(runId);
    let cleaned = false;
    let ownedRecord: HostRecord | undefined;
    const ownedDisposers: (() => void)[] = [];
    const disposeOwnedListeners = () => {
      for (const dispose of ownedDisposers.splice(0)) {
        try {
          dispose();
        } catch {
          this.dependencies.logError?.(
            "capability_host_listener_cleanup_failed",
          );
        }
      }
    };
    const cleanupOwnedChild = (childAlreadyExited = false) => {
      if (cleaned) return;
      cleaned = true;
      if (this.hosts.get(runId)?.child === child) this.hosts.delete(runId);
      if (ownedRecord?.startupTimer) clearTimeout(ownedRecord.startupTimer);
      disposeOwnedListeners();
      if (ownedRecord) {
        const error = new CapabilityError(
          "internal_error",
          "Capability host failed to start.",
        );
        for (const request of ownedRecord.pending.values()) {
          clearTimeout(request.timer);
          request.reject(error);
        }
        ownedRecord.pending.clear();
      }
      if (!childAlreadyExited) {
        try {
          child.kill();
        } catch {
          // The stable startup error remains the only public failure.
        }
      }
    };
    try {
      const token = ownedToken ??
        this.dependencies.createToken?.() ??
        randomBytes(32).toString("base64url");
      let resolveReady!: (connection: CapabilityHostConnection) => void;
      let rejectReady!: (error: Error) => void;
      const ready = new Promise<CapabilityHostConnection>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      void ready.catch(() => undefined);
      const record: HostRecord = (ownedRecord = {
        child,
        runtimeGenerationId,
        cancellations: new Map(),
        token,
        ready,
        resolveReady,
        rejectReady,
        activeCapabilityIds: new Set(activeCapabilityIds),
        disposeListeners: ownedDisposers,
        pending: new Map(),
      });
      record.startupTimer = setTimeout(() => {
        if (!record.connection) {
          record.rejectReady(
            new CapabilityError(
              "internal_error",
              "Capability host startup timed out.",
            ),
          );
          if(!runtimeGenerationId)this.stopHost(runId);
        }
      }, this.dependencies.startupTimeoutMs ?? 10_000);
      this.hosts.set(runId, record);
      if(runtimeGenerationId)record.ready=ready.catch(async error=>{await this.stopOwnedHost(runId,runtimeGenerationId);throw error;});

      const messageListener = (raw: unknown) => {
        if (this.hosts.get(runId) !== record) return;
        const value =
          raw && typeof raw === "object" && "data" in raw
            ? (raw as { data: unknown }).data
            : raw;
        if (!isHostToMainMessage(value)) return;
        this.handleMessage(runId, record, value);
      };
      // Assigned after the cleanup closure is registered so synchronous launch failures can dispose safely.
      // eslint-disable-next-line prefer-const
      let returnedMessageDisposer: (() => void) | void;
      ownedDisposers.push(() => {
        try {
          returnedMessageDisposer?.();
        } finally {
          child.removeMessageListener?.(messageListener);
        }
      });
      returnedMessageDisposer = child.onMessage(messageListener);
      const exitListener = () => {
        const error = new CapabilityError(
          "internal_error",
          "Capability host stopped unexpectedly.",
        );
        if (!record.connection) record.rejectReady(error);
        for (const request of record.pending.values()) {
          clearTimeout(request.timer);
          request.reject(error);
        }
        record.pending.clear();
        for (const cancellation of record.cancellations.values()) {
          clearTimeout(cancellation.timer);
          cancellation.reject(error);
        }
        record.cancellations.clear();
        cleanupOwnedChild(true);
      };
      // eslint-disable-next-line prefer-const
      let returnedExitDisposer: (() => void) | void;
      ownedDisposers.push(() => {
        try {
          returnedExitDisposer?.();
        } finally {
          child.removeExitListener?.(exitListener);
        }
      });
      returnedExitDisposer = child.onExit(exitListener);
      child.postMessage({
        type: "host.initialize",
        runId,
        ...(runtimeGenerationId ? { runtimeGenerationId } : {}),
        token,
        capabilities,
        settings,
      });
      return record.ready;
    } catch {
      const error=new CapabilityError("internal_error","Capability host failed to start.");
      if(runtimeGenerationId && ownedRecord) {
        ownedRecord.rejectReady(error);
        return ownedRecord.ready;
      }
      cleanupOwnedChild();
      return Promise.reject(error);
    }
  }

  async setActiveCapabilities(
    runId: string,
    capabilityIds: string[],
    settings: Record<string, Record<string, unknown>> = {},
  ): Promise<string[]> {
    let capabilities: CapabilityRuntimeDescriptor[];
    try {
      capabilities = runtimeDescriptors(this.dependencies, capabilityIds);
    } catch (error) {
      if (this.hosts.has(runId)) this.stopHost(runId);
      throw error;
    }
    await this.ensureHost(runId);
    const record = this.hosts.get(runId);
    if (!record)
      throw new CapabilityError(
        "internal_error",
        "Capability host is unavailable.",
      );
    const requestId = randomUUID();
    return new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!record.pending.delete(requestId)) return;
        reject(
          new CapabilityError(
            "activation_failed",
            "Capability host update timed out.",
          ),
        );
      }, this.dependencies.updateTimeoutMs ?? 10_000);
      record.pending.set(requestId, {
        capabilityIds: [...capabilityIds],
        timer,
        resolve,
        reject,
      });
      record.child.postMessage({
        type: "host.capabilities.set",
        requestId,
        capabilities,
        settings,
      });
    });
  }

  async cancelInvocation(
    ownerId: string,
    runtimeGenerationId: string,
    invocationId: string,
  ): Promise<boolean> {
    const record = this.hosts.get(ownerId);
    if (
      !record?.connection ||
      record.runtimeGenerationId !== runtimeGenerationId
    )
      return false;
    const requestId = randomUUID();
    return new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        record.cancellations.delete(requestId);
        reject(new Error("Capability cancellation acknowledgement missing."));
      }, this.dependencies.updateTimeoutMs ?? 10_000);
      record.cancellations.set(requestId, {
        invocationId,
        timer,
        resolve,
        reject,
      });
      try {
        record.child.postMessage({
          type: "host.invocation.cancel",
          requestId,
          runtimeGenerationId,
          invocationId,
        });
      } catch (error) {
        clearTimeout(timer);
        record.cancellations.delete(requestId);
        reject(error);
      }
    });
  }

  resolveSecret(
    capabilityId: string,
    settingKey: string,
  ): Promise<string | undefined> {
    return this.dependencies.resolveSecret(capabilityId, settingKey);
  }

  async stopOwnedHost(ownerId:string,runtimeGenerationId:string):Promise<void> {
    const record=this.hosts.get(ownerId);
    if(!record)return;
    if(record.runtimeGenerationId !== runtimeGenerationId)throw new Error("Owned host generation mismatch.");
    let dispose:()=>void = () => undefined;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const exited=new Promise<void>((resolve,reject)=>{
      dispose=record.child.onExit(()=>resolve()) ?? (() => undefined);
      timer=setTimeout(()=>reject(new Error("Owned host exit could not be verified.")),5_000);
      try {if(!record.child.kill())reject(new Error("Owned host shutdown was rejected."));} catch {reject(new Error("Owned host shutdown failed."));}
    });
    try {await exited;this.stopHost(ownerId);} finally {clearTimeout(timer);dispose?.();}
  }

  stopHost(runId: string): void {
    const record = this.hosts.get(runId);
    if (!record) return;
    this.hosts.delete(runId);
    if (record.startupTimer) clearTimeout(record.startupTimer);
    const error = new CapabilityError("cancelled", "Capability host stopped.");
    if (!record.connection) record.rejectReady(error);
    for (const dispose of record.disposeListeners.splice(0)) {
      try {
        dispose();
      } catch {
        this.dependencies.logError?.("capability_host_listener_cleanup_failed");
      }
    }
    for (const request of record.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    record.pending.clear();
    for (const cancellation of record.cancellations.values()) {
      clearTimeout(cancellation.timer);
      cancellation.reject(error);
    }
    record.cancellations.clear();
    try {
      record.child.kill();
    } catch {
      // Child teardown is best-effort and never exposes utility details.
    }
  }

  async stopAll(): Promise<void> {
    for (const runId of [...this.hosts.keys()]) this.stopHost(runId);
  }

  private handleMessage(
    runId: string,
    record: HostRecord,
    message: HostToMainMessage,
  ): void {
    if (message.type === "host.observation") {
      if (record.runtimeGenerationId === message.runtimeGenerationId)
        this.dependencies.onObservation?.(
          runId,
          message.runtimeGenerationId,
          message.observation,
        );
    } else if (message.type === "host.invocation.cancelled") {
      const pending = record.cancellations.get(message.requestId);
      if (
        !pending ||
        record.runtimeGenerationId !== message.runtimeGenerationId ||
        pending.invocationId !== message.invocationId
      )
        return;
      clearTimeout(pending.timer);
      record.cancellations.delete(message.requestId);
      pending.resolve(message.accepted);
    } else if (message.type === "host.ready") {
      if (message.runId !== runId) return;
      if (record.startupTimer) clearTimeout(record.startupTimer);
      const connection = {
        runId,
        serverName: "agentic_worktrees",
        url: `http://127.0.0.1:${message.port}/mcp`,
        bearerToken: record.token,
      };
      record.connection = connection;
      record.resolveReady(connection);
    } else if (message.type === "host.secret.request") {
      if (
        !record.activeCapabilityIds.has(message.capabilityId) ||
        !isDeclaredSecret(
          this.dependencies,
          message.capabilityId,
          message.settingKey,
        )
      ) {
        record.child.postMessage({
          type: "host.secret.result",
          requestId: message.requestId,
          errorCode: "missing_secret",
        });
        return;
      }
      void this.resolveSecret(message.capabilityId, message.settingKey).then(
        (value) =>
          record.child.postMessage({
            type: "host.secret.result",
            requestId: message.requestId,
            ...(value ? { value } : { errorCode: "missing_secret" }),
          }),
        () =>
          record.child.postMessage({
            type: "host.secret.result",
            requestId: message.requestId,
            errorCode: "missing_secret",
          }),
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

function adaptElectronUtilityProcess(
  child: UtilityProcess,
): CapabilityUtilityProcess {
  return {
    postMessage(message) {
      child.postMessage(message);
    },
    onMessage(listener) {
      child.on("message", listener);
      return () => child.off("message", listener);
    },
    onExit(listener) {
      child.on("exit", listener);
      return () => child.off("exit", listener);
    },
    removeMessageListener: (listener) => child.off("message", listener),
    removeExitListener: (listener) => child.off("exit", listener),
    kill: () => child.kill(),
  };
}

export function createElectronCapabilityHostManager(
  resolveSecret: CapabilityHostManagerDependencies["resolveSecret"],
  catalog?: CapabilityCatalog,
  observationOptions: Pick<
    CapabilityHostManagerDependencies,
    "onObservation"
  > = {},
  hostBundlePath = path.join(__dirname, "capability-host.js"),
  environment?:Readonly<NodeJS.ProcessEnv>,
): CapabilityHostManager {
  return new CapabilityHostManager({
    ...observationOptions,
    launch: (runId) =>
      adaptElectronUtilityProcess(
        utilityProcess.fork(hostBundlePath, [], {
          serviceName: `Agentic Worktrees Capability Host ${runId}`,
          stdio: "pipe",
          ...(environment ? {env:{...environment}} : {}),
        }),
      ),
    resolveSecret,
    catalog,
  });
}
