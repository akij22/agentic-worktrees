import path from "node:path";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { DatabaseAssignmentMigrationCatalog } from "./assignments/database-assignment-migration-catalog";
import { ApplicationResourceCatalog } from "./assignments/application-resource-catalog";
import { initDatabase } from "./database";
import {
  applyCodingAgentCapabilities,
  configureCodingAgentCapabilityBridge,
  configureCodingAgentSkillCatalog,
  configureCodingAgentSkillInvocationSource,
  sendAgentMessage,
  getAgentInstallationStatus,
  getCodingAgentCapabilitySession,
  stopCodingAgents,
  configureCodingAgentResourceRuntime,
  handleOwnedCodingAgentEvent,
} from "./coding-agents/coding-agent-service";
import { CapabilityRepository } from "./capabilities/capability-repository";
import { createElectronCapabilityCredentialStore } from "./capabilities/capability-credential-store";
import { createElectronCapabilityHostManager } from "./capabilities/capability-host-manager";
import { CapabilityService } from "./capabilities/capability-service";
import { createCapabilityCatalog } from "./capabilities/catalog";
import { InstalledCapabilityCatalog } from "./capabilities/installed-catalog";
import { ManagedPackageRepository } from "./packages/package-repository";
import { createManagedPackageLayout } from "./packages/storage-layout";
import { NpmPackageAcquirer } from "./packages/npm-acquirer";
import { OfficialCatalogService } from "./packages/catalog/official-catalog";
import { PackageLock } from "./packages/package-lock";
import { CapabilityPackageInspector } from "./capabilities/package-inspector";
import { CapabilityPackageInstaller } from "./capabilities/capability-package-installer";
import { createElectronCapabilityPackageVerifier } from "./capabilities/package-verifier";
import { WebSearchMigration } from "./capabilities/web-search-migration";
import { getSqlite } from "./database/client";
import { SkillRepository } from "./skills/skill-repository";
import { SkillService } from "./skills/skill-service";
import { createSkillStorageLayout } from "./skills/skill-installer";
import { CapabilityDistributionService } from "./capabilities/capability-distribution-service";
import { ResourceCutover } from "./database/resource-cutover";
import { ApplicationResourceRuntime } from "./application-resource-runtime";
import { ApplicationResourceAccess, configureApplicationResourceAccess } from "./application-resource-access";
import { getResourceEvidenceConfiguration, getResourceRuntimeEnvironment } from "./config/env";


let currentCapabilityCatalog: import("./capabilities/catalog").CapabilityCatalog|null = null;
let currentResources: ApplicationResourceRuntime|null = null;
let currentUserDataPath = "";
let currentMode: "ui" | "cli" = "ui";
let capabilityDistributionService: CapabilityDistributionService | null = null;
let currentWebSearchMigration: WebSearchMigration | null = null;

const initializeSkills = (): SkillService => {
  const repository = new SkillRepository();
  const layout = createSkillStorageLayout(currentUserDataPath);
  const service = new SkillService({
    repository,
    layout,
    resourceOwner:()=>{
      if(currentResources) {
        const runtime=currentResources;
        return {remove:(id,commitResource)=>runtime.assignment.distribute({kind:"skill",id,targetVersion:null,commitResource}),install:(transaction,commit)=>runtime.installSkill(transaction.validated,{stage:async()=>{await transaction.commit();},commit,rollback:()=>transaction.rollback({keepPackage:true})})};
      }
      if(getSqlite().prepare("SELECT 1 FROM worktree_assignment_migrations WHERE migration_key='worktree-resource-release-v1' AND status='verified'").get())throw Object.assign(new Error("Worktree Resources are unavailable."),{code:"runtime_unavailable"});
      return undefined;
    },
    runtime: {
      syncCatalog: async (catalog) =>
        currentResources ? undefined : configureCodingAgentSkillCatalog(
          catalog
            ? {
                activeRoot: catalog.activeRoot,
                expectedIds: catalog.skills.map((skill) => skill.id),
              }
            : null,
        ),
      invoke: async (runId, skill, _argumentsValue, reasoningVariant) =>
        sendAgentMessage(
          runId,
          {
            explicitSkill: {
              id: skill.id,
              name: skill.name,
              path: skill.path,
              ...(skill.arguments ? { arguments: skill.arguments } : {}),
            },
          },
          reasoningVariant,
        ),
      getAgentKind: (runId) => getCodingAgentCapabilitySession(runId).agentKind,
    },
    log: (message, error) =>
      console.error(message, error instanceof Error ? error.name : "unknown"),
  });
  if (currentMode === "ui")
    configureCodingAgentSkillInvocationSource((runId) =>
      service.listRunInvocations(runId).map((record) => ({
        id: record.id,
        skillId: record.skillId,
        name: service.getSkill(record.skillId)?.name ?? record.skillId,
        version: record.version,
        mode: record.mode,
        status: record.status,
        ...(record.errorCode ? { errorCode: record.errorCode } : {}),
        requestedAt: record.requestedAt.toISOString(),
        ...(record.loadedAt ? { loadedAt: record.loadedAt.toISOString() } : {}),
        ...(record.failedAt ? { failedAt: record.failedAt.toISOString() } : {}),
      })),
    );
  return service;
};

const initializeCapabilities = async (): Promise<CapabilityService> => {
  const repository = new CapabilityRepository();
  const packageRepository = new ManagedPackageRepository();
  const packageLayout = createManagedPackageLayout(
    path.join(currentUserDataPath, "managed-packages"),
  );
  const installedCatalog = new InstalledCapabilityCatalog(
    packageLayout,
    packageRepository,
  );
  const catalog = createCapabilityCatalog(installedCatalog);
  currentCapabilityCatalog=catalog;
  try {
    await catalog.refresh();
  } catch {
    throw new Error("capability_catalog_unavailable");
  }
  const packageLock = new PackageLock(packageLayout.root + "/.packages.lock");
  const webSearchMigration = new WebSearchMigration({
    capabilities: repository,
    packages: packageRepository,
    officialCatalog: new OfficialCatalogService(),
    acquirer: new NpmPackageAcquirer(packageLayout),
    inspector: new CapabilityPackageInspector(),
    verifier: createElectronCapabilityPackageVerifier(),
    installer: new CapabilityPackageInstaller(
      packageLayout,
      packageRepository,
      repository,
      <T>(work: () => T) => getSqlite().transaction(work)(),
      { refreshCatalog: () => catalog.refresh() },
    ),
    lock: packageLock,
  });
  // Web Search is shipped as a bundled capability. Keep the migration object
  // available for compatibility with the application-services contract, but do
  // not attempt to replace the working local runtime with an unpublished npm
  // artifact.
  currentWebSearchMigration = webSearchMigration;
  const credentials = createElectronCapabilityCredentialStore(
    path.join(currentUserDataPath, "capability-credentials.bin"),
  );
  const hosts = createElectronCapabilityHostManager(
    (capabilityId, settingKey) =>
      service.resolveSecret(capabilityId, settingKey),
    catalog,
  );
  const connections = new Map<
    string,
    import("./coding-agents/types").CodingAgentCapabilityConnection
  >();
  const connectionKinds = new Map<
    string,
    import("./coding-agents/types").CodingAgentKind
  >();
  const prepare = async (
    runId: string,
    agentKind: import("./coding-agents/types").CodingAgentKind,
  ) => {
    const catalogIds = new Set(
      catalog.list().map((entry) => entry.manifest.id),
    );
    const activeIds = repository
      .listSessionCapabilities(runId)
      .filter(
        (item) =>
          item.status === "active" && catalogIds.has(item.capabilityId),
      )
      .map((item) => item.capabilityId);
    const settings = Object.fromEntries(
      activeIds.map((id) => [
        id,
        Object.fromEntries(
          repository
            .getSettings(id)
            .filter((item) => item.value !== undefined)
            .map((item) => [item.key, item.value]),
        ),
      ]),
    );
    const host = await hosts.ensureHost(runId, activeIds, settings);
    const profileId = `aw_${runId.toLowerCase().replace(/[^a-z0-9_]+/g, "_")}`;
    const connection = {
      serverName: agentKind === "codex" ? host.serverName : profileId,
      url: host.url,
      authorizationHeader: `Bearer ${host.bearerToken}`,
      profileId,
    };
    connections.set(runId, connection);
    connectionKinds.set(runId, agentKind);
    return connection;
  };
  const activator = {
    prepareSession: prepare,
    apply: async (runId: string, expectedToolNames: string[]) => {
      const context = getCodingAgentCapabilitySession(runId);
      const connection =
        connections.get(runId) ?? (await prepare(runId, context.agentKind));
      return applyCodingAgentCapabilities(
        runId,
        connection,
        expectedToolNames,
        [...connections.entries()]
          .filter(([id]) => connectionKinds.get(id) === context.agentKind)
          .map(([, value]) => value),
      );
    },
    remove: async (runId: string) => {
      const context = getCodingAgentCapabilitySession(runId);
      const connection =
        connections.get(runId) ?? (await prepare(runId, context.agentKind));
      connections.delete(runId);
      try {
        const result = await applyCodingAgentCapabilities(
          runId,
          connection,
          [],
          [...connections.entries()]
            .filter(([id]) => connectionKinds.get(id) === context.agentKind)
            .map(([, value]) => value),
        );
        connectionKinds.delete(runId);
        return result;
      } catch (error) {
        connections.set(runId, connection);
        throw error;
      }
    },
    isAgentIdle: async (runId: string) =>
      getCodingAgentCapabilitySession(runId).idle,
  };
  const service = new CapabilityService({
    resourceOwner:()=>{
      if(currentResources) {
        const runtime=currentResources;
        return {configure:(entry,settings,commit)=>runtime.configureCapability(entry,settings,commit)};
      }
      if(getSqlite().prepare("SELECT 1 FROM worktree_assignment_migrations WHERE migration_key='worktree-resource-release-v1' AND status='verified'").get())throw Object.assign(new Error("Worktree Resources are unavailable."),{code:"runtime_unavailable"});
      return undefined;
    },
    repository,
    credentials,
    hosts,
    activator,
    getAgentKind: async (runId) =>
      getCodingAgentCapabilitySession(runId).agentKind,
    getAgentVersion: async (runId) =>
      getCodingAgentCapabilitySession(runId).version,
    logError: (event, code) => console.error(event, code),
    catalog,
  });
  if (currentMode === "ui")
    configureCodingAgentCapabilityBridge({
      prepareSession: prepare,
      listConnections: (agentKind) =>
        [...connections.entries()]
          .filter(([id]) => connectionKinds.get(id) === agentKind)
          .map(([, value]) => value),
      stopSession: (runId) => {
        connections.delete(runId);
        connectionKinds.delete(runId);
        hosts.stopHost(runId);
      },
      listSessionCapabilities: (runId) =>
        service.listSessionCapabilities(runId).map((record) => ({
          id: record.capabilityId,
          name: record.name,
          version: record.version,
          state: record.state,
          ...(record.errorCode ? { errorCode: record.errorCode } : {}),
          ...(record.activatedAt ? { activatedAt: record.activatedAt } : {}),
          ...(record.deactivatedAt
            ? { deactivatedAt: record.deactivatedAt }
            : {}),
        })),
      isReloading: (runId) => {
        const interruptedStates = [
          "pending_activation",
          "pending_deactivation",
          "reloading",
        ];
        if (connectionKinds.get(runId) === "opencode") {
          return repository
            .listInterruptedSessionCapabilities()
            .some((record) => connectionKinds.get(record.runId) === "opencode");
        }
        return repository
          .listSessionCapabilities(runId)
          .some((record) => interruptedStates.includes(record.status));
      },
      inheritWorktreeCapabilities: (worktreeId, runId) => {
        service.inheritWorktreeCapabilitiesIntoSession(worktreeId, runId);
      },
    });
  capabilityDistributionService = new CapabilityDistributionService({
    layout: packageLayout,
    repository: packageRepository,
    capabilityRepository: repository,
    installedCatalog,
    sessionCoordinator: service,
    resourceOwner:()=>{
      if(currentResources)return currentResources.packageResourceOwner();
      if(getSqlite().prepare("SELECT 1 FROM worktree_assignment_migrations WHERE migration_key='worktree-resource-release-v1' AND status='verified'").get())throw new Error("package_update_failed");
      return undefined;
    },
    credentials,
    verifier: createElectronCapabilityPackageVerifier(),
    packageLock,
  });
  return service;
};

export interface ApplicationServices {
  capabilityService: CapabilityService;
  distributionService: CapabilityDistributionService;
  webSearchMigration: WebSearchMigration;
  skillService?: SkillService;
  resources?: ApplicationResourceRuntime;
  stop(): Promise<void>;
}

export async function createApplicationServices(input: {
  userDataPath: string;
  mode: "ui" | "cli";
  resourceHostBundlePath?:string;
}): Promise<ApplicationServices> {
  currentUserDataPath = input.userDataPath;
  currentMode = input.mode;
  const { configureDatabaseUserDataPath } = await import("./database/client");
  configureDatabaseUserDataPath(input.userDataPath);
  initDatabase();
  const sqlite = getSqlite();
  const capabilityService = await initializeCapabilities();
  if (!capabilityDistributionService || !currentWebSearchMigration)
    throw new Error("capability_startup_unavailable");
  const distributionService = capabilityDistributionService;
  const skillService = input.mode === "ui" ? initializeSkills() : undefined;
  if (input.mode === "ui") {
    const { configureCapabilityIpc, configureSkillIpc } = await import("./ipc");
    configureCapabilityIpc(capabilityService);
    if (skillService) configureSkillIpc(skillService);
  }
  let resources: ApplicationResourceRuntime|undefined;
  let resourceAuthorityRequired = false;
  {
    const {configureResourceIpc,publishResourceActivity} = await import("./ipc");
    const evidence = getResourceEvidenceConfiguration();
    if (evidence) {
      try {
        await capabilityService.reconcileCapabilities();
        const hostBundle=await readFile(input.resourceHostBundlePath ?? path.join(__dirname,"capability-host.js")).catch(()=>null);
        const bundledDigest=hostBundle ? "sha256:"+createHash("sha256").update(hostBundle).digest("hex") : undefined;
        const migrationCatalog=new DatabaseAssignmentMigrationCatalog(sqlite,currentCapabilityCatalog ?? undefined,()=>bundledDigest);
        new ResourceCutover(sqlite,migrationCatalog,evidence).run();
        resources = new ApplicationResourceRuntime({sqlite,resources:new ApplicationResourceCatalog(sqlite,input.userDataPath,migrationCatalog,currentCapabilityCatalog ?? undefined),userDataPath:input.userDataPath,environment:getResourceRuntimeEnvironment(),...evidence,
          capabilityHosts:currentCapabilityCatalog ? {catalog:currentCapabilityCatalog,repository:new CapabilityRepository(sqlite),resolveSecret:(id,key)=>capabilityService.resolveSecret(id,key),bundlePath:input.resourceHostBundlePath} : undefined,
          executable:kind=>{
            const installation=getAgentInstallationStatus().installations.find(item=>item.kind === kind && item.configured);
            if (!installation?.executablePath) throw new Error("runtime_unavailable");
            return installation.executablePath;
          },onActivityChanged:input.mode === "ui" ? publishResourceActivity : undefined,onEvent:handleOwnedCodingAgentEvent,
        });
        if(input.mode === "ui") {
          const access = new ApplicationResourceAccess(sqlite);
          configureApplicationResourceAccess(access);
          configureResourceIpc({assignment:resources.assignment,activity:resources.activity,access});
        }
        await resources.start();
        currentResources=resources;
        configureCodingAgentCapabilityBridge(null);
        configureCodingAgentSkillInvocationSource(null);
      } catch {
        configureResourceIpc(null);configureApplicationResourceAccess(null);
        await resources?.stop();resources=undefined;
        console.error("resource_startup_unavailable");
      }
    } else console.error("resource_evidence_key_unavailable");
    const cutover = Boolean(sqlite.prepare("SELECT 1 FROM worktree_assignment_migrations WHERE migration_key='worktree-resource-release-v1' AND status='verified'").get());
    resourceAuthorityRequired=cutover;
    configureCodingAgentResourceRuntime(resources ?? null,cutover);
  }
  let stopping: Promise<void>|undefined;
  return {
    capabilityService,
    distributionService,
    webSearchMigration: currentWebSearchMigration,
    ...(skillService ? { skillService } : {}),
    ...(resources ? {resources} : {}),
    stop: () => stopping ??= (async () => {
      const {configureResourceIpc} = await import("./ipc");
      configureResourceIpc(null);configureApplicationResourceAccess(null);
      try {await stopCodingAgents();} finally {
        currentResources=null;
        configureCodingAgentResourceRuntime(null,resourceAuthorityRequired);
        await capabilityService.stopCapabilities();
      }
    })(),
  };
}
