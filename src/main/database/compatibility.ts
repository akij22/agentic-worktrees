import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

const legacyTables = ["session_capabilities", "worktree_capabilities", "skill_invocations"] as const;
const guardNames = legacyTables.flatMap((table) =>
  ["insert", "update", "delete"].map((operation) => `${table}_resource_read_only_${operation}`),
);

const resourceGuards = (database: Database.Database): string[] => {
  const triggers = database.prepare("SELECT name, tbl_name tableName, sql FROM sqlite_master WHERE type='trigger'")
    .all() as Array<{ name: string; tableName: string; sql: string }>;
  return triggers.filter((trigger) =>
    guardNames.includes(trigger.name) &&
    legacyTables.some((table) => table === trigger.tableName) &&
    trigger.sql.includes("legacy_resource_read_only") &&
    trigger.sql.includes("worktree-resource-release-v1"),
  ).map(({ name }) => name);
};

// A newer experimental build may have cut over the shared database to a
// resource model this version cannot write. Keep its data and guards intact;
// this version continues on its own consistent snapshot, including WAL data.
export const resolveCompatibleDatabasePath = async (userDataPath: string): Promise<string> => {
  const sourcePath = path.join(userDataPath, "data", "app.db");
  const compatiblePath = path.join(userDataPath, "data", "app-session-resources.db");
  if (existsSync(compatiblePath)) return compatiblePath;
  if (!existsSync(sourcePath)) return sourcePath;

  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  const stagingPath = `${compatiblePath}.${randomUUID()}.tmp`;
  try {
    if (resourceGuards(source).length === 0) return sourcePath;
    await source.backup(stagingPath);
    const snapshot = new Database(stagingPath);
    try {
      // Publish a single complete file, without a staging-path WAL sidecar.
      snapshot.pragma("journal_mode = DELETE");
      snapshot.transaction(() => {
        for (const name of resourceGuards(snapshot)) {
          // Names come exclusively from the fixed allowlist above.
          snapshot.exec(`DROP TRIGGER "${name}"`);
        }
      })();
    } finally {
      snapshot.close();
    }
    // Publish only the completed snapshot, never replace an existing copy.
    try {
      await fs.link(stagingPath, compatiblePath);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    return compatiblePath;
  } finally {
    source.close();
    await fs.rm(stagingPath, { force: true });
  }
};
