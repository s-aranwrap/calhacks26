/**
 * Bridges expo-sqlite to the storage-agnostic SqlDatabase interface used by
 * the user store, and runs migrations when the database opens.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { migrate, type SqlDatabase, type SqlParam } from '@/data/local/sqliteUserStore';

export const DATABASE_NAME = 'huddle.db';

export function fromExpoSqlite(db: SQLiteDatabase): SqlDatabase {
  return {
    execAsync: (sql) => db.execAsync(sql),
    runAsync: (sql, ...params: SqlParam[]) => db.runAsync(sql, ...params),
    getAllAsync: <T>(sql: string, ...params: SqlParam[]) => db.getAllAsync<T>(sql, ...params),
    getFirstAsync: <T>(sql: string, ...params: SqlParam[]) => db.getFirstAsync<T>(sql, ...params),
  };
}

/** Passed to <SQLiteProvider onInit>. Must be a stable module-level function. */
export async function initDatabase(db: SQLiteDatabase): Promise<void> {
  await migrate(fromExpoSqlite(db));
}
