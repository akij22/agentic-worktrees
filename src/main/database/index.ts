import { getSqlite } from './client';
import { bootstrapSchemaSql } from './bootstrap';

export const initDatabase = (): void => {
  const sqlite = getSqlite();
  sqlite.exec(bootstrapSchemaSql);
};
