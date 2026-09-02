import BetterSqlite3 from "better-sqlite3";
import { mkdtemp, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapSchemaSql } from "../database/bootstrap";
import { createSkillStorageLayout } from "./skill-installer";
import { SkillRepository } from "./skill-repository";
import {
 MAX_SKILL_INSTRUCTION_PREVIEW_LENGTH,
 SkillError,
 SkillService,
 type SkillRuntimeBridge,
} from "./skill-service";
let db: BetterSqlite3.Database,
 repo: SkillRepository,
 root: string,
 runtime: SkillRuntimeBridge,
 service: SkillService;
async function source() {
 const path = join(root, "input", "security-review");
 await mkdir(path, { recursive: true });
 await writeFile(
  join(path, "SKILL.md"),
  "---\nname: security-review\ndescription: Review\n---\nWorkflow",
 );
 return path;
}
const record = (state = "installed" as const) => ({
 skillId: "security-review",
 version: "1",
 sourceKind: "local" as const,
 sourceRef: "local",
 contentDigest: `sha256:${"a".repeat(64)}`,
 name: "security-review",
 description: "Review",
 codexCompatibility: "supported" as const,
 opencodeCompatibility: "supported" as const,
 automaticInvocation: true,
 state,
});
beforeEach(async () => {
 db = new BetterSqlite3(":memory:");
 db.exec(bootstrapSchemaSql);
 db.pragma("foreign_keys=OFF");
 repo = new SkillRepository(db);
 root = await mkdtemp(join(tmpdir(), "aw-service-"));
 runtime = {
  syncCatalog: vi.fn(async () => undefined),
  invoke: vi.fn(async () => undefined),
  getAgentKind: vi.fn(async () => "codex" as const),
 };
 service = new SkillService({
  repository: repo,
  layout: createSkillStorageLayout(root),
  runtime,
 });
});
afterEach(() => db.close());
describe("SkillService", () => {
 it("installs, synchronizes, and marks installed", async () => {
  const detail = await service.installFromDirectory(await source());
  expect(detail.installationState).toBe("installed");
  expect(runtime.syncCatalog).toHaveBeenCalled();
 });
 it("returns a bounded instruction preview without frontmatter or managed paths", async () => {
  const path = await source();
  const body = `# Workflow\n${"review safely ".repeat(2_000)}`;
  await writeFile(
   join(path, "SKILL.md"),
   `---\nname: security-review\ndescription: Review\nmetadata:\n  owner: local\n---\n${body}`,
  );
  const detail = await service.installFromDirectory(path);
  expect(detail.instructionPreview).toBe(
   body.slice(0, MAX_SKILL_INSTRUCTION_PREVIEW_LENGTH),
  );
  expect(detail.instructionPreview).not.toContain("name: security-review");
  expect(detail.instructionPreview).not.toContain(root);
 });
 it("marks invalid and retains canonical package on sync failure", async () => {
  vi.mocked(runtime.syncCatalog).mockRejectedValueOnce(new Error("no"));
  await expect(
   service.installFromDirectory(await source()),
  ).rejects.toMatchObject({ code: "skill_sync_failed" });
  const saved = repo.getInstallation("security-review");
  expect(saved?.state).toBe("invalid");
  await expect(
   access(
    join(
     root,
     "skills",
     "packages",
     "security-review",
     saved?.version ?? "missing",
     "SKILL.md",
    ),
   ),
  ).resolves.toBeUndefined();
 });
 it("rejects stale version before delegation", async () => {
  repo.saveInstallation(record());
  await expect(
   service.invokeSkill({
    runId: "r",
    skillId: "security-review",
    version: "0",
   }),
  ).rejects.toMatchObject({ code: "skill_version_changed" });
  expect(runtime.invoke).not.toHaveBeenCalled();
 });
 it("rejects incompatible agents", async () => {
  repo.saveInstallation({ ...record(), codexCompatibility: "unsupported" });
  await expect(
   service.invokeSkill({
    runId: "r",
    skillId: "security-review",
    version: "1",
   }),
  ).rejects.toMatchObject({ code: "skill_incompatible" });
 });
 it("transitions successful invocation to loaded", async () => {
  repo.saveInstallation(record());
  await service.invokeSkill({
   runId: "r",
   skillId: "security-review",
   version: "1",
   arguments: "review",
  });
  expect(service.listRunInvocations("r")[0]?.status).toBe("loaded");
 });
 it("records native invocation failures safely", async () => {
  repo.saveInstallation(record());
  vi
   .mocked(runtime.invoke)
   .mockRejectedValueOnce(new Error("provider path /secret"));
  await expect(
   service.invokeSkill({
    runId: "r",
    skillId: "security-review",
    version: "1",
   }),
  ).rejects.toBeInstanceOf(SkillError);
  expect(service.listRunInvocations("r")[0]).toMatchObject({
   status: "failed",
   errorCode: "skill_invocation_failed",
  });
 });
 it("restores the previous database, projection, and provider catalog after update sync failure", async () => {
  const path = await source();
  const first = await service.installFromDirectory(path);
  await writeFile(
   join(path, "SKILL.md"),
   "---\nname: security-review\ndescription: Updated review\n---\nNew workflow",
  );
  vi.mocked(runtime.syncCatalog).mockRejectedValueOnce(new Error("sync"));
  await expect(service.installFromDirectory(path)).rejects.toMatchObject({
   code: "skill_sync_failed",
  });
  expect(repo.getInstallation("security-review")?.version).toBe(first.version);
  expect(
   await readFile(
    join(root, "skills", "active", "security-review", "SKILL.md"),
    "utf8",
   ),
  ).toContain("Workflow");
  expect(runtime.syncCatalog).toHaveBeenCalledTimes(3);
 });
 it("clears the provider catalog when removing the last skill", async () => {
  const path = await source();
  await service.installFromDirectory(path);
  await service.removeSkill("security-review");
  expect(runtime.syncCatalog).toHaveBeenLastCalledWith(null);
  expect(repo.getInstallation("security-review")).toBeUndefined();
 });
 it("restores removal state and resynchronizes after provider failure", async () => {
  const path = await source();
  await service.installFromDirectory(path);
  vi.mocked(runtime.syncCatalog).mockRejectedValueOnce(new Error("sync"));
  await expect(service.removeSkill("security-review")).rejects.toMatchObject({
   code: "skill_sync_failed",
  });
  expect(repo.getInstallation("security-review")?.state).toBe("installed");
  expect(
   await readFile(
    join(root, "skills", "active", "security-review", "SKILL.md"),
    "utf8",
   ),
  ).toContain("Workflow");
  expect(runtime.syncCatalog).toHaveBeenCalledTimes(3);
 });
});
