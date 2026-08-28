import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { safeStorage } from "electron";
import { CapabilityError } from "@agentic-worktrees/capability-sdk";

interface CapabilityCredentialPayload {
  version: 1;
  secrets: Record<string, { capabilityId: string; settingKey: string; value: string }>;
}

export interface CapabilityCredentialStoreDependencies {
  credentialPath: string;
  isEncryptionAvailable(): Promise<boolean>;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<string>;
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: Buffer, options: { mode: number }): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
  unlink(path: string): Promise<unknown>;
  logError(message: string, cause: unknown): void;
}

interface SafeLogCause {
  name: string;
  message: string;
}

const emptyPayload = (): CapabilityCredentialPayload => ({ version: 1, secrets: {} });
const missing = (error: unknown): boolean => error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
function redact(cause: unknown, values: readonly string[]): SafeLogCause {
  const replace = (text: string) => values.filter(Boolean).reduce((safe, value) => safe.replaceAll(value, "[REDACTED]"), text);
  if (cause instanceof Error) return { name: cause.name, message: replace(cause.message) };
  if (typeof cause === "string") return { name: "Error", message: replace(cause) };
  return { name: "NonErrorCause", message: "A non-text credential storage error occurred." };
}
function isPayload(value: unknown): value is CapabilityCredentialPayload {
  if (!value || typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  if (object.version !== 1 || !object.secrets || typeof object.secrets !== "object") return false;
  return Object.values(object.secrets as Record<string, unknown>).every((secret) => {
    if (!secret || typeof secret !== "object") return false;
    const item = secret as Record<string, unknown>;
    return typeof item.capabilityId === "string" && typeof item.settingKey === "string" && typeof item.value === "string";
  });
}

export class CapabilityCredentialStore {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly dependencies: CapabilityCredentialStoreDependencies) {}

  async setSecret(capabilityId: string, settingKey: string, value: string): Promise<string> {
    if (!value) throw new CapabilityError("invalid_input", "Secret values cannot be empty.");
    if (!(await this.canPersist())) throw new CapabilityError("permission_denied", "Secure credential storage is unavailable.");
    const reference = `cap_${randomUUID()}`;
    await this.serial(async () => {
      const payload = await this.load();
      payload.secrets[reference] = { capabilityId, settingKey, value };
      await this.save(payload, [value, ...Object.values(payload.secrets).map((item) => item.value)]);
    });
    return reference;
  }

  async getSecret(reference: string): Promise<string | undefined> {
    return (await this.load()).secrets[reference]?.value;
  }

  async removeSecret(reference: string): Promise<void> {
    await this.serial(async () => {
      const payload = await this.load();
      const values = Object.values(payload.secrets).map((item) => item.value);
      delete payload.secrets[reference];
      await this.save(payload, values);
    });
  }

  private serial(operation: () => Promise<void>): Promise<void> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async canPersist(): Promise<boolean> {
    try { return await this.dependencies.isEncryptionAvailable(); }
    catch (error) {
      this.dependencies.logError("Capability credential encryption unavailable", error);
      return false;
    }
  }

  private async load(): Promise<CapabilityCredentialPayload> {
    if (!(await this.canPersist())) return emptyPayload();
    try {
      const decrypted = await this.dependencies.decrypt(await this.dependencies.readFile(this.dependencies.credentialPath));
      let parsed: unknown;
      try { parsed = JSON.parse(decrypted) as unknown; }
      catch { throw new Error("Stored capability credentials cannot be parsed"); }
      if (!isPayload(parsed)) throw new Error("Stored capability credentials are invalid");
      return parsed;
    } catch (error) {
      if (missing(error)) return emptyPayload();
      this.dependencies.logError("Failed to load capability credentials", error);
      try { await this.dependencies.unlink(this.dependencies.credentialPath); } catch (unlinkError) { if (!missing(unlinkError)) this.dependencies.logError("Failed to remove invalid capability credentials", unlinkError); }
      return emptyPayload();
    }
  }

  private async save(payload: CapabilityCredentialPayload, sensitiveValues: readonly string[]): Promise<void> {
    if (!(await this.canPersist())) throw new CapabilityError("permission_denied", "Secure credential storage is unavailable.");
    const temporaryPath = `${this.dependencies.credentialPath}.tmp`;
    try {
      const encrypted = await this.dependencies.encrypt(JSON.stringify(payload));
      await this.dependencies.writeFile(temporaryPath, encrypted, { mode: 0o600 });
      await this.dependencies.rename(temporaryPath, this.dependencies.credentialPath);
    } catch (error) {
      try { await this.dependencies.unlink(temporaryPath); } catch { /* best effort temp cleanup */ }
      this.dependencies.logError("Failed to save capability credentials", redact(error, sensitiveValues));
      throw new CapabilityError("internal_error", "Capability credentials could not be saved.");
    }
  }
}

export function createElectronCapabilityCredentialStore(credentialPath: string): CapabilityCredentialStore {
  return new CapabilityCredentialStore({
    credentialPath,
    isEncryptionAvailable: async () => process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"
      ? safeStorage.isAsyncEncryptionAvailable()
      : false,
    encrypt: (value) => safeStorage.encryptStringAsync(value),
    decrypt: async (value) => (await safeStorage.decryptStringAsync(value)).result,
    readFile, writeFile, rename, unlink,
    logError: (message, cause) => console.error(message, cause),
  });
}
