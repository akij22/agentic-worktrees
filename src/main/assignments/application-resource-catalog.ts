import { join } from "node:path";
import type Sqlite from "better-sqlite3";
import {
  resourceIdentitySchema,
  type ResourceIdentity,
  type ResourceAssignmentGeneration,
  type AssignmentProjectionDto,
} from "../../shared/assignments";
import type {
  CapabilityCatalog,
  CapabilityCatalogEntry,
} from "../capabilities/catalog";
import type { CapabilitySettingRecord } from "../capabilities/capability-repository";
import {
  DatabaseAssignmentMigrationCatalog,
  describeAssignmentSkill,
} from "./database-assignment-migration-catalog";
import type { ValidatedSkillPackage } from "../skills/skill-validation";
import { validateSkillPackage } from "../skills/skill-validation";
import { createSkillStorageLayout } from "../skills/skill-installer";
import type { AssignmentResourcePort } from "./worktree-resource-assignment-service";

/** Resolves only exact installed identities; provider launch receives bounded validated content in memory. */
export class ApplicationResourceCatalog implements AssignmentResourcePort {
  private readonly catalog: DatabaseAssignmentMigrationCatalog;
  private readonly stagedSkills = new Map<
    string,
    { identity: ResourceIdentity; validated: ValidatedSkillPackage }
  >();
  private readonly stagedCapabilities = new Map<
    string,
    {
      identity: ResourceIdentity;
      entry: CapabilityCatalogEntry;
      settings: readonly CapabilitySettingRecord[];
    }
  >();
  constructor(
    private readonly sqlite: Sqlite.Database,
    private readonly userDataPath: string,
    catalog?: DatabaseAssignmentMigrationCatalog,
    private readonly capabilities?: CapabilityCatalog,
  ) {
    this.catalog = catalog ?? new DatabaseAssignmentMigrationCatalog(sqlite);
  }
  list(agentKind: "codex" | "opencode"): AssignmentProjectionDto["resources"] {
    const skills = this.sqlite
      .prepare(
        `SELECT skill_id id,version,name,description,state,codex_compatibility codexCompatibility,opencode_compatibility opencodeCompatibility FROM skill_installations ORDER BY skill_id`,
      )
      .all() as Array<{
      id: string;
      version: string;
      name: string;
      description: string;
      state: string;
      codexCompatibility: string;
      opencodeCompatibility: string;
    }>;
    const rows: AssignmentProjectionDto["resources"] = skills.map((skill) => {
      const valid = ["installed", "update_available"].includes(skill.state);
      const compatible =
        (agentKind === "codex"
          ? skill.codexCompatibility
          : skill.opencodeCompatibility) === "supported";
      return {
        kind: "skill",
        id: skill.id,
        version: skill.version,
        name: skill.name,
        description: skill.description,
        desired: false,
        verified: false,
        operation: null,
        status: valid && compatible ? "installed" : "unavailable",
        assignable: valid && compatible,
        unavailableReason: !valid
          ? "installation_invalid"
          : !compatible
            ? "provider_incompatible"
            : null,
        automaticUsageReporting:
          agentKind === "opencode" ? "supported" : "unknown",
        skillIsolation: agentKind === "codex" ? "not_enforced" : "enforced",
      };
    });
    const capabilities = this.sqlite
      .prepare(
        "SELECT capability_id id,version,configured FROM capability_installations ORDER BY capability_id",
      )
      .all() as Array<{ id: string; version: string; configured: number }>;
    for (const capability of capabilities) {
      let entry;
      try {
        entry = this.capabilities?.get(capability.id, capability.version);
      } catch {
        entry = undefined;
      }
      const descriptor = this.catalog.resolve({
        resourceKind: "capability",
        resourceId: capability.id,
        version: capability.version,
      });
      const projection = descriptor?.providers.find(
        (provider) => provider.agentKind === agentKind,
      );
      const available = projection?.availability === "compatible";
      rows.push({
        kind: "capability",
        id: capability.id,
        version: capability.version,
        name: entry?.manifest.name ?? capability.id,
        description: entry?.manifest.description ?? "",
        desired: false,
        verified: false,
        operation: null,
        status: available ? "installed" : "unavailable",
        assignable: available,
        unavailableReason: available
          ? null
          : !capability.configured
            ? "setup_required"
            : projection
              ? "provider_incompatible"
              : "provider_unqualified",
        automaticUsageReporting: "supported",
        skillIsolation: "not_applicable",
      });
    }
    return rows;
  }
  async resolve(selection: {
    kind: "skill" | "capability";
    id: string;
    version: string;
  }): Promise<ResourceIdentity> {
    const staged =
      selection.kind === "skill"
        ? this.stagedSkills.get(selection.id)
        : undefined;
    if (staged?.identity.version === selection.version)
      return structuredClone(staged.identity);
    const capability =
      selection.kind === "capability"
        ? this.stagedCapabilities.get(selection.id)
        : undefined;
    if (capability?.identity.version === selection.version)
      return structuredClone(capability.identity);
    const descriptor = this.catalog.resolve({
      resourceKind: selection.kind,
      resourceId: selection.id,
      version: selection.version,
    });
    if (!descriptor)
      throw Object.assign(new Error("Resource is unavailable."), {
        code: "assignment_invalid_resource",
      });
    return resourceIdentitySchema.parse({
      kind: selection.kind,
      id: selection.id,
      version: selection.version,
      contentDigest: descriptor.contentDigest,
      securityDigest: descriptor.securityDigest,
      configurationDigest: descriptor.configurationDigest,
      invocationPolicyDigest: descriptor.invocationPolicyDigest,
      providerProjections: descriptor.providers,
    });
  }
  async prepare(generation: ResourceAssignmentGeneration): Promise<void> {
    for (const resource of generation.resources) {
      const current = await this.resolve(resource);
      if (JSON.stringify(current) !== JSON.stringify(resource))
        throw Object.assign(new Error("Resource identity changed."), {
          code: "resource_unavailable",
        });
      if (resource.kind === "skill") await this.loadSkill(resource);
    }
  }
  async loadSkill(resource: ResourceIdentity) {
    const parsed = resourceIdentitySchema.parse(resource);
    if (
      parsed.kind !== "skill" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parsed.id) ||
      !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(parsed.version)
    )
      throw new Error("Skill identity is invalid.");
    const staged = this.stagedSkills.get(parsed.id);
    const prepared =
      staged?.identity.version === parsed.version ? staged : undefined;
    const layout = createSkillStorageLayout(this.userDataPath);
    const validated =
      prepared?.validated ??
      (await validateSkillPackage(
        join(layout.packagesRoot, parsed.id, parsed.version),
        parsed.id,
      ));
    if (validated.contentDigest !== parsed.contentDigest)
      throw new Error("Skill content identity changed.");
    const row = this.sqlite
      .prepare(
        "SELECT automatic_invocation automaticInvocation FROM skill_installations WHERE skill_id=? AND version=?",
      )
      .get(parsed.id, parsed.version) as
      | { automaticInvocation: number }
      | undefined;
    if (!row && !prepared)
      throw new Error("Skill installation is unavailable.");
    return {
      name: parsed.id,
      identity: {
        resourceKind: "skill" as const,
        resourceId: parsed.id,
        resourceVersion: parsed.version,
        resourceDigest: parsed.contentDigest,
      },
      files: validated.files.map(({ relativePath, content }) => ({
        relativePath,
        content,
      })),
      automaticInvocation: prepared
        ? prepared.validated.descriptor.automaticInvocation
        : Boolean(row?.automaticInvocation),
    };
  }
  stageSkill(validated: ValidatedSkillPackage): {
    identity: ResourceIdentity;
    release(): void;
  } {
    const id = validated.descriptor.id;
    if (this.stagedSkills.has(id))
      throw Object.assign(new Error("Resource update is pending."), {
        code: "resource_update_pending",
      });
    const descriptor = describeAssignmentSkill({
      ...validated.descriptor,
      contentDigest: validated.contentDigest,
      codexCompatibility: "supported",
      opencodeCompatibility: "supported",
    });
    const identity = resourceIdentitySchema.parse({
      kind: "skill",
      id,
      version: descriptor.version,
      contentDigest: descriptor.contentDigest,
      securityDigest: descriptor.securityDigest,
      configurationDigest: descriptor.configurationDigest,
      invocationPolicyDigest: descriptor.invocationPolicyDigest,
      providerProjections: descriptor.providers,
    });
    const record = { identity, validated: structuredClone(validated) };
    this.stagedSkills.set(id, record);
    return {
      identity,
      release: () => {
        if (this.stagedSkills.get(id) === record) this.stagedSkills.delete(id);
      },
    };
  }
  capabilityPlan(
    resource: ResourceIdentity,
  ):
    | {
        entry: CapabilityCatalogEntry;
        settings: readonly CapabilitySettingRecord[];
      }
    | undefined {
    const staged = this.stagedCapabilities.get(resource.id);
    return staged &&
      JSON.stringify(staged.identity) === JSON.stringify(resource)
      ? staged
      : undefined;
  }
  stageCapability(
    entry: CapabilityCatalogEntry,
    settings: readonly CapabilitySettingRecord[],
  ): { identity: ResourceIdentity; release(): void } {
    const id = entry.manifest.id;
    if (this.stagedCapabilities.has(id))
      throw Object.assign(new Error("Resource update is pending."), {
        code: "resource_update_pending",
      });
    const descriptor = this.catalog.describeCapability(entry, settings);
    if (!descriptor)
      throw Object.assign(new Error("Resource is unavailable."), {
        code: "resource_unavailable",
      });
    const identity = resourceIdentitySchema.parse({
      kind: "capability",
      id,
      version: descriptor.version,
      contentDigest: descriptor.contentDigest,
      securityDigest: descriptor.securityDigest,
      configurationDigest: descriptor.configurationDigest,
      invocationPolicyDigest: descriptor.invocationPolicyDigest,
      providerProjections: descriptor.providers,
    });
    const record = { identity, entry, settings: structuredClone(settings) };
    this.stagedCapabilities.set(id, record);
    return {
      identity,
      release: () => {
        if (this.stagedCapabilities.get(id) === record)
          this.stagedCapabilities.delete(id);
      },
    };
  }
}
