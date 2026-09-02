import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { skillIdSchema } from "../../shared/skills/schemas";
import { parseDocument } from "yaml";
import { validateSkillPackage, type ValidatedSkillPackage } from "./skill-validation";

export interface SkillStorageLayout { root: string; packagesRoot: string; activeRoot: string; stagingRoot: string }
export function createSkillStorageLayout(userDataPath: string): SkillStorageLayout {
  const root = join(userDataPath, "skills");
  return { root, packagesRoot: join(root, "packages"), activeRoot: join(root, "active"), stagingRoot: join(root, ".staging") };
}

export interface InstalledSkillPaths { packagePath: string; activePath: string; validated: ValidatedSkillPackage }
export interface SkillInstallTransaction {
  readonly validated: ValidatedSkillPackage;
  commit(): Promise<InstalledSkillPaths>;
  finalize(): Promise<void>;
  rollback(options?:{keepPackage?:boolean}): Promise<void>;
}

const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/;
function safeVersion(version: string): string {
  if (!versionPattern.test(version) || version === "." || version === "..") throw new Error("Invalid skill storage version.");
  return version;
}
function contained(root: string, candidate: string): string {
  const normalizedRoot = resolve(root), normalized = resolve(candidate);
  if (normalized !== normalizedRoot && !normalized.startsWith(`${normalizedRoot}${sep}`)) throw new Error("Skill storage path escapes its managed root.");
  return normalized;
}
async function canonicalMatches(packagePath: string, validated: ValidatedSkillPackage): Promise<boolean> {
  try {
    return (await Promise.all(validated.files.map(async (file) => (await readFile(join(packagePath, file.relativePath))).equals(file.bytes)))).every(Boolean);
  } catch { return false; }
}

async function writeExclusive(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "wx", 0o600);
  try { await handle.writeFile(bytes); } finally { await handle.close(); }
}

function openCodeProjection(content: string): string {
  const match = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(content);
  if (!match) return content;
  const document = parseDocument(match[2], { uniqueKeys: true });
  document.setIn(["metadata", "opencode/autoinvoke"], false);
  return `${match[1]}${document.toString().trimEnd()}${match[3]}${content.slice(match[0].length)}`;
}

export async function stageSkillInstallation(input: {
  sourceDirectory: string;
  managedRoot: string | SkillStorageLayout;
  version?: string;
}): Promise<SkillInstallTransaction> {
  const layout = typeof input.managedRoot === "string"
    ? { root: input.managedRoot, packagesRoot: join(input.managedRoot, "packages"), activeRoot: join(input.managedRoot, "active"), stagingRoot: join(input.managedRoot, ".staging") }
    : input.managedRoot;
  const validated = await validateSkillPackage(input.sourceDirectory);
  skillIdSchema.parse(validated.descriptor.id);
  const version = safeVersion(input.version ?? validated.descriptor.version);
  contained(layout.root, layout.packagesRoot); contained(layout.root, layout.activeRoot); contained(layout.root, layout.stagingRoot);
  const token = randomUUID();
  const staging = join(layout.stagingRoot, token);
  const stagedPackage = join(staging, "package");
  const stagedActive = join(staging, "active");
  await mkdir(staging, { recursive: true });
  for (const file of validated.files) {
    await writeExclusive(join(stagedPackage, file.relativePath), file.bytes);
    const content = !validated.descriptor.automaticInvocation && file.relativePath === "SKILL.md"
      ? openCodeProjection(file.content) : file.content;
    await writeExclusive(join(stagedActive, file.relativePath), Buffer.from(content, "utf8"));
  }
  const packagePath = contained(layout.packagesRoot, join(layout.packagesRoot, validated.descriptor.id, version));
  const activePath = contained(layout.activeRoot, join(layout.activeRoot, validated.descriptor.id));
  const backupPath = contained(staging, join(staging, "previous-active"));
  let committed = false;
  let hadPrevious = false;
  let packagePublished = false;
  let finalized = false;
  return {
    validated,
    async commit() {
      if (committed) return { packagePath, activePath, validated };
      await mkdir(dirname(packagePath), { recursive: true });
      await mkdir(layout.activeRoot, { recursive: true });
      try {
        await rename(activePath, backupPath);
        hadPrevious = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      try {
        try {
          await rename(stagedPackage, packagePath);
          packagePublished = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST" && (error as NodeJS.ErrnoException).code !== "ENOTEMPTY") throw error;
          if (!(await canonicalMatches(packagePath, validated))) throw new Error("Skill package version collides with different canonical content.");
          await rm(stagedPackage, { recursive: true, force: true });
        }
        await rename(stagedActive, activePath);
      } catch (error) {
        await rm(activePath, { recursive: true, force: true });
        if (hadPrevious) await rename(backupPath, activePath);
        if (packagePublished) await rm(packagePath, { recursive: true, force: true });
        throw error;
      }
      committed = true;
      return { packagePath, activePath, validated };
    },
    async finalize() {
      if (finalized) return;
      await rm(backupPath, { recursive: true, force: true });
      await rm(staging, { recursive: true, force: true });
      finalized = true;
    },
    async rollback(options) {
      if (finalized) return;
      if (committed) {
        await rm(activePath, { recursive: true, force: true });
        if (hadPrevious) await rename(backupPath, activePath);
        if (packagePublished && !options?.keepPackage) await rm(packagePath, { recursive: true, force: true });
      }
      await rm(staging, { recursive: true, force: true });
      committed = false;
      finalized = true;
    },
  };
}

export async function removeInstalledSkill(input: { managedRoot: string | SkillStorageLayout; skillId: string; version?: string }): Promise<void> {
  const layout = typeof input.managedRoot === "string" ? createSkillStorageLayout(dirname(input.managedRoot)) : input.managedRoot;
  const skillId = skillIdSchema.parse(input.skillId);
  contained(layout.root, layout.activeRoot); contained(layout.root, layout.packagesRoot);
  await rm(contained(layout.activeRoot, join(layout.activeRoot, skillId)), { recursive: true, force: true });
  if (input.version) await rm(contained(layout.packagesRoot, join(layout.packagesRoot, skillId, safeVersion(input.version))), { recursive: true, force: true });
}
