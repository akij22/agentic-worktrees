import { createHash } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import type { AssignmentMigrationCatalog, CanonicalMigrationResource } from "./assignment-migrator";

const digest = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const provider = (agentKind: "codex"|"opencode", availability: "compatible"|"unavailable", isolation: "enforced"|"not_enforced"|"not_applicable", identity: unknown) => ({ agentKind,availability,skillIsolation:isolation,qualificationDigest:digest({contract:"assignment-migration-v1",agentKind,availability,isolation}),expectedStateDigest:digest(identity) });

export class DatabaseAssignmentMigrationCatalog implements AssignmentMigrationCatalog {
  constructor(private readonly sqlite: BetterSqlite3.Database) {}

  resolve(resource: {resourceKind:"capability"|"skill";resourceId:string;version:string}): CanonicalMigrationResource | undefined {
    if(resource.resourceKind==="skill") {
      const row=this.sqlite.prepare(`SELECT skill_id id,version,content_digest contentDigest,name,description,codex_compatibility codexCompatibility,opencode_compatibility opencodeCompatibility,automatic_invocation automaticInvocation FROM skill_installations WHERE skill_id=? AND version=? AND state IN ('installed','update_available')`).get(resource.resourceId,resource.version) as {id:string;version:string;contentDigest:string;name:string;description:string;codexCompatibility:string;opencodeCompatibility:string;automaticInvocation:number}|undefined;
      if(!row) return undefined;
      const invocationPolicyDigest=digest({automaticInvocation:Boolean(row.automaticInvocation)}); const configurationDigest=digest({}); const securityDigest=digest({contentDigest:row.contentDigest});
      return {...resource,name:row.name,description:row.description,contentDigest:row.contentDigest,securityDigest,configurationDigest,invocationPolicyDigest,providers:[
        provider("codex",row.codexCompatibility==="supported"?"compatible":"unavailable","not_enforced",{...resource,configurationDigest,invocationPolicyDigest}),
        provider("opencode",row.opencodeCompatibility==="supported"?"compatible":"unavailable","enforced",{...resource,configurationDigest,invocationPolicyDigest}),
      ]};
    }
    const installation=this.sqlite.prepare(`SELECT ci.permission_digest permissionDigest,mp.active_content_digest contentDigest FROM capability_installations ci JOIN managed_package_installations mp ON mp.item_kind='capability' AND mp.item_id=ci.capability_id WHERE ci.capability_id=? AND ci.version=? AND ci.configured=1 AND mp.active_version=ci.version AND mp.active_content_digest IS NOT NULL`).get(resource.resourceId,resource.version) as {permissionDigest:string;contentDigest:string}|undefined;
    if(!installation) return undefined;
    const settings=this.sqlite.prepare("SELECT key,value_json valueJson,secret_ref secretRef FROM capability_settings WHERE capability_id=? ORDER BY key").all(resource.resourceId) as Array<{key:string;valueJson:string|null;secretRef:string|null}>;
    const configurationDigest=digest(settings.map(({key,valueJson,secretRef})=>({key,valueJson,hasSecret:secretRef!==null}))); const invocationPolicyDigest=digest({mode:"explicit"}); const securityDigest=digest({permissionDigest:installation.permissionDigest,contentDigest:installation.contentDigest});
    return {...resource,name:resource.resourceId,description:"",contentDigest:installation.contentDigest,securityDigest,permissionDigest:installation.permissionDigest,configurationDigest,invocationPolicyDigest,providers:[
      provider("codex","compatible","not_applicable",{...resource,configurationDigest,invocationPolicyDigest}),provider("opencode","compatible","not_applicable",{...resource,configurationDigest,invocationPolicyDigest}),
    ]};
  }
}
