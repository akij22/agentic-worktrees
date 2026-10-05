import { app } from "electron";
import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

import * as schema from "../../shared/db/schema";

let sqlite: Database.Database | null = null;
let db: BetterSQLite3Database<typeof schema> | null = null;
let configuredDatabasePath: string | null = null;

export const configureDatabaseUserDataPath = (userDataPath: string, databasePath?: string): void => {
  const requestedDatabasePath = databasePath ?? path.join(userDataPath, "data", "app.db");
  if (sqlite && getDatabasePath() !== requestedDatabasePath)
    throw new Error("database_already_initialized");
  configuredDatabasePath = requestedDatabasePath;
};

export const getDatabasePath = (): string =>
  configuredDatabasePath ?? path.join(app.getPath("userData"), "data", "app.db");

export const getSqlite = (): Database.Database => {
  if (!sqlite) {
    const databasePath = getDatabasePath();
    mkdirSync(path.dirname(databasePath), { recursive: true });

    sqlite = new Database(databasePath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
  }

  return sqlite;
};

export const getDatabase = (): BetterSQLite3Database<typeof schema> => {
  if (!db) {
    db = drizzle(getSqlite(), { schema });
  }

  return db;
};
