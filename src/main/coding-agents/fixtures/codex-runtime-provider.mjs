// Launched synthetic app-server protocol boundary; application services remain real.
import { createInterface } from "node:readline";
import { readFile, appendFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const fixture = JSON.parse(
  await readFile(
    join(dirname(fileURLToPath(import.meta.url)), "codex-fixture.json"),
    "utf8",
  ),
);
if (process.argv.includes("--version")) {
  console.log(`codex-cli ${fixture.version}`);
  process.exit(0);
}
const threads = new Map();
let roots = [];
let managedServers = [];
await writeFile(
  join(process.cwd(), "environment.json"),
  JSON.stringify({
    CODEX_HOME: process.env.CODEX_HOME ?? null,
    HOME: process.env.HOME ?? null,
  }),
);
const lineReader = createInterface({ input: process.stdin });
lineReader.on("line", async (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  await appendFile(
    join(process.cwd(), "requests.jsonl"),
    JSON.stringify({ method: request.method, params: request.params }) + "\n",
  );
  if (request.method === "turn/start" && fixture.errorTurn) {
    process.stdout.write(
      JSON.stringify({
        id: request.id,
        error: { code: -32603, message: fixture.errorTurn },
      }) + "\n",
    );
    return;
  }
  const p = request.params || {};
  let result = {};
  if (request.method === "initialize") result = { userAgent: "codex/0.154.0" };
  else if (request.method === "config/read")
    result = {
      config: JSON.parse(process.env.AW_CODEX_CONFIG || "{}"),
      origins: {},
      layers: [],
    };
  else if (request.method === "skills/extraRoots/set") roots = p.extraRoots;
  else if (request.method === "skills/list") {
    const skills = [...(fixture.skills || [])];
    for (const root of roots)
      for (const name of await readdir(root))
        skills.push({
          name,
          path: join(root, name, "SKILL.md"),
          enabled: true,
        });
    result = { data: [{ cwd: process.cwd(), skills, errors: [] }] };
  } else if (request.method === "mcpServerStatus/list")
    result = { data: fixture.servers || managedServers, nextCursor: null };
  else if (request.method === "thread/start") {
    managedServers = Object.keys(p.config?.mcp_servers || {}).map((name) => ({
      name,
      runtimeStatus: "connected",
      tools: {},
    }));
    const id = `thread-${threads.size + 1}`;
    const thread = {
      id,
      cwd: process.cwd(),
      createdAt: 1,
      updatedAt: 1,
      status: { type: "idle" },
      turns: [],
      path: null,
    };
    threads.set(id, thread);
    result = { thread };
  } else if (
    request.method === "thread/read" ||
    request.method === "thread/resume"
  )
    result = { thread: fixture.thread || threads.get(p.threadId) };
  else if (request.method === "turn/start") {
    result = {
      turn: { id: "turn-1", status: "inProgress", items: [], error: null },
    };
    for (const event of fixture.events || [])
      process.stdout.write(JSON.stringify(event) + "\n");
  }
  process.stdout.write(JSON.stringify({ id: request.id, result }) + "\n");
  if (request.method === "thread/start" && fixture.exitAfterThreadStart)
    setTimeout(() => process.exit(0), 30);
});
