import Sqlite from "better-sqlite3";
import {
  mkdtemp,
  realpath,
  writeFile,
  readFile,
  chmod,
  rm,
  mkdir,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { OPENCODE_BUILTIN_TOOLS } from "./coding-agents/opencode-worktree-runtime";
import { validateSkillPackage } from "./skills/skill-validation";
import { bootstrapSchemaSql } from "./database/bootstrap";
import { ResourceCutover } from "./database/resource-cutover";
import { ApplicationResourceRuntime } from "./application-resource-runtime";

it("starts an owned Codex runtime, attests the empty Assignment and routes a created session to its exact local run", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "aw-resource-release-")),
  );
  const db = new Sqlite(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(bootstrapSchemaSql);
  db.exec(
    `INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at) VALUES ('repo',1,'o','r','o/r',0,0,'u','u','ready',1,1)`,
  );
  db.prepare(
    `INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES ('wt','repo','w',?,'b','linked','ready',1,1)`,
  ).run(root);
  db.exec(
    `INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,output_status,last_sequence,created_at,updated_at) VALUES ('run','repo','wt','t','','idle','idle',0,1,1)`,
  );
  new ResourceCutover(db).run();
  const executable = join(root, "provider");
  await writeFile(
    join(root, "codex-fixture.json"),
    JSON.stringify({ version: "0.154.0", completeOnInterrupt: true }),
  );
  await writeFile(
    executable,
    `#!${process.execPath}\n${await readFile(resolve("src/main/coding-agents/fixtures/codex-runtime-provider.mjs"), "utf8")}`,
  );
  await chmod(executable, 0o700);
  const runtime = new ApplicationResourceRuntime({
    sqlite: db,
    userDataPath: root,
    environment: {},
    evidenceKey: Buffer.alloc(32, 7),
    executable: () => executable,
  });
  try {
    await runtime.start();
    new ResourceCutover(db).writeWorktree("new-wt", () =>
      db
        .prepare(
          `INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES ('new-wt','repo','new',?,'new','linked','ready',1,1)`,
        )
        .run(join(root, "new-wt")),
    );
    expect(await runtime.assignment.get("new-wt", "codex")).toMatchObject({
      phase: "stable",
      revision: "0",
      resources: [],
      admission: { canSend: true },
    });
    expect(() =>
      new ResourceCutover(db).writeWorktree("failed-wt", () => {
        db.prepare(
          `INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES ('failed-wt','repo','failed',?,'failed','linked','ready',1,1)`,
        ).run(join(root, "failed-wt"));
        throw new Error("Synthetic persistence failure");
      }),
    ).toThrow("Synthetic persistence failure");
    await expect(
      runtime.assignment.get("failed-wt", "codex"),
    ).rejects.toThrow();
    const session = await runtime.withSession(
      {
        worktreeId: "wt",
        agentKind: "codex",
        runId: "run",
        operation: "create",
      },
      async (adapter) =>
        adapter.createSession(root, "test", {
          modelId: "fixture",
          runId: "run",
        }),
    );
    expect(session.id).toBeTruthy();
    expect(
      (await runtime.assignment.get("wt", "codex")).admission.canSend,
    ).toBe(true);
    await runtime.withSession(
      {
        worktreeId: "wt",
        agentKind: "codex",
        runId: "run",
        operation: "resume",
        externalSessionId: session.id,
      },
      (adapter) => adapter.getSession(root, session.id, { runId: "run" }),
    );
    const priorGeneration =
      runtime.manager.inspectWorktree("wt").runtimes[0].generation;
    await runtime.assignment.setDesired({
      worktreeId: "wt",
      expectedRevision: "0",
      resources: [],
    });
    await runtime.assignment.waitForReconciliation("wt");
    expect(runtime.manager.inspectWorktree("wt").runtimes).toHaveLength(1);
    expect(runtime.manager.inspectWorktree("wt").runtimes[0].generation).toBe(
      priorGeneration,
    );
    await runtime.submitTurn(
      {
        worktreeId: "wt",
        agentKind: "codex",
        runId: "run",
        externalSessionId: session.id,
      },
      { content: "Synthetic turn", providerId: "openai", modelId: "fixture" },
    );
    expect(runtime.manager.inspectWorktree("wt").busy).toBe(true);
    let writerAcquired = false;
    const writer = runtime.manager
      .acquireAdmission("wt", "exclusive")
      .then((lease) => {
        writerAcquired = true;
        return lease;
      });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(writerAcquired).toBe(false);
    await runtime.abort("run");
    (await writer).release();
    expect(runtime.manager.inspectWorktree("wt").busy).toBe(false);
    expect(runtime.activity.getSnapshot("run").items).toEqual([]);
    db.prepare(
      `INSERT INTO coding_agent_installations (id,kind,name,executable_path,version,enabled,last_verified_at,created_at,updated_at) VALUES ('codex','codex','Codex',?,'0.154.0',1,1,1,1)`,
    ).run(executable);
    db.prepare(
      `INSERT INTO coding_agent_sessions (run_id,installation_id,external_session_id,provider_id,model_id,created_at,updated_at) VALUES ('run','codex',?,'openai','fixture',1,1)`,
    ).run(session.id);
    await runtime.submitTurn(
      {
        worktreeId: "wt",
        agentKind: "codex",
        runId: "run",
        externalSessionId: session.id,
      },
      { content: "Shutdown turn", providerId: "openai", modelId: "fixture" },
    );
    await Promise.all([runtime.stop(), runtime.stop()]);
    const requests = (await readFile(join(root, "requests.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { method: string });
    expect(
      requests.filter((request) => request.method === "turn/interrupt"),
    ).toHaveLength(2);
    await writeFile(
      join(root, "codex-fixture.json"),
      JSON.stringify({
        version: "0.154.0",
        thread: {
          id: session.id,
          cwd: root,
          status: { type: "idle" },
          turns: [],
          path: null,
        },
      }),
    );
    const restarted = new ApplicationResourceRuntime({
      sqlite: db,
      userDataPath: root,
      environment: {},
      evidenceKey: Buffer.alloc(32, 7),
      executable: () => executable,
    });
    try {
      await restarted.start();
      await restarted.withSession(
        {
          worktreeId: "wt",
          agentKind: "codex",
          runId: "run",
          operation: "resume",
          externalSessionId: session.id,
        },
        (adapter) => adapter.getSession(root, session.id, { runId: "run" }),
      );
      expect(
        (await restarted.assignment.get("wt", "codex")).admission.canSend,
      ).toBe(true);
    } finally {
      await restarted.stop();
    }
  } finally {
    await runtime.stop();
    db.close();
    await removeFixture(root);
  }
}, 15_000);

it("exposes only the pinned assigned Skill to an owned Codex session", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "aw-resource-release-skill-")),
  );
  const source = join(root, "alpha");
  await mkdir(source);
  const content =
    "---\nname: alpha\ndescription: Synthetic isolation check.\n---\nUse the assigned instruction.\n";
  await writeFile(join(source, "SKILL.md"), content);
  const validated = await validateSkillPackage(source);
  const packagePath = join(
    root,
    "skills",
    "packages",
    "alpha",
    validated.descriptor.version,
  );
  await mkdir(packagePath, { recursive: true });
  await writeFile(join(packagePath, "SKILL.md"), content);
  const db = new Sqlite(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(bootstrapSchemaSql);
  db.exec(
    `INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at) VALUES ('repo',1,'o','r','o/r',0,0,'u','u','ready',1,1)`,
  );
  db.prepare(
    `INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES ('wt','repo','w',?,'b','linked','ready',1,1)`,
  ).run(root);
  db.exec(
    `INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,output_status,last_sequence,created_at,updated_at) VALUES ('run','repo','wt','t','','idle','idle',0,1,1)`,
  );
  db.prepare(
    `INSERT INTO skill_installations (skill_id,version,source_kind,source_ref,content_digest,name,description,codex_compatibility,opencode_compatibility,automatic_invocation,state,created_at,updated_at) VALUES ('alpha',?,'local','fixture',?,'alpha','Synthetic isolation check.','supported','supported',1,'installed',1,1)`,
  ).run(validated.descriptor.version, validated.contentDigest);
  new ResourceCutover(db).run();
  const executable = join(root, "provider");
  await writeFile(
    join(root, "codex-fixture.json"),
    JSON.stringify({ version: "0.154.0", completeOnInterrupt: true }),
  );
  await writeFile(
    executable,
    `#!${process.execPath}\n${await readFile(resolve("src/main/coding-agents/fixtures/codex-runtime-provider.mjs"), "utf8")}`,
  );
  await chmod(executable, 0o700);
  const opencode = join(root, "opencode-provider");
  await writeFile(
    opencode,
    `#!${process.execPath}\n${await readFile(resolve("src/main/coding-agents/fixtures/opencode-runtime-provider.mjs"), "utf8")}`,
  );
  await chmod(opencode, 0o700);
  await writeFile(
    join(root, "provider-fixture.json"),
    JSON.stringify({
      version: "1.18.30",
      tools: OPENCODE_BUILTIN_TOOLS,
      baselineSkills: [
        {
          name: "customize-opencode",
          location: "<built-in>",
          description:
            "Use ONLY when the user is editing or creating opencode's own configuration: opencode.json, opencode.jsonc, files under .opencode/, or files under ~/.config/opencode/. Also use when creating or fixing opencode agents, subagents, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring opencode itself.",
          content: await readFile(
            resolve(
              "src/main/coding-agents/fixtures/opencode-1.18.30-customize.txt",
            ),
            "utf8",
          ),
        },
      ],
      baselineCommands: await Promise.all(
        ["initialize", "review"].map(async (name) => ({
          name: name === "initialize" ? "init" : name,
          source: "command",
          template: await readFile(
            resolve(
              `src/main/coding-agents/fixtures/opencode-1.18.30-${name}.txt`,
            ),
            "utf8",
          ),
        })),
      ),
    }),
  );
  db.exec(
    `INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,output_status,last_sequence,created_at,updated_at) VALUES ('open-run','repo','wt','t','','idle','idle',0,1,1)`,
  );
  const runtime = new ApplicationResourceRuntime({
    sqlite: db,
    userDataPath: root,
    environment: {},
    evidenceKey: Buffer.alloc(32, 8),
    executable: (kind) => (kind === "codex" ? executable : opencode),
  });
  try {
    await runtime.start();
    const session = await runtime.withSession(
      {
        worktreeId: "wt",
        agentKind: "codex",
        runId: "run",
        operation: "create",
      },
      (adapter) =>
        adapter.createSession(root, "test", {
          modelId: "fixture",
          runId: "run",
        }),
    );
    await expect(
      runtime.submitTurn(
        {
          worktreeId: "wt",
          agentKind: "codex",
          runId: "run",
          externalSessionId: session.id,
        },
        {
          explicitSkill: {
            id: "alpha",
            name: "alpha",
            version: "wrong-version",
            path: "/untrusted/SKILL.md",
          },
          providerId: "openai",
          modelId: "fixture",
        },
      ),
    ).rejects.toMatchObject({ code: "resource_unavailable" });
    expect((await runtime.assignment.get("wt", "codex")).resources).toEqual([
      expect.objectContaining({
        id: "alpha",
        version: validated.descriptor.version,
        status: "enabled",
        skillIsolation: "not_enforced",
      }),
    ]);
    await runtime.withSession(
      {
        worktreeId: "wt",
        agentKind: "opencode",
        runId: "open-run",
        operation: "create",
      },
      (adapter) =>
        adapter.createSession(root, "test", {
          modelId: "fixture",
          runId: "open-run",
        }),
    );
    expect((await runtime.assignment.get("wt", "opencode")).resources).toEqual([
      expect.objectContaining({
        id: "alpha",
        status: "enabled",
        skillIsolation: "enforced",
      }),
    ]);
    const betaSource = join(root, "beta");
    await mkdir(betaSource);
    const betaBody =
      "---\nname: beta\ndescription: Additional inert instruction.\n---\nAdditional instruction.\n";
    await writeFile(join(betaSource, "SKILL.md"), betaBody);
    const beta = await validateSkillPackage(betaSource),
      betaPath = join(
        root,
        "skills",
        "packages",
        "beta",
        beta.descriptor.version,
      );
    await mkdir(betaPath, { recursive: true });
    await writeFile(join(betaPath, "SKILL.md"), betaBody);
    db.prepare(
      `INSERT INTO skill_installations (skill_id,version,source_kind,source_ref,content_digest,name,description,codex_compatibility,opencode_compatibility,automatic_invocation,state,created_at,updated_at) VALUES ('beta',?,'local','fixture',?,'beta','Additional instruction.','supported','supported',1,'installed',1,1)`,
    ).run(beta.descriptor.version, beta.contentDigest);
    await runtime.assignment.setDesired({
      worktreeId: "wt",
      expectedRevision: "0",
      resources: [
        { kind: "skill", id: "alpha", version: validated.descriptor.version },
        { kind: "skill", id: "beta", version: beta.descriptor.version },
      ],
    });
    await runtime.assignment.waitForReconciliation("wt");
    expect((await runtime.assignment.get("wt", "codex")).resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "alpha", verified: true }),
        expect.objectContaining({ id: "beta", verified: true }),
      ]),
    );
    const priorGeneration =
      runtime.manager.inspectWorktree("wt").runtimes[0].generation;
    await runtime.assignment.setDesired({
      worktreeId: "wt",
      expectedRevision: "1",
      resources: [],
    });
    await runtime.assignment.waitForReconciliation("wt");
    expect((await runtime.assignment.get("wt", "codex")).phase).toBe("stable");
    expect((await runtime.assignment.get("wt", "codex")).resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "alpha",
          desired: false,
          verified: false,
          status: "installed",
          assignable: true,
        }),
      ]),
    );
    expect(
      runtime.manager.inspectWorktree("wt").runtimes[0].generation,
    ).not.toBe(priorGeneration);
  } finally {
    await runtime.stop();
    db.close();
    await removeFixture(root);
  }
}, 15_000);

async function removeFixture(root: string): Promise<void> {
  await chmod(root, 0o700);
  for (const entry of await readdir(root, { withFileTypes: true }))
    if (entry.isDirectory()) await removeFixture(join(root, entry.name));
  await rm(root, { recursive: true, force: true });
}

it("quarantines a turn whose cancellation acknowledgement has no terminal drain", async () => {
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "aw-release-drain-")),
    ),
    db = new Sqlite(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(bootstrapSchemaSql);
  db.exec(
    "INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at) VALUES ('repo',1,'o','r','o/r',0,0,'u','u','ready',1,1)",
  );
  db.prepare(
    "INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES ('wt','repo','w',?,'b','linked','ready',1,1)",
  ).run(root);
  db.exec(
    "INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,output_status,last_sequence,created_at,updated_at) VALUES ('run','repo','wt','t','','idle','idle',0,1,1)",
  );
  new ResourceCutover(db).run();
  const executable = join(root, "provider");
  await writeFile(
    executable,
    `#!${process.execPath}\n${await readFile(resolve("src/main/coding-agents/fixtures/codex-runtime-provider.mjs"), "utf8")}`,
  );
  await chmod(executable, 0o700);
  await writeFile(
    join(root, "codex-fixture.json"),
    JSON.stringify({ version: "0.154.0", completeOnInterrupt: false }),
  );
  const runtime = new ApplicationResourceRuntime({
    sqlite: db,
    userDataPath: root,
    environment: {},
    evidenceKey: Buffer.alloc(32, 7),
    executable: () => executable,
  });
  try {
    await runtime.start();
    const session = await runtime.withSession(
      {
        worktreeId: "wt",
        agentKind: "codex",
        runId: "run",
        operation: "create",
      },
      (adapter) =>
        adapter.createSession(root, "test", {
          modelId: "fixture",
          runId: "run",
        }),
    );
    await runtime.submitTurn(
      {
        worktreeId: "wt",
        agentKind: "codex",
        runId: "run",
        externalSessionId: session.id,
      },
      { content: "Hold turn", providerId: "openai", modelId: "fixture" },
    );
    await expect(runtime.abort("run")).rejects.toThrow(
      "Owned turn drain is unavailable",
    );
    expect(
      (await runtime.assignment.get("wt", "codex")).admission.canSend,
    ).toBe(false);
  } finally {
    await runtime.stop().catch(() => undefined);
    expect(runtime.manager.inspectWorktree("wt").runtimes).toHaveLength(0);
    db.close();
    await removeFixture(root);
  }
}, 20_000);
