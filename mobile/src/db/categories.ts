import { INBOX_ID, LOCAL_CATEGORY_ID_BASE, type Category } from '../types';
import { getDb } from './client';
import { now, remapCategoryId } from './notes';

interface CategoryRow {
  id: number;
  name: string;
  icon: string;
  sort_order: number;
  pending_sync: number;
}

const toCategory = (r: CategoryRow): Category => ({
  id: r.id,
  name: r.name,
  icon: r.icon,
  sortOrder: r.sort_order,
  pendingSync: r.pending_sync === 1,
});

export async function listCategories(): Promise<Category[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<CategoryRow>(
    'SELECT * FROM categories ORDER BY sort_order ASC, name ASC'
  );
  return rows.map(toCategory);
}

export async function listPendingCategories(): Promise<Category[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<CategoryRow>(
    'SELECT * FROM categories WHERE pending_sync = 1 ORDER BY id ASC'
  );
  return rows.map(toCategory);
}

/**
 * Categories added from the app get an id above LOCAL_CATEGORY_ID_BASE so they
 * cannot collide with server ids while they wait to be synced.
 */
export async function insertLocalCategory(name: string, icon: string): Promise<Category> {
  const db = await getDb();
  const max = await db.getFirstAsync<{ max_id: number | null; max_order: number | null }>(
    'SELECT MAX(id) AS max_id, MAX(sort_order) AS max_order FROM categories'
  );
  const id = Math.max(LOCAL_CATEGORY_ID_BASE, (max?.max_id ?? 0) + 1);
  const sortOrder = (max?.max_order ?? 0) + 1;
  await db.runAsync(
    'INSERT INTO categories (id, name, icon, sort_order, pending_sync) VALUES (?, ?, ?, ?, 1)',
    id,
    name,
    icon,
    sortOrder
  );
  return { id, name, icon, sortOrder, pendingSync: true };
}

export async function categoryNameTaken(name: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM categories WHERE lower(name) = lower(?)',
    name
  );
  return (row?.n ?? 0) > 0;
}

/** The server accepted a local category: adopt its real id everywhere. */
export async function confirmCategory(localId: number, serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM categories WHERE id = ? AND id != ?', serverId, localId);
  await db.runAsync('UPDATE categories SET id = ?, pending_sync = 0 WHERE id = ?', serverId, localId);
  await remapCategoryId(localId, serverId);
}

/**
 * Merge the server's authoritative list into local state.
 *
 * Merge, never overwrite: categories still carrying pending_sync = 1 have not
 * reached the server yet and must survive (Faza 05). Tombstoned ids are skipped
 * for the same reason in reverse — the server has not been told about that
 * deletion yet, and re-inserting it here would undo it in front of the user.
 */
export async function mergeServerCategories(
  serverCategories: ReadonlyArray<{ id: number; name: string; icon: string; sort_order: number }>
): Promise<void> {
  if (serverCategories.length === 0) return;
  const db = await getDb();
  const tombstoned = new Set(await listPendingCategoryDeletions());
  const incoming = serverCategories.filter((c) => !tombstoned.has(c.id));
  const ids = serverCategories.map((c) => c.id);
  const holes = ids.map(() => '?').join(',');

  await db.withTransactionAsync(async () => {
    for (const c of incoming) {
      await db.runAsync(
        `INSERT INTO categories (id, name, icon, sort_order, pending_sync) VALUES (?, ?, ?, ?, 0)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, icon = excluded.icon,
           sort_order = excluded.sort_order, pending_sync = 0`,
        c.id,
        c.name,
        c.icon,
        c.sort_order
      );
    }
    // Drop synced categories the server no longer has (deleted on another device).
    await db.runAsync(
      `DELETE FROM categories WHERE pending_sync = 0 AND id NOT IN (${holes}) AND id != ?`,
      ...ids,
      INBOX_ID
    );
  });
}

/**
 * Delete a category and send its notes to the trash.
 *
 * The notes lose their category rather than following it into oblivion: they go
 * to `deleted_at` like any other trashed note, recoverable for 30 days, and
 * `category_id` becomes NULL so they show under Inbox — the same "uncategorised
 * is displayed in Inbox" rule `markSyncFailed` relies on. They are not offered
 * to the categorizer while trashed (`needs_categorization` is false for a
 * deleted note), so restoring one is what sends it back through it.
 *
 * A category that never reached the server needs no tombstone: there is nothing
 * out there to resurrect it.
 *
 * Inbox is structural — it can never be removed.
 */
export async function deleteCategoryWithNotes(id: number): Promise<number> {
  if (id === INBOX_ID) return 0;
  const db = await getDb();
  const category = await db.getFirstAsync<{ pending_sync: number }>(
    'SELECT pending_sync FROM categories WHERE id = ?',
    id
  );
  if (!category) return 0;

  const ts = now();
  let trashed = 0;

  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(
      `UPDATE notes SET category_id = NULL, deleted_at = ?, updated_at = ?
        WHERE category_id = ? AND deleted_at IS NULL`,
      ts,
      ts,
      id
    );
    trashed = result.changes;

    // Notes already in the trash keep their deleted_at — re-stamping it would
    // restart their 30-day clock — but they still have to let go of the id.
    await db.runAsync('UPDATE notes SET category_id = NULL WHERE category_id = ?', id);

    await db.runAsync('DELETE FROM categories WHERE id = ?', id);
    if (category.pending_sync === 0) {
      await db.runAsync(
        'INSERT OR REPLACE INTO deleted_categories (id, deleted_at) VALUES (?, ?)',
        id,
        ts
      );
    }
  });

  return trashed;
}

/** Category deletions the worker still has to tell the server about. */
export async function listPendingCategoryDeletions(): Promise<number[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: number }>('SELECT id FROM deleted_categories');
  return rows.map((r) => r.id);
}

/**
 * Drop the tombstones the server has acted on.
 *
 * Absence from the server's authoritative list is the acknowledgement — the same
 * signal `mergeServerCategories` already trusts when it drops local rows — so
 * the response needs no extra field. A tombstone whose id is still listed stays,
 * and the next cycle asks again.
 */
export async function clearConfirmedDeletions(serverIds: readonly number[]): Promise<void> {
  const pending = await listPendingCategoryDeletions();
  const stillThere = new Set(serverIds);
  const confirmed = pending.filter((id) => !stillThere.has(id));
  if (confirmed.length === 0) return;

  const db = await getDb();
  const holes = confirmed.map(() => '?').join(',');
  await db.runAsync(`DELETE FROM deleted_categories WHERE id IN (${holes})`, ...confirmed);
}
