import { CapabilityError } from "@agentic-worktrees/capability-sdk";
import type { CodingAgentKind } from "../coding-agents/types";
import type { CapabilityChangedEventDto, CapabilityConfigureRequest, CapabilityDetailDto, CapabilitySessionStateDto, CapabilityStateDto, CapabilitySummaryDto } from "../../shared/ipc/schemas";
import type { CodingAgentCapabilityActivator } from "./activation-types";
import { getBundledCapability, listBundledCapabilities, permissionDigest, toCapabilityDetailDto, toCapabilitySummaryDto } from "./catalog";
import type { CapabilityCredentialStore } from "./capability-credential-store";
import type { CapabilityHostManager } from "./capability-host-manager";
import type { CapabilityRepository, SessionCapabilityRecord } from "./capability-repository";

export interface CapabilityServiceDependencies {
  repository: CapabilityRepository;
  credentials: CapabilityCredentialStore;
  hosts: CapabilityHostManager;
  activator: CodingAgentCapabilityActivator;
  getAgentKind(runId: string): Promise<CodingAgentKind>;
  getAgentVersion?(runId: string): Promise<string>;
  probe?: typeof fetch;
  logError?(event: string, code: string): void;
}

const MINIMUM_AGENT_VERSIONS: Record<CodingAgentKind, string> = { codex: "0.150.1", opencode: "1.18.23" };
function isVersionAtLeast(actual: string, minimum: string): boolean {
  const value = actual.match(/\d+\.\d+\.\d+/)?.[0]?.split(".").map(Number);
  const floor = minimum.split(".").map(Number);
  if (!value) return false;
  for (let index = 0; index < 3; index += 1) {
    if ((value[index] ?? 0) !== (floor[index] ?? 0)) return (value[index] ?? 0) > (floor[index] ?? 0);
  }
  return true;
}

function recordState(record: SessionCapabilityRecord | undefined, baseState: "available" | "needs_setup" | "ready"): CapabilityStateDto {
  return record?.status ?? baseState;
}
function sessionDto(record: SessionCapabilityRecord): CapabilitySessionStateDto {
  const catalog = getBundledCapability(record.capabilityId);
  return {
    runId: record.runId, capabilityId: record.capabilityId, name: catalog.manifest.name,
    version: record.version, state: record.status,
    ...(record.errorCode ? { errorCode: record.errorCode } : {}),
    ...(record.activatedAt ? { activatedAt: record.activatedAt.toISOString() } : {}),
    ...(record.deactivatedAt ? { deactivatedAt: record.deactivatedAt.toISOString() } : {}),
  };
}

export class CapabilityService {
  private readonly listeners = new Set<(event: CapabilityChangedEventDto) => void>();
  constructor(private readonly dependencies: CapabilityServiceDependencies) {}

  listCapabilities(runId?: string): CapabilitySummaryDto[] {
    return listBundledCapabilities().map((capability) => {
      const installation = this.dependencies.repository.getInstallation(capability.manifest.id);
      const record = runId ? this.dependencies.repository.getSessionCapability(runId, capability.manifest.id) : undefined;
      const secretConfigured = this.dependencies.repository.getSettings(capability.manifest.id).some((setting) => setting.key === "exaApiKey" && Boolean(setting.secretRef));
      const baseState = !installation ? "available" : installation.configured && installation.permissionDigest === permissionDigest(capability.manifest) && installation.version === capability.manifest.version ? "ready" : "needs_setup";
      return toCapabilitySummaryDto(capability, recordState(record, baseState), secretConfigured);
    });
  }

  getCapability(capabilityId: string, runId?: string): CapabilityDetailDto {
    const capability = getBundledCapability(capabilityId);
    const installation = this.dependencies.repository.getInstallation(capabilityId);
    const record = runId ? this.dependencies.repository.getSessionCapability(runId, capabilityId) : undefined;
    const secretConfigured = this.dependencies.repository.getSettings(capabilityId).some((setting) => setting.key === "exaApiKey" && Boolean(setting.secretRef));
    const baseState = !installation ? "available" : installation.configured && installation.permissionDigest === permissionDigest(capability.manifest) && installation.version === capability.manifest.version ? "ready" : "needs_setup";
    return toCapabilityDetailDto(capability, recordState(record, baseState), secretConfigured);
  }

  async configureCapability(input: CapabilityConfigureRequest): Promise<CapabilityDetailDto> {
    const capability = getBundledCapability(input.capabilityId);
    const digest = permissionDigest(capability.manifest);
    if (input.acceptedPermissionDigest !== digest) throw new CapabilityError("permission_denied", "Capability permissions changed. Review and accept them again.");
    const existing = this.dependencies.repository.getSettings(input.capabilityId);
    const oldSecret = existing.find((setting) => setting.key === "exaApiKey")?.secretRef;
    const newSecret = input.exaApiKey ? await this.dependencies.credentials.setSecret(input.capabilityId, "exaApiKey", input.exaApiKey) : oldSecret;
    try {
      this.dependencies.repository.upsertInstallation({ capabilityId: input.capabilityId, version: capability.manifest.version, permissionDigest: digest, configured: true });
      this.dependencies.repository.replaceSettings(input.capabilityId, [
        { key: "providerMode", value: input.settings.providerMode },
        { key: "resultLimit", value: input.settings.resultLimit },
        ...(newSecret ? [{ key: "exaApiKey", secretRef: newSecret }] : []),
      ]);
    } catch (error) {
      if (newSecret && newSecret !== oldSecret) await this.dependencies.credentials.removeSecret(newSecret);
      throw error;
    }
    if (oldSecret && newSecret !== oldSecret) await this.dependencies.credentials.removeSecret(oldSecret);
    let warningCode: "upstream_unavailable" | undefined;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      try { await (this.dependencies.probe ?? fetch)("https://mcp.exa.ai/mcp", { method: "HEAD", signal: controller.signal }); }
      finally { clearTimeout(timer); }
    } catch { warningCode = "upstream_unavailable"; }
    return { ...this.getCapability(input.capabilityId), ...(warningCode ? { warningCode } : {}) };
  }

  async activateCapability(runId: string, capabilityId: string): Promise<CapabilitySessionStateDto> {
    const capability = getBundledCapability(capabilityId);
    const installation = this.dependencies.repository.getInstallation(capabilityId);
    if (!installation?.configured || installation.permissionDigest !== permissionDigest(capability.manifest) || installation.version !== capability.manifest.version) throw new CapabilityError("permission_denied", "Review and configure this capability before activation.");
    const agentKind = await this.dependencies.getAgentKind(runId);
    const agentVersion = await this.dependencies.getAgentVersion?.(runId);
    if (agentVersion && !isVersionAtLeast(agentVersion, MINIMUM_AGENT_VERSIONS[agentKind])) throw new CapabilityError("activation_failed", "Update the coding agent before activating this capability.");
    if (capability.manifest.compatibility[agentKind] !== "supported") throw new CapabilityError("activation_failed", "Capability is incompatible with this coding agent.");
    const current = this.dependencies.repository.getSessionCapability(runId, capabilityId);
    if (current?.status === "active") return sessionDto(current);
    if (!(await this.dependencies.activator.isAgentIdle(runId))) throw new CapabilityError("activation_failed", "Capabilities can only be changed between turns.");
    const previousIds = this.dependencies.repository.listSessionCapabilities(runId).filter((item) => item.status === "active").map((item) => item.capabilityId);
    const pending = this.dependencies.repository.transitionSessionCapability({ runId, capabilityId, version: capability.manifest.version, to: "pending_activation" });
    this.emit(pending);
    try {
      await this.dependencies.activator.prepareSession(runId, agentKind);
      if (agentKind === "opencode") {
        const reloading = this.dependencies.repository.transitionSessionCapability({ runId, capabilityId, version: capability.manifest.version, to: "reloading" });
        this.emit(reloading);
      }
      const settings = this.hostSettings([...previousIds, capabilityId]);
      const toolNames = await this.dependencies.hosts.setActiveCapabilities(runId, [...new Set([...previousIds, capabilityId])], settings);
      await this.dependencies.activator.apply(runId, toolNames);
      const active = this.dependencies.repository.transitionSessionCapability({ runId, capabilityId, version: capability.manifest.version, to: "active" });
      this.emit(active);
      return sessionDto(active);
    } catch (error) {
      await this.dependencies.hosts.setActiveCapabilities(runId, previousIds, this.hostSettings(previousIds)).catch(() => undefined);
      const code = error instanceof CapabilityError ? error.code : "activation_failed";
      const failed = this.dependencies.repository.transitionSessionCapability({ runId, capabilityId, version: capability.manifest.version, to: "activation_failed", errorCode: code });
      this.emit(failed);
      throw new CapabilityError(code, "Capability activation failed.");
    }
  }

  async deactivateCapability(runId: string, capabilityId: string): Promise<CapabilitySessionStateDto> {
    const capability = getBundledCapability(capabilityId);
    const current = this.dependencies.repository.getSessionCapability(runId, capabilityId);
    if (!current || current.status === "inactive") return sessionDto(current ?? this.dependencies.repository.transitionSessionCapability({ runId, capabilityId, version: capability.manifest.version, to: "inactive" }));
    if (!(await this.dependencies.activator.isAgentIdle(runId))) throw new CapabilityError("activation_failed", "Capabilities can only be changed between turns.");
    const agentKind = await this.dependencies.getAgentKind(runId);
    const pending = this.dependencies.repository.transitionSessionCapability({ runId, capabilityId, version: capability.manifest.version, to: "pending_deactivation" });
    this.emit(pending);
    if (agentKind === "opencode") {
      const reloading = this.dependencies.repository.transitionSessionCapability({ runId, capabilityId, version: capability.manifest.version, to: "reloading" });
      this.emit(reloading);
    }
    const remaining = this.dependencies.repository.listSessionCapabilities(runId).filter((item) => item.capabilityId !== capabilityId && item.status === "active").map((item) => item.capabilityId);
    try {
      await this.dependencies.hosts.setActiveCapabilities(runId, remaining, this.hostSettings(remaining));
      await this.dependencies.activator.remove(runId);
      const inactive = this.dependencies.repository.transitionSessionCapability({ runId, capabilityId, version: capability.manifest.version, to: "inactive" });
      this.emit(inactive);
      return sessionDto(inactive);
    } catch (error) {
      const previousIds = [...remaining, capabilityId];
      try {
        const rollbackTools = await this.dependencies.hosts.setActiveCapabilities(runId, previousIds, this.hostSettings(previousIds));
        await this.dependencies.activator.apply(runId, rollbackTools);
      } catch (rollbackError) {
        const rollbackCode = rollbackError instanceof CapabilityError ? rollbackError.code : "activation_failed";
        this.dependencies.logError?.("capability.deactivation.rollback.failed", rollbackCode);
      }
      const code = error instanceof CapabilityError ? error.code : "activation_failed";
      const failed = this.dependencies.repository.transitionSessionCapability({ runId, capabilityId, version: capability.manifest.version, to: "activation_failed", errorCode: code });
      this.emit(failed);
      throw new CapabilityError(code, "Capability deactivation failed.");
    }
  }

  subscribeToCapabilityEvents(listener: (event: CapabilityChangedEventDto) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  async reconcileCapabilities(): Promise<void> {
    for (const record of this.dependencies.repository.listInterruptedSessionCapabilities()) {
      const failed = this.dependencies.repository.transitionSessionCapability({ runId: record.runId, capabilityId: record.capabilityId, version: record.version, to: "activation_failed", errorCode: "activation_failed" });
      this.emit(failed);
    }
    const activeRunIds = [...new Set(this.dependencies.repository.listActiveSessionCapabilities().map((record) => record.runId))];
    for (const runId of activeRunIds) {
      try {
        const agentKind = await this.dependencies.getAgentKind(runId);
        await this.dependencies.activator.prepareSession(runId, agentKind);
      } catch (error) {
        const code = error instanceof CapabilityError ? error.code : "activation_failed";
        this.dependencies.logError?.("capability.reconcile.failed", code);
      }
    }
  }
  stopCapabilities(): Promise<void> { return this.dependencies.hosts.stopAll(); }

  async resolveSecret(capabilityId: string, settingKey: string): Promise<string | undefined> {
    const reference = this.dependencies.repository.getSettings(capabilityId).find((setting) => setting.key === settingKey)?.secretRef;
    return reference ? this.dependencies.credentials.getSecret(reference) : undefined;
  }

  private hostSettings(ids: readonly string[]): Record<string, Record<string, unknown>> {
    return Object.fromEntries(ids.map((id) => [id, Object.fromEntries(this.dependencies.repository.getSettings(id).filter((setting) => setting.value !== undefined).map((setting) => [setting.key, setting.value]))]));
  }
  private emit(record: SessionCapabilityRecord): void {
    const event = { ...sessionDto(record), updatedAt: record.updatedAt.toISOString() };
    for (const listener of this.listeners) listener(event);
  }
}
