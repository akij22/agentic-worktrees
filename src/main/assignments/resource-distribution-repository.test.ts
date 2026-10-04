import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapSchemaSql } from "../database/bootstrap";
import { ResourceDistributionRepository } from "./resource-distribution-repository";

const projection = (worktreeId: string, revision = "1") => ({ worktreeId,revision,projectionSequence:"1",phase:"stable" as const,currentAgentKind:"codex" as const,resources:[],blockers:[],progress:null,admission:{canCreateSession:true,canResumeSession:true,canSend:true,reason:null,message:null},allowedActions:[],failure:null,updatedAt:"2026-09-15T10:00:00.000Z" });

describe("ResourceDistributionRepository", () => {
 let db: BetterSqlite3.Database; let repository: ResourceDistributionRepository;
 beforeEach(() => {
  db=new BetterSqlite3(":memory:"); db.pragma("foreign_keys = ON"); db.exec(bootstrapSchemaSql);
  db.exec(`INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at) VALUES ('repo',1,'o','r','o/r',0,0,'u','u','ready',1,1);`);
  for (const [index,id] of ["a","b"].entries()) {
   db.prepare("INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES (?,'repo',?,?,?,'linked','ready',1,1)").run(id,id,`/tmp/${id}`,id);
   db.prepare("INSERT INTO worktree_assignment_generations (id,worktree_id,ordinal,resource_set_digest,created_at) VALUES (?,?,0,?,1)").run(`old-${id}`,id,`old-${id}`);
   db.prepare("INSERT INTO worktree_assignment_generations (id,worktree_id,ordinal,resource_set_digest,created_at) VALUES (?,?,1,?,1)").run(`new-${id}`,id,`new-${id}`);
   db.prepare("INSERT INTO worktree_assignments (worktree_id,revision,projection_sequence,phase,desired_generation_id,verified_generation_id,created_at,updated_at) VALUES (?,0,0,'applying',?,?,1,1)").run(id,`old-${id}`,`old-${id}`);
   db.prepare("INSERT INTO worktree_assignment_attempts (id,worktree_id,kind,target_revision,target_generation_id,prior_verified_generation_id,status,side_effect_boundary,started_at,updated_at) VALUES (?,?,'resource_update',1,?,?,'applying','commit_pending',1,1)").run(`attempt-${id}`,id,`new-${id}`,`old-${id}`);
   expect(index).toBeLessThan(2);
  }
  repository=new ResourceDistributionRepository(db);
 });
 afterEach(()=>db.close());
 it("commits every frozen Worktree atomically or none", () => {
  repository.createFrozenOperation({operationId:"operation",resourceKind:"skill",resourceId:"skill",targetResourceVersionId:null,now:new Date(),participants:[
   {worktreeId:"a",observedRevision:"0",priorGenerationId:"old-a",targetGenerationId:"new-a",attemptId:"attempt-a",applyOrder:0},
   {worktreeId:"b",observedRevision:"0",priorGenerationId:"old-b",targetGenerationId:"new-b",attemptId:"attempt-b",applyOrder:1},
  ]});
  for (const id of ["a","b"]) {
   repository.recordWorktreeTransition("operation",id,"gate_acquired","staged",new Date());
   repository.recordWorktreeTransition("operation",id,"staged","activated",new Date());
   repository.recordWorktreeTransition("operation",id,"activated","commit_ready",new Date());
  }
  repository.markCommitPending("operation",new Date());
  db.prepare("UPDATE worktree_assignments SET revision=2 WHERE worktree_id='b'").run();
  expect(()=>repository.commitGlobally("operation",[{worktreeId:"a",eventId:"event-a",projection:projection("a")},{worktreeId:"b",eventId:"event-b",projection:projection("b")}],new Date())).toThrow(/lineage/i);
  expect(db.prepare("SELECT revision,desired_generation_id desired FROM worktree_assignments WHERE worktree_id='a'").get()).toEqual({revision:0,desired:"old-a"});
  db.prepare("UPDATE worktree_assignments SET revision=0 WHERE worktree_id='b'").run();
  repository.commitGlobally("operation",[{worktreeId:"a",eventId:"event-a",projection:projection("a")},{worktreeId:"b",eventId:"event-b",projection:projection("b")}],new Date());
  expect(db.prepare("SELECT worktree_id worktreeId,revision,desired_generation_id desired,verified_generation_id verified FROM worktree_assignments ORDER BY worktree_id").all()).toEqual([
   {worktreeId:"a",revision:1,desired:"new-a",verified:"new-a"},{worktreeId:"b",revision:1,desired:"new-b",verified:"new-b"},
  ]);
  expect(db.prepare("SELECT status FROM resource_distribution_operations").get()).toEqual({status:"verified"});
 });
 it("cancels before side effects without changing Assignment revisions",()=>{
  repository.createFrozenOperation({operationId:"cancel",resourceKind:"skill",resourceId:"skill",targetResourceVersionId:null,now:new Date(),participants:[
   {worktreeId:"a",observedRevision:"0",priorGenerationId:"old-a",targetGenerationId:"new-a",attemptId:"attempt-a",applyOrder:0},
   {worktreeId:"b",observedRevision:"0",priorGenerationId:"old-b",targetGenerationId:"new-b",attemptId:"attempt-b",applyOrder:1},
  ]});
  repository.cancelBeforeEffects("cancel",[{worktreeId:"a",eventId:"cancel-a",projection:projection("a","0")},{worktreeId:"b",eventId:"cancel-b",projection:projection("b","0")}],new Date());
  expect(db.prepare("SELECT worktree_id worktreeId,revision,phase FROM worktree_assignments ORDER BY worktree_id").all()).toEqual([{worktreeId:"a",revision:0,phase:"stable"},{worktreeId:"b",revision:0,phase:"stable"}]);
  expect(db.prepare("SELECT status FROM resource_distribution_operations").get()).toEqual({status:"cancelled"});
 });
});
