import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapSchemaSql } from "../database/bootstrap";
import { CapabilityRepository } from "./capability-repository";
import { CapabilityService } from "./capability-service";
import { permissionDigest, getBundledCapability } from "./catalog";

describe("CapabilityService", () => {
  let sqlite: BetterSqlite3.Database;
  beforeEach(() => {
    sqlite = new BetterSqlite3(":memory:"); sqlite.pragma("foreign_keys=ON"); sqlite.exec(bootstrapSchemaSql); const now=Date.now();
    sqlite.prepare(`INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at) VALUES ('r',1,'o','r','o/r',0,0,'','','ready',?,?)`).run(now,now);
    sqlite.prepare(`INSERT INTO worktrees (id,repository_id,name,path,branch_name,status,created_at,updated_at) VALUES ('w','r','w','/tmp/w','main','ready',?,?)`).run(now,now);
    sqlite.prepare(`INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,created_at,updated_at) VALUES ('run-1','r','w','Run','','idle',?,?)`).run(now,now);
  });
  afterEach(() => sqlite.close());
  it("configures keyless search and activates with ordered reload events", async () => {
    const repository = new CapabilityRepository(sqlite); const events: string[] = [];
    const service = new CapabilityService({ repository, credentials: { setSecret: vi.fn(), getSecret: vi.fn(), removeSecret: vi.fn() } as never, hosts: { setActiveCapabilities: vi.fn().mockResolvedValue(["web_search"]), stopAll: vi.fn() } as never, activator: { prepareSession: vi.fn(), apply: vi.fn().mockResolvedValue("reloaded"), remove: vi.fn(), isAgentIdle: vi.fn().mockResolvedValue(true) }, getAgentKind: vi.fn().mockResolvedValue("opencode"), probe: vi.fn().mockRejectedValue(new Error("offline")) });
    service.subscribeToCapabilityEvents((event) => events.push(event.state));
    const id = "agentic-worktrees.web-search";
    const configured = await service.configureCapability({ capabilityId: id, acceptedPermissionDigest: permissionDigest(getBundledCapability(id).manifest), settings: { providerMode: "auto", resultLimit: 5 } });
    expect(configured).toMatchObject({ state: "ready", secretConfigured: false, warningCode: "upstream_unavailable" });
    await expect(service.activateCapability("run-1", id)).resolves.toMatchObject({ state: "active" });
    expect(events).toEqual(["pending_activation", "reloading", "active"]);
  });
});
