import * as SQLite from 'expo-sqlite';

import { INBOX_ID, TRASH_RETENTION_DAYS } from '../types';

const DB_NAME = 'cerebro.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS notes (
  uuid TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  category_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  done INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  icon TEXT NOT NULL DEFAULT 'category',
  sort_order INTEGER NOT NULL DEFAULT 0,
  pending_sync INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notes_trash ON notes(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notes_dirty ON notes(synced_at, updated_at);
`;

/**
 * Incremental schema changes, applied in order and tracked by `PRAGMA
 * user_version`.
 *
 * SCHEMA above is only ever the *baseline*: `CREATE TABLE IF NOT EXISTS` does
 * nothing to a database that already has the table, so a column added there
 * would never reach an existing install. Anything that changes an existing
 * table has to arrive here instead.
 *
 * Never edit or reorder a migration that has shipped — append. The index in this
 * array *is* the version number.
 */
const MIGRATIONS: ReadonlyArray<string> = [
  // 1 — unread marker per note, for the sidebar badges. Defaults to 0, so notes
  // that already existed when this shipped start out as "seen" rather than
  // greeting the user with a badge on every category.
  'ALTER TABLE notes ADD COLUMN is_new INTEGER NOT NULL DEFAULT 0',
  // 2 — tombstones for deleted categories. A category the server still lists
  // would be re-created by mergeServerCategories on the very next sync, so the
  // deletion has to be remembered until the server confirms it.
  `CREATE TABLE IF NOT EXISTS deleted_categories (
     id         INTEGER PRIMARY KEY,
     deleted_at TEXT NOT NULL
   )`,
];

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  for (let version = current; version < MIGRATIONS.length; version += 1) {
    await db.execAsync(MIGRATIONS[version]);
    // PRAGMA takes no bound parameters, hence the interpolation; the value is a
    // loop index, never user input.
    await db.execAsync(`PRAGMA user_version = ${version + 1}`);
  }
}

/**
 * Seed categories. Replaced by the server's list (per user) after the first real
 * sync in Faza 05 — locally added categories with pending_sync = 1 survive that.
 */
const SEED_CATEGORIES: ReadonlyArray<[number, string, string, number]> = [
  [INBOX_ID, 'Inbox', 'inbox', 0],
  [2, 'Idei YouTube', 'smart_display', 1],
  [3, 'Filme', 'movie', 2],
  [4, 'Todos', 'check_circle', 3],
];

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(SCHEMA);
      await migrate(db);
      await seedCategories(db);
      return db;
    });
  }
  return dbPromise;
}

async function seedCategories(db: SQLite.SQLiteDatabase): Promise<void> {
  for (const [id, name, icon, sortOrder] of SEED_CATEGORIES) {
    await db.runAsync(
      'INSERT OR IGNORE INTO categories (id, name, icon, sort_order, pending_sync) VALUES (?, ?, ?, ?, 0)',
      id,
      name,
      icon,
      sortOrder
    );
  }
}

/**
 * Runs on every app start: notes that have sat in the trash past the retention
 * window are gone for good.
 *
 * We do not queue these deletes for sync. The /sync contract (Faza 04) carries
 * note mutations only, and the server runs the identical 30-day purge job
 * (Faza 03), so both sides converge without inventing protocol surface.
 */
export async function purgeExpiredTrash(): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 86400_000).toISOString();
  const result = await db.runAsync(
    'DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?',
    cutoff
  );
  return result.changes;
}

/** Test-only / recovery helper: wipes local state so the next start re-seeds. */
export async function resetDatabase(): Promise<void> {
  const db = await getDb();
  await db.execAsync(
    'DELETE FROM notes; DELETE FROM categories; DELETE FROM settings; DELETE FROM deleted_categories;'
  );
  await seedCategories(db);
}
