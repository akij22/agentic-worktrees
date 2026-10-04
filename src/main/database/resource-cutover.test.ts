import Sqlite from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { bootstrapSchemaSql } from "./bootstrap";
import { AssignmentMigrator } from "../assignments/assignment-migrator";
import { ResourceCutover } from "./resource-cutover";
import { ResourceActivityRepository } from "../resource-activity/resource-activity-repository";

const databases: Sqlite.Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function fixture() {
  const db = new Sqlite(":memory:");
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(bootstrapSchemaSql);
  db.exec(`INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at) VALUES ('repo',1,'o','r','o/r',0,0,'u','u','ready',1,1);
    INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES ('wt','repo','w','/test','b','linked','ready',1,1);
    INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,output_status,last_sequence,created_at,updated_at) VALUES ('run','repo','wt','t','','idle','idle',0,1,1);
    INSERT INTO skill_invocations (id,run_id,skill_id,version,mode,status,requested_at,loaded_at) VALUES ('old','run','review','1.0.0','explicit','loaded',1,2)`);
  return db;
}
it("preserves legacy requests and leaves authority unchanged when the migration evidence key is unavailable", () => {
  const db = fixture();
  expect(() => new ResourceCutover(db).run()).toThrow(
    "resource_evidence_key_unavailable",
  );
  expect(new ResourceActivityRepository(db).getSnapshot("run").items).toEqual(
    [],
  );
  expect(
    db.prepare("SELECT count(*) count FROM worktree_assignments").get(),
  ).toEqual({ count: 0 });
  expect(
    db.prepare("SELECT status FROM skill_invocations WHERE id='old'").get(),
  ).toEqual({ status: "loaded" });
});
it("atomically imports legacy requests without confirming use and protects unchanged legacy history", () => {
  const db = fixture();
  const before = db.prepare("SELECT * FROM skill_invocations").all();
  const cutover = new ResourceCutover(db, undefined, {
    keyVersion: 1,
    evidenceKey: Buffer.alloc(32, 7),
  });
  expect(cutover.run()).toMatchObject({
    authority: "assignment",
    worktreeCount: 1,
    legacyRequestCount: 1,
  });
  expect(new ResourceActivityRepository(db).getSnapshot("run").items).toEqual([
    expect.objectContaining({
      resourceId: "review",
      resourceVersion: "1.0.0",
      requestState: "requested",
      useState: "not_confirmed",
      coverage: "legacy_unverified",
    }),
  ]);
  expect(db.prepare("SELECT * FROM skill_invocations").all()).toEqual(before);
  expect(() => db.exec("UPDATE skill_invocations SET status='failed'")).toThrow(
    /legacy_resource_read_only/,
  );
  expect(cutover.run()).toMatchObject({
    authority: "assignment",
    legacyRequestCount: 1,
  });
  expect(
    new ResourceActivityRepository(db).getSnapshot("run").items,
  ).toHaveLength(1);
});

it("finishes release cutover when an earlier release already migrated the Assignment baseline", () => {
  const db = fixture();
  new AssignmentMigrator(db).runInitialMigration();
  expect(
    new ResourceCutover(db, undefined, {
      keyVersion: 1,
      evidenceKey: Buffer.alloc(32, 7),
    }).run(),
  ).toMatchObject({ authority: "assignment", legacyRequestCount: 1 });
  expect(
    new ResourceActivityRepository(db).getSnapshot("run").items,
  ).toHaveLength(1);
  expect(() => db.exec("DELETE FROM skill_invocations")).toThrow(
    /legacy_resource_read_only/,
  );
});

it("migrates a configured bundled Capability using its real permission digest and exact reviewed catalog entry", async () => {
  const { getBundledCapability, permissionDigest } = await import(
    "../capabilities/catalog"
  );
  const { DatabaseAssignmentMigrationCatalog } = await import(
    "../assignments/database-assignment-migration-catalog"
  );
  const entry = getBundledCapability("agentic-worktrees.url-fetch");
  const db = fixture();
  db.prepare(
    `INSERT INTO capability_installations (capability_id,version,permission_digest,configured,created_at,updated_at) VALUES (?,?,?,1,1,1)`,
  ).run(
    entry.manifest.id,
    entry.manifest.version,
    permissionDigest(entry.manifest),
  );
  db.prepare(
    `INSERT INTO session_capabilities (id,run_id,capability_id,version,status,created_at,updated_at) VALUES ('active','run',?,?,'active',1,1)`,
  ).run(entry.manifest.id, entry.manifest.version);
  const catalog = {
    list: () => [entry],
    get: () => entry,
    refresh: async () => undefined,
  };
  expect(
    new ResourceCutover(
      db,
      new DatabaseAssignmentMigrationCatalog(
        db,
        catalog,
        () => "sha256:" + "a".repeat(64),
      ),
      { keyVersion: 1, evidenceKey: Buffer.alloc(32, 7) },
    ).run(),
  ).toMatchObject({ authority: "assignment", worktreeCount: 1 });
});

it("records the verified source fingerprint and actual durable counts at cutover", () => {
  const first = fixture(),
    second = fixture();
  second.exec(
    "INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES ('other','repo','other','/other','other','linked','ready',1,1)",
  );
  for (const db of [first, second])
    new ResourceCutover(db, undefined, {
      keyVersion: 1,
      evidenceKey: Buffer.alloc(32, 7),
    }).run();
  const marker = (db: Sqlite.Database) =>
    db
      .prepare(
        "SELECT source_fingerprint fingerprint,worktree_count worktrees,resource_version_count resources,generation_count generations FROM worktree_assignment_migrations WHERE migration_key='worktree-resource-release-v1'",
      )
      .get();
  expect(marker(first)).toMatchObject({
    worktrees: 1,
    resources: 0,
    generations: 1,
  });
  expect(marker(second)).toMatchObject({
    worktrees: 2,
    resources: 0,
    generations: 2,
  });
  expect(marker(first)).not.toEqual(
    expect.objectContaining({
      fingerprint: (marker(second) as { fingerprint: string }).fingerprint,
    }),
  );
});

it("rolls back the whole cutover when legacy evidence fails validation", () => {
  const db = fixture();
  db.exec("UPDATE skill_invocations SET mode='invalid-mode'");
  const before = db.prepare("SELECT * FROM skill_invocations").all();
  expect(() =>
    new ResourceCutover(db, undefined, {
      keyVersion: 1,
      evidenceKey: Buffer.alloc(32, 7),
    }).run(),
  ).toThrow();
  expect(new ResourceActivityRepository(db).getSnapshot("run").items).toEqual(
    [],
  );
  expect(
    db
      .prepare(
        "SELECT count(*) count FROM worktree_assignment_migrations WHERE status='verified'",
      )
      .get(),
  ).toEqual({ count: 0 });
  expect(
    db.prepare("SELECT count(*) count FROM worktree_assignments").get(),
  ).toEqual({ count: 0 });
  expect(db.prepare("SELECT * FROM skill_invocations").all()).toEqual(before);
  expect(() =>
    db.exec("UPDATE skill_invocations SET mode='explicit'"),
  ).not.toThrow();
});

it("cuts over a database assembled from the committed generated migrations",async()=>{
  const {drizzle}=await import("drizzle-orm/better-sqlite3");
  const {migrate}=await import("drizzle-orm/better-sqlite3/migrator");
  const {resolve}=await import("node:path");
  const db=new Sqlite(":memory:");databases.push(db);db.pragma("foreign_keys=ON");
  migrate(drizzle(db),{migrationsFolder:resolve("src/main/database/migrations")});
  db.exec("INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at) VALUES ('repo',1,'o','r','o/r',0,0,'u','u','ready',1,1)");
  db.exec("INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES ('wt','repo','w','/test','b','linked','ready',1,1)");
  db.exec("INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,output_status,last_sequence,created_at,updated_at) VALUES ('run','repo','wt','t','','idle','idle',0,1,1)");
  db.exec("INSERT INTO skill_invocations (id,run_id,skill_id,version,mode,status,requested_at,loaded_at) VALUES ('old','run','review','1.0.0','explicit','loaded',1,2)");
  expect(new ResourceCutover(db,undefined,{keyVersion:1,evidenceKey:Buffer.alloc(32,7)}).run()).toEqual({authority:"assignment",worktreeCount:1,legacyRequestCount:1});
  expect(new ResourceActivityRepository(db).getSnapshot("run").items).toEqual([expect.objectContaining({resourceId:"review",useState:"not_confirmed",coverage:"legacy_unverified"})]);
  expect(db.pragma("foreign_key_check")).toEqual([]);
  expect(()=>db.exec("UPDATE skill_invocations SET status='failed'")).toThrow("legacy_resource_read_only");
});
