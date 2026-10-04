import { verify, type KeyLike } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateCapabilityStaticDescriptor, type CapabilityStaticDescriptor } from "@agentic-worktrees/capability-sdk";
import { packageNameSchema } from "../../../shared/packages/schemas";
import fallbackJson from "./official-catalog.fallback.json";

export interface OfficialCatalogEntry { capabilityId: string; packageName: string; releaseSpec: string; publisher: string; minimumAppVersion: string; blockedVersions: readonly string[]; descriptor: CapabilityStaticDescriptor; releaseNotes: string; updatedAt: string }
export interface OfficialCatalogSnapshot { schemaVersion: 1; sequence: number; issuedAt: string; expiresAt: string; entries: readonly OfficialCatalogEntry[] }
export interface SignedCatalogEnvelope { algorithm: "Ed25519"; keyId: string; payload: string; signature: string }
export interface LoadedOfficialCatalog { source: "remote" | "cache" | "fallback"; snapshot: OfficialCatalogSnapshot; warningCode?: "catalog_unavailable" | "catalog_signature_invalid" | "catalog_expired" }

const ENDPOINT = "https://raw.githubusercontent.com/akij22/Agentic-Worktrees/main/catalog/official-capabilities.envelope.json";
const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 5_000;
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => key in value);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const ISO_UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const iso = (value: unknown) => typeof value === "string" && ISO_UTC_MILLIS.test(value) && new Date(value).toISOString() === value;
const text = (value: unknown) => typeof value === "string" && value.length > 0;

function parseSnapshot(value: unknown, now: Date, enforceExpiry = true): OfficialCatalogSnapshot {
  if (!record(value) || !exactKeys(value, ["schemaVersion", "sequence", "issuedAt", "expiresAt", "entries"]) || value.schemaVersion !== 1 || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0 || !iso(value.issuedAt) || !iso(value.expiresAt) || !Array.isArray(value.entries)) throw new Error("invalid_catalog");
  if (Date.parse(value.issuedAt as string) > now.getTime() || Date.parse(value.expiresAt as string) <= Date.parse(value.issuedAt as string)) throw new Error("invalid_catalog");
  if (enforceExpiry && Date.parse(value.expiresAt as string) <= now.getTime()) throw new Error("catalog_expired");
  const seen = new Set<string>();
  const entries = value.entries.map((candidate): OfficialCatalogEntry => {
    const keys = ["capabilityId", "packageName", "releaseSpec", "publisher", "minimumAppVersion", "blockedVersions", "descriptor", "releaseNotes", "updatedAt"];
    if (!record(candidate) || !exactKeys(candidate, keys) || !text(candidate.capabilityId) || !text(candidate.packageName) || !text(candidate.releaseSpec) || !text(candidate.publisher) || !text(candidate.minimumAppVersion) || !Array.isArray(candidate.blockedVersions) || !candidate.blockedVersions.every(text) || typeof candidate.releaseNotes !== "string" || !iso(candidate.updatedAt)) throw new Error("invalid_catalog");
    if (Date.parse(candidate.updatedAt as string) > now.getTime() || new Set(candidate.blockedVersions).size !== candidate.blockedVersions.length) throw new Error("invalid_catalog");
    const capabilityId = candidate.capabilityId as string, packageName = candidate.packageName as string, releaseSpec = candidate.releaseSpec as string;
    packageNameSchema.parse(packageName);
    const descriptor = validateCapabilityStaticDescriptor(candidate.descriptor);
    const expectedPackageName = `@agentic-worktrees/${capabilityId.replace(/^agentic-worktrees\./, "")}`;
    if (seen.has(capabilityId) || descriptor.manifest.id !== capabilityId || descriptor.manifest.version !== releaseSpec || packageName !== expectedPackageName || candidate.blockedVersions.includes(releaseSpec)) throw new Error("invalid_catalog");
    seen.add(capabilityId);
    return { ...candidate, descriptor } as OfficialCatalogEntry;
  });
  return { schemaVersion: 1, sequence: value.sequence as number, issuedAt: value.issuedAt as string, expiresAt: value.expiresAt as string, entries };
}
function decode(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid_encoding");
  const result = Buffer.from(value, "base64url");
  if (result.toString("base64url") !== value) throw new Error("invalid_encoding");
  return result;
}
async function boundedResponse(response: Response): Promise<string> {
  if (!response.ok) throw new Error("catalog_unavailable");
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BYTES) throw new Error("catalog_unavailable");
  if (!response.body) { const text = await response.text(); if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("catalog_unavailable"); return text; }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BYTES) { await reader.cancel(); throw new Error("catalog_unavailable"); } chunks.push(value); }
  return Buffer.concat(chunks).toString("utf8");
}

export interface OfficialCatalogServiceOptions { fetchImpl?: typeof fetch; now?: () => Date; endpoint?: string; publicKeys?: Readonly<Record<string, KeyLike>>; storageRoot?: string }
export class OfficialCatalogService {
  private readonly options: Required<Omit<OfficialCatalogServiceOptions, "publicKeys">> & { publicKeys: Readonly<Record<string, KeyLike>> };
  private memory?: LoadedOfficialCatalog;
  private commitTail: Promise<void> = Promise.resolve();
  constructor(options: OfficialCatalogServiceOptions = {}) { this.options = { fetchImpl: options.fetchImpl ?? fetch, now: options.now ?? (() => new Date()), endpoint: options.endpoint ?? ENDPOINT, publicKeys: options.publicKeys ?? {}, storageRoot: options.storageRoot ?? join(process.cwd(), ".agentic-worktrees") }; }
  private cachePath() { return join(this.options.storageRoot, "cache", "official-capabilities.envelope.json"); }
  private verifyEnvelope(value: unknown): OfficialCatalogSnapshot {
    if (!record(value) || !exactKeys(value, ["algorithm", "keyId", "payload", "signature"]) || value.algorithm !== "Ed25519" || !text(value.keyId) || !text(value.payload) || !text(value.signature)) throw new Error("catalog_signature_invalid");
    const key = this.options.publicKeys[value.keyId as string]; if (!key) throw new Error("catalog_signature_invalid");
    const payload = decode(value.payload as string), signature = decode(value.signature as string);
    if (!verify(null, payload, key, signature)) throw new Error("catalog_signature_invalid");
    try { return parseSnapshot(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)), this.options.now()); }
    catch (error) { if (error instanceof Error && error.message === "catalog_expired") throw error; throw new Error("invalid_catalog"); }
  }
  private async cache(envelope: unknown) { const path = this.cachePath(), temp = `${path}.${process.pid}.tmp`; await mkdir(join(this.options.storageRoot, "cache"), { recursive: true, mode: 0o700 }); await writeFile(temp, JSON.stringify(envelope), { mode: 0o600 }); await rename(temp, path); }
  private async loadCache(): Promise<LoadedOfficialCatalog | undefined> { try { const envelope = JSON.parse(await readFile(this.cachePath(), "utf8")); return { source: "cache", snapshot: this.verifyEnvelope(envelope) }; } catch { return undefined; } }
  private commit(envelope: unknown, snapshot: OfficialCatalogSnapshot): Promise<LoadedOfficialCatalog> {
    const operation = this.commitTail.then(async () => {
      const cached = await this.loadCache();
      const latestSequence = Math.max(cached?.snapshot.sequence ?? -1, this.memory?.snapshot.sequence ?? -1);
      if (snapshot.sequence < latestSequence) throw new Error("catalog_signature_invalid");
      await this.cache(envelope); this.memory = { source: "remote", snapshot }; return this.memory;
    });
    this.commitTail = operation.then(() => undefined, () => undefined);
    return operation;
  }
  async load(options: { refresh?: boolean } = {}): Promise<LoadedOfficialCatalog> {
    if (!options.refresh && this.memory) return this.memory;
    let warning: LoadedOfficialCatalog["warningCode"] = "catalog_unavailable";
    try {
      const controller = new AbortController(); let timeout: ReturnType<typeof setTimeout>; let active = true;
      const attempt = (async () => { const response = await this.options.fetchImpl(this.options.endpoint, { signal: controller.signal }); const envelope: unknown = JSON.parse(await boundedResponse(response)); return { envelope, snapshot: this.verifyEnvelope(envelope) }; })();
      const deadline = new Promise<never>((_, reject) => { timeout = setTimeout(() => { active = false; controller.abort(); reject(new Error("catalog_unavailable")); }, TIMEOUT_MS); });
      try { const candidate = await Promise.race([attempt, deadline]); if (!active) throw new Error("catalog_unavailable"); return await this.commit(candidate.envelope, candidate.snapshot); } finally { active = false; clearTimeout(timeout!); }
    } catch (error) { warning = error instanceof Error && error.message === "catalog_expired" ? "catalog_expired" : error instanceof Error && ["catalog_signature_invalid", "invalid_catalog", "invalid_encoding"].includes(error.message) ? "catalog_signature_invalid" : "catalog_unavailable"; }
    const cached = await this.loadCache(); if (cached) return this.memory = { ...cached, warningCode: warning };
    return this.memory = { source: "fallback", snapshot: parseSnapshot(fallbackJson, this.options.now(), false), warningCode: warning };
  }
  async findCapability(capabilityId: string) { return (await this.load()).snapshot.entries.find(entry => entry.capabilityId === capabilityId); }
}
