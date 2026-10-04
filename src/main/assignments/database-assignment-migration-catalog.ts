import { createHash } from "node:crypto";
import { permissionDigest, type CapabilityCatalog, type CapabilityCatalogEntry } from "../capabilities/catalog";
import type BetterSqlite3 from "better-sqlite3";
import type { AssignmentMigrationCatalog, CanonicalMigrationResource } from "./assignment-migrator";
import type { CapabilitySettingRecord } from "../capabilities/capability-repository";

const digest = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const provider = (agentKind: "codex"|"opencode", availability: "compatible"|"unavailable", isolation: "enforced"|"not_enforced"|"not_applicable", identity: unknown) => ({ agentKind,availability,skillIsolation:isolation,qualificationDigest:digest({contract:"assignment-migration-v1",agentKind,availability,isolation}),expectedStateDigest:digest(identity) });
export function describeAssignmentSkill(row:{id:string;version:string;name:string;description:string;contentDigest:string;automaticInvocation:boolean|number;codexCompatibility:string;opencodeCompatibility:string}):CanonicalMigrationResource {
  const resource={resourceKind:"skill" as const,resourceId:row.id,version:row.version};
  const invocationPolicyDigest=digest({automaticInvocation:Boolean(row.automaticInvocation)}),configurationDigest=digest({}),securityDigest=digest({contentDigest:row.contentDigest});
  return {...resource,name:row.name,description:row.description,contentDigest:row.contentDigest,securityDigest,configurationDigest,invocationPolicyDigest,providers:[
    provider("codex",row.codexCompatibility==="supported"?"compatible":"unavailable","not_enforced",{...resource,configurationDigest,invocationPolicyDigest}),
    provider("opencode",row.opencodeCompatibility==="supported"?"compatible":"unavailable","enforced",{...resource,configurationDigest,invocationPolicyDigest}),
  ]};
}
export function describeAssignmentCapability(entry:CapabilityCatalogEntry,contentDigest:string,settings:readonly CapabilitySettingRecord[]):CanonicalMigrationResource {
  contentDigest=contentDigest.startsWith("sha256:") ? contentDigest : `sha256:${contentDigest}`;
  const resource={resourceKind:"capability" as const,resourceId:entry.manifest.id,version:entry.manifest.version};
  const configurationDigest=digest([...settings].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).map(setting=>({key:setting.key,valueJson:setting.value===undefined ? null : JSON.stringify(setting.value),hasSecret:Boolean(setting.secretRef),...(setting.secretRef ? {secretRevision:digest({reference:setting.secretRef})} : {})})));
  const invocationPolicyDigest=digest({mode:"explicit"}),securityDigest=digest({permissionDigest:permissionDigest(entry.manifest),contentDigest});
  return {...resource,name:entry.manifest.name,description:entry.manifest.description,contentDigest,securityDigest,permissionDigest:permissionDigest(entry.manifest),configurationDigest,invocationPolicyDigest,providers:[
    provider("codex",entry.manifest.compatibility.codex==="supported"?"compatible":"unavailable","not_applicable",{...resource,configurationDigest,invocationPolicyDigest}),
    provider("opencode",entry.manifest.compatibility.opencode==="supported"?"compatible":"unavailable","not_applicable",{...resource,configurationDigest,invocationPolicyDigest}),
  ]};
}

export class DatabaseAssignmentMigrationCatalog implements AssignmentMigrationCatalog {
  constructor(private readonly sqlite: BetterSqlite3.Database, private readonly capabilities?: CapabilityCatalog, private readonly bundledContentDigest?: (entry:CapabilityCatalogEntry)=>string|undefined) {}
  describeCapability(entry:CapabilityCatalogEntry,settings:readonly CapabilitySettingRecord[]):CanonicalMigrationResource|undefined {
    const contentDigest=entry.runtime.kind === "bundled" ? this.bundledContentDigest?.(entry) : entry.runtime.contentDigest;
    return contentDigest && !entry.blocked ? describeAssignmentCapability(entry,contentDigest,settings) : undefined;
  }

  resolve(resource: {resourceKind:"capability"|"skill";resourceId:string;version:string}): CanonicalMigrationResource | undefined {
    if(resource.resourceKind==="skill") {
      const row=this.sqlite.prepare(`SELECT skill_id id,version,content_digest contentDigest,name,description,codex_compatibility codexCompatibility,opencode_compatibility opencodeCompatibility,automatic_invocation automaticInvocation FROM skill_installations WHERE skill_id=? AND version=? AND state IN ('installed','update_available')`).get(resource.resourceId,resource.version) as {id:string;version:string;contentDigest:string;name:string;description:string;codexCompatibility:string;opencodeCompatibility:string;automaticInvocation:number}|undefined;
      if(!row) return undefined;
      return describeAssignmentSkill(row);
    }
    let installation=this.sqlite.prepare(`SELECT ci.permission_digest permissionDigest,mp.active_content_digest contentDigest FROM capability_installations ci LEFT JOIN managed_package_installations mp ON mp.item_kind='capability' AND mp.item_id=ci.capability_id AND mp.active_version=ci.version WHERE ci.capability_id=? AND ci.version=? AND ci.configured=1`).get(resource.resourceId,resource.version) as {permissionDigest:string;contentDigest:string|null}|undefined;
    if(!installation) return undefined;
    let entry:CapabilityCatalogEntry|undefined;
    if(this.capabilities) {
      try {entry=this.capabilities.get(resource.resourceId,resource.version);} catch {return undefined;}
      if(entry.blocked || entry.manifest.version !== resource.version || permissionDigest(entry.manifest) !== installation.permissionDigest) return undefined;
      if(entry.runtime.kind === "bundled") installation={...installation,contentDigest:this.bundledContentDigest?.(entry) ?? null};
      else if(entry.runtime.contentDigest !== installation.contentDigest) return undefined;
    }
    if(!installation.contentDigest) return undefined;
    const settings=this.sqlite.prepare("SELECT key,value_json valueJson,secret_ref secretRef FROM capability_settings WHERE capability_id=? ORDER BY key").all(resource.resourceId) as Array<{key:string;valueJson:string|null;secretRef:string|null}>;
    if(entry)return describeAssignmentCapability(entry,installation.contentDigest,settings.map(setting=>({key:setting.key,...(setting.valueJson!==null ? {value:JSON.parse(setting.valueJson)} : {}),...(setting.secretRef ? {secretRef:setting.secretRef} : {})})));
    const configurationDigest=digest(settings.map(({key,valueJson,secretRef})=>({key,valueJson,hasSecret:secretRef!==null}))); const invocationPolicyDigest=digest({mode:"explicit"}); const securityDigest=digest({permissionDigest:installation.permissionDigest,contentDigest:installation.contentDigest});
    return {...resource,name:resource.resourceId,description:"",contentDigest:installation.contentDigest,securityDigest,permissionDigest:installation.permissionDigest,configurationDigest,invocationPolicyDigest,providers:[
      provider("codex","compatible","not_applicable",{...resource,configurationDigest,invocationPolicyDigest}),provider("opencode","compatible","not_applicable",{...resource,configurationDigest,invocationPolicyDigest}),
    ]};
  }
}
