import Sqlite from "better-sqlite3";
import { expect, it } from "vitest";
import { ApplicationResourceAccess } from "./application-resource-access";
import { bootstrapSchemaSql } from "./database/bootstrap";

it("authorizes only registered application renderers at their expected URL and exact existing run/Worktree", () => {
  const db = new Sqlite(":memory:");
  db.exec(bootstrapSchemaSql);
  db.exec(`INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at) VALUES ('repo',1,'o','r','o/r',0,0,'u','u','ready',1,1);
    INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES ('wt','repo','w','/test','b','linked','ready',1,1);
    INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,output_status,last_sequence,created_at,updated_at) VALUES ('run','repo','wt','t','','idle','idle',0,1,1)`);
  let url = "http://localhost:5188/#/session/run",
    destroyed = false;
  const access = new ApplicationResourceAccess(db);
  const remove = access.register(
    { id: 7, getURL: () => url, isDestroyed: () => destroyed },
    "http://localhost:5188/",
  );
  try {
    expect(access.isTrustedSender(7)).toBe(true);
    expect(access.isTrustedSender(8)).toBe(false);
    expect(access.canAccessRun(7, "run", "wt")).toBe(true);
    expect(access.canAccessRun(7, "run", "other")).toBe(false);
    expect(access.canAccessWorktree(7, "missing")).toBe(false);
    url = "https://external.example/";
    expect(access.canAccessRun(7, "run", "wt")).toBe(false);
    url = "http://localhost:5188/";
    destroyed = true;
    expect(access.isTrustedSender(7)).toBe(false);
    destroyed = false;
    remove();
    expect(access.isTrustedSender(7)).toBe(false);
  } finally {
    db.close();
  }
});
