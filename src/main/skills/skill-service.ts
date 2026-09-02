import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type {
  SkillDetailDto,
  SkillInvocationRequest,
  SkillSummaryDto,
} from "../../shared/skills/schemas";
import {
  type SkillStorageLayout,
  stageSkillInstallation,
  removeInstalledSkill,
} from "./skill-installer";
import {
  SkillRepository,
  type SkillInstallationRecord,
} from "./skill-repository";

export type SkillErrorCode =
  | "skill_not_installed"
  | "skill_invalid"
  | "skill_incompatible"
  | "skill_sync_failed"
  | "skill_invocation_failed"
  | "skill_version_changed";
export class SkillError extends Error {
  constructor(
    readonly code: SkillErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SkillError";
  }
}
export interface ResolvedSkill {
  id: string;
  name: string;
  version: string;
  path: string;
  arguments?: string;
}
export interface SkillRuntimeBridge {
  syncCatalog(
    input: {
      activeRoot: string;
      skills: Array<{ id: string; automaticInvocation: boolean }>;
    } | null,
  ): Promise<void>;
  invoke(
    runId: string,
    skill: ResolvedSkill,
    argumentsValue?: string,
    reasoningVariant?: string,
  ): Promise<void>;
  getAgentKind(
    runId: string,
  ):
    | Promise<"codex" | "opencode" | undefined>
    | "codex"
    | "opencode"
    | undefined;
}
export interface SkillServiceDependencies {
  repository?: SkillRepository;
  layout: SkillStorageLayout;
  runtime: SkillRuntimeBridge;
  log?: (message: string, error?: unknown) => void;
}
function persisted(
  record: SkillInstallationRecord,
): Omit<SkillInstallationRecord, "createdAt" | "updatedAt"> {
  return {
    skillId: record.skillId,
    version: record.version,
    sourceKind: record.sourceKind,
    sourceRef: record.sourceRef,
    contentDigest: record.contentDigest,
    name: record.name,
    description: record.description,
    ...(record.license ? { license: record.license } : {}),
    codexCompatibility: record.codexCompatibility,
    opencodeCompatibility: record.opencodeCompatibility,
    automaticInvocation: record.automaticInvocation,
    state: record.state,
    ...(record.errorCode ? { errorCode: record.errorCode } : {}),
  };
}
function summary(record: SkillInstallationRecord): SkillSummaryDto {
  return {
    id: record.skillId,
    name: record.name,
    description: record.description,
    version: record.version,
    source: record.sourceKind,
    compatibility: {
      codex: record.codexCompatibility,
      opencode: record.opencodeCompatibility,
    },
    installationState: record.state,
    automaticInvocation: record.automaticInvocation,
  };
}
export interface SkillChangedEvent {
  skillId: string;
  kind: "installed" | "removed" | "changed";
  timestamp: string;
}
export const MAX_SKILL_INSTRUCTION_PREVIEW_LENGTH = 20_000;

function instructionBody(content: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content);
  const body = match ? content.slice(match[0].length) : content;
  const sanitized = Array.from(body)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return !(
        code <= 0x08 ||
        (code >= 0x0b && code <= 0x0c) ||
        (code >= 0x0e && code <= 0x1f) ||
        code === 0x7f
      );
    })
    .join("");
  return sanitized.slice(0, MAX_SKILL_INSTRUCTION_PREVIEW_LENGTH);
}

export class SkillService {
  private readonly repository: SkillRepository;
  private readonly listeners = new Set<(event: SkillChangedEvent) => void>();
  constructor(private readonly dependencies: SkillServiceDependencies) {
    this.repository = dependencies.repository ?? new SkillRepository();
  }
  listSkills(): SkillSummaryDto[] {
    return this.repository.listInstallations().map(summary);
  }
  getSkill(skillId: string): SkillDetailDto | undefined {
    const record = this.repository.getInstallation(skillId);
    if (!record) return undefined;
    const packageRoot = resolve(this.dependencies.layout.packagesRoot);
    const skillPath = resolve(
      packageRoot,
      record.skillId,
      record.version,
      "SKILL.md",
    );
    if (!skillPath.startsWith(`${packageRoot}${sep}`))
      throw new SkillError(
        "skill_invalid",
        "The installed skill package is invalid.",
      );
    try {
      const descriptor = openSync(
        skillPath,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      let content: string;
      try {
        const stat = fstatSync(descriptor);
        if (!stat.isFile() || stat.nlink > 1)
          throw new Error("unsafe managed skill file");
        content = readFileSync(descriptor, "utf8");
      } finally {
        closeSync(descriptor);
      }
      return {
        ...summary(record),
        license: record.license ?? null,
        origin: record.sourceKind === "local" ? "Local import" : "Bundled",
        contentDigest: record.contentDigest,
        reviewState: "unreviewed",
        instructionPreview: instructionBody(content),
      };
    } catch (error) {
      this.dependencies.log?.(
        "Managed skill preview could not be read.",
        error,
      );
      throw new SkillError(
        "skill_invalid",
        "The installed skill package could not be read.",
      );
    }
  }
  async installFromDirectory(sourceDirectory: string): Promise<SkillDetailDto> {
    const transaction = await stageSkillInstallation({
      sourceDirectory,
      managedRoot: this.dependencies.layout,
    });
    const validated = transaction.validated;
    const previous = this.repository.getInstallation(validated.descriptor.id);
    await transaction.commit();
    const next = {
      skillId: validated.descriptor.id,
      version: validated.descriptor.version,
      sourceKind: "local" as const,
      sourceRef: "local-import",
      contentDigest: validated.contentDigest,
      name: validated.descriptor.name,
      description: validated.descriptor.description,
      ...(validated.descriptor.license
        ? { license: validated.descriptor.license }
        : {}),
      codexCompatibility: "supported" as const,
      opencodeCompatibility: "supported" as const,
      automaticInvocation: validated.descriptor.automaticInvocation,
      state: "pending_verification" as const,
    };
    let persistedNew = false;
    try {
      this.repository.saveInstallation(next);
      persistedNew = true;
      await this.synchronize();
      this.repository.setInstallationState(
        validated.descriptor.id,
        "installed",
      );
    } catch (error) {
      await transaction.rollback({ keepPackage: true });
      if (previous) this.repository.saveInstallation(persisted(previous));
      else if (persistedNew)
        this.repository.setInstallationState(
          validated.descriptor.id,
          "invalid",
          "skill_sync_failed",
        );
      else this.repository.removeInstallation(validated.descriptor.id);
      try {
        await this.synchronize();
      } catch (compensationError) {
        this.dependencies.log?.(
          "Skill catalog compensation failed.",
          compensationError,
        );
      }
      this.dependencies.log?.("Skill catalog synchronization failed.", error);
      throw new SkillError(
        "skill_sync_failed",
        "The skill could not be verified with configured coding agents.",
      );
    }
    try {
      await transaction.finalize();
    } catch (error) {
      this.dependencies.log?.("Skill staging cleanup failed.", error);
    }
    const detail = this.getSkill(validated.descriptor.id);
    if (!detail)
      throw new SkillError(
        "skill_invalid",
        "The installed skill could not be loaded.",
      );
    this.emit(validated.descriptor.id, "installed");
    return detail;
  }
  async removeSkill(skillId: string): Promise<void> {
    const record = this.repository.getInstallation(skillId);
    if (!record)
      throw new SkillError(
        "skill_not_installed",
        "The skill is not installed.",
      );
    const active = join(this.dependencies.layout.activeRoot, skillId),
      backup = join(
        this.dependencies.layout.stagingRoot,
        `remove-${randomUUID()}`,
        skillId,
      );
    await mkdir(join(backup, ".."), { recursive: true });
    try {
      await rename(active, backup);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.repository.removeInstallation(skillId);
    try {
      await this.synchronize();
      await removeInstalledSkill({
        managedRoot: this.dependencies.layout,
        skillId,
        version: record.version,
      });
      await rm(join(backup, ".."), { recursive: true, force: true });
      this.emit(skillId, "removed");
    } catch (error) {
      this.repository.saveInstallation(persisted(record));
      try {
        await rename(backup, active);
      } catch (restoreError) {
        this.dependencies.log?.(
          "Skill storage compensation failed.",
          restoreError,
        );
      }
      try {
        await this.synchronize();
      } catch (compensationError) {
        this.dependencies.log?.(
          "Skill catalog compensation failed.",
          compensationError,
        );
      }
      throw new SkillError(
        "skill_sync_failed",
        "The skill catalog could not be updated.",
      );
    }
  }
  subscribeToSkillEvents(
    listener: (event: SkillChangedEvent) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async reconcileSkills(): Promise<void> {
    await this.synchronize();
  }
  async invokeSkill(
    input: SkillInvocationRequest & {
      runId: string;
      reasoningVariant?: string;
    },
  ): Promise<void> {
    const record = this.repository.getInstallation(input.skillId);
    if (!record)
      throw new SkillError(
        "skill_not_installed",
        "The skill is not installed.",
      );
    if (record.version !== input.version)
      throw new SkillError(
        "skill_version_changed",
        "The installed skill version changed. Select it again.",
      );
    if (record.state !== "installed")
      throw new SkillError("skill_invalid", "The skill is not available.");
    const kind = await this.dependencies.runtime.getAgentKind(input.runId);
    if (
      !kind ||
      (kind === "codex"
        ? record.codexCompatibility
        : record.opencodeCompatibility) !== "supported"
    )
      throw new SkillError(
        "skill_incompatible",
        "The skill is incompatible with this coding agent.",
      );
    const invocation = this.repository.startInvocation({
      runId: input.runId,
      skillId: record.skillId,
      version: record.version,
      mode: "explicit",
    });
    try {
      await this.dependencies.runtime.invoke(
        input.runId,
        {
          id: record.skillId,
          name: record.name,
          version: record.version,
          path: join(
            this.dependencies.layout.activeRoot,
            record.skillId,
            "SKILL.md",
          ),
          ...(input.arguments ? { arguments: input.arguments } : {}),
        },
        input.arguments,
        input.reasoningVariant,
      );
      this.repository.transitionInvocation(invocation.id, "loaded");
    } catch (error) {
      this.repository.transitionInvocation(
        invocation.id,
        "failed",
        "skill_invocation_failed",
      );
      this.dependencies.log?.("Native skill invocation failed.", error);
      throw new SkillError(
        "skill_invocation_failed",
        "The skill could not be invoked.",
      );
    }
  }
  listRunInvocations(runId: string) {
    return this.repository.listRunInvocations(runId);
  }
  private emit(skillId: string, kind: SkillChangedEvent["kind"]) {
    const event = { skillId, kind, timestamp: new Date().toISOString() };
    for (const listener of this.listeners) listener(event);
  }
  private async synchronize() {
    const skills = this.repository
      .listInstallations()
      .filter((item) => item.state !== "invalid")
      .map((item) => ({
        id: item.skillId,
        automaticInvocation: item.automaticInvocation,
      }));
    await this.dependencies.runtime.syncCatalog(
      skills.length === 0
        ? null
        : {
            activeRoot: this.dependencies.layout.activeRoot,
            skills,
          },
    );
  }
}
