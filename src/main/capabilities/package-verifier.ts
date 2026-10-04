import path from "node:path";
import { randomUUID } from "node:crypto";
import { utilityProcess, type UtilityProcess } from "electron";
import type { InspectedCapabilityPackage } from "./package-inspector";
import { capabilityVerificationErrorSchema, capabilityVerificationResultSchema } from "./package-verification-protocol";

export interface CapabilityExecutableVerification { capabilityId: string; version: string; toolNames: readonly string[]; contentDigest: string }
export interface CapabilityPackageVerifier { verify(inspected: InspectedCapabilityPackage, signal: AbortSignal): Promise<CapabilityExecutableVerification> }
export interface CapabilityVerifierUtilityProcess { postMessage(message: unknown): void; onMessage(listener: (message: unknown) => void): void; onExit(listener: (code: number) => void): void; kill(): boolean }
export interface CapabilityPackageVerifierDependencies { launch(requestId: string): CapabilityVerifierUtilityProcess; timeoutMs?: number }

export class DisposableCapabilityPackageVerifier implements CapabilityPackageVerifier {
  constructor(private readonly dependencies: CapabilityPackageVerifierDependencies) {}
  verify(inspected: InspectedCapabilityPackage, signal: AbortSignal): Promise<CapabilityExecutableVerification> {
    if (signal.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("Capability verification cancelled"));
    const requestId = randomUUID(), child = this.dependencies.launch(requestId);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, result?: CapabilityExecutableVerification) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); signal.removeEventListener("abort", cancelled); try { child.kill(); } catch { /* cleanup is best effort */ } error ? reject(error) : resolve(result!); };
      const cancelled = () => finish(signal.reason instanceof Error ? signal.reason : new Error("Capability verification cancelled"));
      const timer = setTimeout(() => finish(new Error("Capability verification timed out")), this.dependencies.timeoutMs ?? 10_000);
      try {
        signal.addEventListener("abort", cancelled, { once: true });
        child.onExit(() => finish(new Error("Capability verifier stopped unexpectedly")));
        child.onMessage((raw) => {
          const value = raw && typeof raw === "object" && "data" in raw ? (raw as { data: unknown }).data : raw;
          const result = capabilityVerificationResultSchema.safeParse(value);
          if (result.success && result.data.requestId === requestId) {
            if (result.data.contentDigest !== inspected.staged.contentDigest || result.data.capabilityId !== inspected.descriptor.manifest.id || result.data.version !== inspected.descriptor.manifest.version) return finish(new Error("Capability verification result mismatch"));
            return finish(undefined, { capabilityId: result.data.capabilityId, version: result.data.version, toolNames: Object.freeze([...result.data.toolNames]), contentDigest: result.data.contentDigest });
          }
          const failure = capabilityVerificationErrorSchema.safeParse(value);
          finish(new Error(failure.success && failure.data.requestId === requestId ? "Capability executable verification failed" : "Capability verifier returned malformed output"));
        });
        child.postMessage({ type: "capability.verify", requestId, packageRoot: inspected.staged.packageRoot, entry: inspected.packageMetadata.entry, expectedContentDigest: inspected.staged.contentDigest, expectedDescriptor: inspected.descriptor });
      } catch { finish(new Error("Capability verifier setup failed")); }
    });
  }
}
function adapt(child: UtilityProcess): CapabilityVerifierUtilityProcess { return { postMessage: message => child.postMessage(message), onMessage: listener => child.on("message", listener), onExit: listener => child.on("exit", listener), kill: () => child.kill() }; }
export function createElectronCapabilityPackageVerifier(): CapabilityPackageVerifier { return new DisposableCapabilityPackageVerifier({ launch: requestId => adapt(utilityProcess.fork(path.join(__dirname, "capability-package-verifier.js"), [], { serviceName: `Agentic Worktrees Capability Verifier ${requestId}`, stdio: "pipe" })) }); }
