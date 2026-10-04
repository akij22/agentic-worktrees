import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createStatefulLocalDistributionService, runDeterministicLocalWebSearchSmoke, runLocalWebSearchLifecycle, withPackedWorkspace } from "./local-lifecycle.mjs";

async function fixture(directory: string, name: string, version: string, verified = true) {
  const path = join(directory, name);
  await writeFile(path, JSON.stringify({ id: "agentic-worktrees.web-search", version, verified }));
  return path;
}

async function createHarness(output = {}) {
  const directory = await mkdtemp(join(tmpdir(), "aw-lifecycle-test-"));
  return {
    directory,
    cleanup: () => rm(directory, { recursive: true, force: true }),
    service: createStatefulLocalDistributionService(directory, output),
    fixtures: {
      v010: await fixture(directory, "v010.tgz", "0.1.0"),
      v011: await fixture(directory, "v011.tgz", "0.1.1"),
      failedVerifier: await fixture(directory, "invalid.tgz", "9.9.9", false),
      settings: { providerMode: "auto", resultLimit: 5 },
      secretReferences: { exaApiKey: "vault:smoke-secret" },
      managedPath: "/private/managed/path", query: "private query", fetchedContent: "private result",
    },
  };
}

describe("local Web Search package lifecycle", () => {
  it("packs into an owned temporary directory and removes the tarball afterward", async () => {
    let tarball = "";
    await withPackedWorkspace("@agentic-worktrees/web-search", async (path: string) => { tarball = path; await expect(access(path)).resolves.toBeUndefined(); });
    await expect(access(tarball)).rejects.toThrow();
  }, 30_000);

  it("executes the complete lifecycle against independent disk-backed state and cleans its layout", async () => {
    const harness = await createHarness();
    try {
      await runLocalWebSearchLifecycle(harness.service, harness.fixtures);
      await expect(harness.service.get()).resolves.toMatchObject({ version: "0.1.0", state: "installed" });
    } finally {
      await harness.cleanup();
    }
    await expect(access(harness.directory)).rejects.toThrow();
  });

  it("cleans its temporary layout even after a lifecycle assertion failure", async () => {
    const harness = await createHarness();
    harness.service.update = async () => undefined;
    try {
      await expect(runLocalWebSearchLifecycle(harness.service, harness.fixtures)).rejects.toThrow("Update did not preserve settings");
    } finally {
      await harness.cleanup();
    }
    await expect(access(harness.directory)).rejects.toThrow();
  });

  it("fails when a broken verifier artifact mutates installed state", async () => {
    const harness = await createHarness();
    try {
      harness.service.expectUpdateFailure = async (path: string) => {
        await writeFile(path, JSON.stringify({ id: "agentic-worktrees.web-search", version: "9.9.9", verified: true }));
        await harness.service.update(path);
      };
      await expect(runLocalWebSearchLifecycle(harness.service, harness.fixtures)).rejects.toThrow("Failed verification changed");
    } finally {
      await harness.cleanup();
    }
  });

  it.each([
    ["managed path", "/private/managed/path"],
    ["secret reference", "vault:smoke-secret"],
    ["query", "private query"],
    ["fetched content", "private result"],
  ])("rejects a renderer payload leaking the forbidden %s", async (_label, leaked) => {
    const harness = await createHarness({ rendererPayload: () => JSON.stringify({ leaked }) });
    try {
      await expect(runLocalWebSearchLifecycle(harness.service, harness.fixtures)).rejects.toThrow("Sensitive capability data escaped");
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects injected leaking logs and accepts independently supplied safe output", async () => {
    const leaking = await createHarness({ logs: () => "token vault:smoke-secret" });
    try {
      await expect(runLocalWebSearchLifecycle(leaking.service, leaking.fixtures)).rejects.toThrow("Sensitive capability data escaped");
    } finally { await leaking.cleanup(); }

    const safe = await createHarness({ rendererPayload: () => '{"state":"installed"}', logs: () => "lifecycle complete" });
    try {
      await expect(runLocalWebSearchLifecycle(safe.service, safe.fixtures)).resolves.toBeUndefined();
    } finally { await safe.cleanup(); }
  });

  it("runs as a standalone deterministic smoke", async () => {
    await expect(runDeterministicLocalWebSearchSmoke()).resolves.toEqual({ passed: true });
  });
});
