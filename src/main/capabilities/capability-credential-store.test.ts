import { describe, expect, it, vi } from "vitest";
import { CapabilityCredentialStore, type CapabilityCredentialStoreDependencies } from "./capability-credential-store";

function dependencies(overrides: Partial<CapabilityCredentialStoreDependencies> = {}) {
  let encrypted: Buffer | undefined;
  const deps: CapabilityCredentialStoreDependencies = {
    credentialPath: "/vault", isEncryptionAvailable: vi.fn().mockResolvedValue(true),
    encrypt: vi.fn(async (value) => Buffer.from(value)), decrypt: vi.fn(async (value) => value.toString()),
    readFile: vi.fn(async () => { if (!encrypted) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return encrypted; }),
    writeFile: vi.fn(async (_path, data) => { encrypted = data; }), rename: vi.fn(), unlink: vi.fn(async () => { encrypted = undefined; }), logError: vi.fn(),
    ...overrides,
  };
  return deps;
}

describe("CapabilityCredentialStore", () => {
  it("uses opaque references and atomically replaces encrypted data", async () => {
    const deps = dependencies();
    const store = new CapabilityCredentialStore(deps);
    const reference = await store.setSecret("agentic-worktrees.web-search", "exaApiKey", "exa-secret-value");
    expect(reference).not.toContain("exa-secret-value");
    expect(await store.getSecret(reference)).toBe("exa-secret-value");
    expect(deps.writeFile).toHaveBeenCalledWith("/vault.tmp", expect.any(Buffer), { mode: 0o600 });
    expect(deps.rename).toHaveBeenCalledWith("/vault.tmp", "/vault");
    await store.removeSecret(reference);
    expect(await store.getSecret(reference)).toBeUndefined();
  });

  it("retains secrets in memory when encryption is unavailable", async () => {
    const store = new CapabilityCredentialStore(dependencies({ isEncryptionAvailable: vi.fn().mockResolvedValue(false) }));
    const reference = await store.setSecret("cap", "key", "value");
    expect(await store.getSecret(reference)).toBe("value");
  });

  it("removes corrupt ciphertext and never logs loaded or new secret values", async () => {
    const logError = vi.fn();
    const store = new CapabilityCredentialStore(dependencies({
      readFile: vi.fn().mockResolvedValue(Buffer.from("encrypted")),
      decrypt: vi.fn().mockResolvedValue('{"version":1,"secrets":{"x":{"capabilityId":"cap","settingKey":"key","value":"old-secret"}}}'),
      encrypt: vi.fn().mockRejectedValue(new Error("failed new-secret and old-secret")),
      logError,
    }));
    await expect(store.setSecret("cap", "key", "new-secret")).rejects.toMatchObject({ code: "internal_error" });
    expect(JSON.stringify(logError.mock.calls)).not.toContain("new-secret");
    expect(JSON.stringify(logError.mock.calls)).not.toContain("old-secret");
  });
});
