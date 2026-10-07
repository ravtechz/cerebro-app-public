import * as Crypto from 'expo-crypto';

import { INBOX_ID, type Note, type NoteStatus } from '../types';
import { getDb } from './client';

interface NoteRow {
  uuid: string;
  text: string;
  category_id: number | null;
  status: string;
  done: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
  retry_count: number;
  is_new: number;
}

const toNote = (r: NoteRow): Note => ({
  uuid: r.uuid,
  text: r.text,
  categoryId: r.category_id,
  status: r.status as NoteStatus,
  done: r.done === 1,
  deletedAt: r.deleted_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  syncedAt: r.synced_at,
  retryCount: r.retry_count,
  isNew: r.is_new === 1,
});

export const now = (): string => new Date().toISOString();

export async function listNotes(): Promise<Note[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<NoteRow>('SELECT * FROM notes ORDER BY created_at DESC');
  return rows.map(toNote);
}

export async function insertNote(text: string): Promise<Note> {
  const db = await getDb();
  const ts = now();
  const note: Note = {
    uuid: Crypto.randomUUID(),
    text,
    categoryId: null,
    status: 'pending',
    done: false,
    deletedAt: null,
    createdAt: ts,
    updatedAt: ts,
    syncedAt: null,
    retryCount: 0,
    // A note you just typed is not news to you; it becomes "new" only if the
    // categorizer later files it somewhere, which is the part you did not choose.
    isNew: false,
  };
  await db.runAsync(
    `INSERT INTO notes (uuid, text, category_id, status, done, deleted_at, created_at, updated_at, synced_at, retry_count)
     VALUES (?, ?, NULL, 'pending', 0, NULL, ?, ?, NULL, 0)`,
    note.uuid,
    note.text,
    ts,
    ts
  );
  return note;
}

/** Every local mutation bumps updated_at, which is what makes the note dirty. */
async function mutate(uuid: string, sql: string, ...params: (string | number | null)[]): Promise<void> {
  const db = await getDb();
  await db.runAsync(sql, ...params, now(), uuid);
}

export function setDone(uuid: string, done: boolean): Promise<void> {
  return mutate(uuid, 'UPDATE notes SET done = ?, updated_at = ? WHERE uuid = ?', done ? 1 : 0);
}

/**
 * The bumped updated_at is the whole sync story: the note becomes dirty, the
 * worker ships it, and the server's upsert already carries `text = EXCLUDED.text`
 * behind last-write-wins. Nothing on the backend had to change for editing.
 */
export function updateText(uuid: string, text: string): Promise<void> {
  return mutate(uuid, 'UPDATE notes SET text = ?, updated_at = ? WHERE uuid = ?', text);
}

/**
 * Files a note into a category by hand — the drop half of drag & drop.
 *
 * Inbox is written as INBOX_ID, never as NULL. The worker derives
 * `needs_categorization` from `categoryId === null`, so NULL would hand the note
 * straight back to the LLM and undo the move on the next cycle; an explicit id
 * says "the user chose this" and the server honours it (`_resolve_category`
 * returns early for a category the user owns). This is the same distinction
 * `markSyncFailed` documents from the other side, where writing INBOX_ID was
 * wrong precisely because nobody had chosen it.
 *
 * `is_new` is cleared for the same reason: the badge marks notes the categorizer
 * filed on your behalf, and you cannot be surprised by a move you just made.
 */
export function setCategory(uuid: string, categoryId: number): Promise<void> {
  return mutate(
    uuid,
    'UPDATE notes SET category_id = ?, is_new = 0, updated_at = ? WHERE uuid = ?',
    categoryId
  );
}

export function moveToTrash(uuid: string): Promise<void> {
  return mutate(uuid, 'UPDATE notes SET deleted_at = ?, updated_at = ? WHERE uuid = ?', now());
}

export function restoreFromTrash(uuid: string): Promise<void> {
  return mutate(uuid, 'UPDATE notes SET deleted_at = NULL, done = 0, updated_at = ? WHERE uuid = ?');
}

/** Retry button on an errored note: reset the counter so the worker picks it up. */
export function resetRetry(uuid: string): Promise<void> {
  return mutate(
    uuid,
    "UPDATE notes SET retry_count = 0, status = 'pending', updated_at = ? WHERE uuid = ?"
  );
}

export async function trashDoneInCategory(categoryId: number): Promise<number> {
  const db = await getDb();
  const ts = now();
  const inboxExtra = categoryId === INBOX_ID ? ' OR category_id IS NULL' : '';
  const result = await db.runAsync(
    `UPDATE notes SET deleted_at = ?, updated_at = ?
     WHERE done = 1 AND deleted_at IS NULL AND (category_id = ?${inboxExtra})`,
    ts,
    ts,
    categoryId
  );
  return result.changes;
}

/**
 * Startup sweep for the done → trash rule.
 *
 * Covers two cases with one query: notes ticked before the app was killed, whose
 * 10s timer died with the process, and notes that were already done before this
 * rule existed. Both are, by definition, past their grace period.
 */
export async function trashAllDone(): Promise<number> {
  const db = await getDb();
  const ts = now();
  const result = await db.runAsync(
    'UPDATE notes SET deleted_at = ?, updated_at = ? WHERE done = 1 AND deleted_at IS NULL',
    ts,
    ts
  );
  return result.changes;
}

export async function emptyTrash(): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync('DELETE FROM notes WHERE deleted_at IS NOT NULL');
  return result.changes;
}

/** Notes the worker must push: never synced, or mutated since the last sync. */
export async function listDirtyNotes(maxRetries: number): Promise<Note[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<NoteRow>(
    `SELECT * FROM notes
     WHERE (synced_at IS NULL OR updated_at > synced_at) AND retry_count < ?
     ORDER BY created_at ASC`,
    maxRetries
  );
  return rows.map(toNote);
}

export async function markCategorizing(uuids: string[]): Promise<void> {
  if (uuids.length === 0) return;
  const db = await getDb();
  const holes = uuids.map(() => '?').join(',');
  // updated_at is deliberately untouched: this is a transport state, not a mutation.
  await db.runAsync(
    `UPDATE notes SET status = 'categorizing' WHERE uuid IN (${holes}) AND status = 'pending'`,
    ...uuids
  );
}

/**
 * Writes back what the server decided for one note.
 *
 * `sentUpdatedAt` is the `updated_at` that actually went out in the request, and
 * the row is only touched while it still carries it. Without that guard a
 * mutation made *during* the round trip is silently destroyed: the response
 * overwrites `category_id` with the LLM's answer to the older text and stamps
 * `synced_at` past `updated_at`, so the note stops being dirty and the user's
 * change never ships. Dragging a note out of Inbox while it is still being
 * categorized is the easy way to hit this, but editing one always could.
 *
 * Skipping the write leaves the note dirty, which is exactly right — the next
 * cycle sends the newer version, and the server's last-write-wins upsert takes
 * it. This is safe only because `/sync` echoes back the notes it was sent and
 * never pulls others, so nothing else depends on this write landing.
 */
export async function applySyncedNote(
  uuid: string,
  categoryId: number | null,
  status: NoteStatus,
  syncedAt: string,
  sentUpdatedAt: string
): Promise<void> {
  const db = await getDb();
  // The badge is raised exactly on the null → category transition, which is the
  // moment the categorizer decided something on the user's behalf. In SQLite the
  // right-hand side of SET sees the pre-update row, so `category_id IS NULL`
  // still reads the old value here.
  //
  // A note that already had a category and is merely re-synced (an edit, a
  // retry) never re-raises the badge. A fallback into Inbox does raise it —
  // that note needs attention precisely because the LLM could not place it.
  await db.runAsync(
    `UPDATE notes
        SET category_id = ?, status = ?, synced_at = ?, retry_count = 0,
            is_new = CASE WHEN category_id IS NULL AND ? IS NOT NULL THEN 1 ELSE is_new END
      WHERE uuid = ? AND updated_at = ?`,
    categoryId,
    status,
    syncedAt,
    categoryId,
    uuid,
    sentUpdatedAt
  );
}

/**
 * Opening a category is what marks it read.
 *
 * Deliberately does not touch `updated_at`: this is local view state, not a
 * mutation, and marking it dirty would ship a pointless round trip to the
 * server for every category you glance at. Same reasoning as `markCategorizing`.
 */
export async function markCategorySeen(categoryId: number): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    'UPDATE notes SET is_new = 0 WHERE is_new = 1 AND category_id = ?',
    categoryId
  );
  return result.changes;
}

/**
 * A sync cycle failed. Bump the retry counter; once it is exhausted the note
 * shows up in Inbox with status error — usable locally, never lost.
 *
 * `category_id` is deliberately left NULL. Writing INBOX_ID here used to make
 * the fallback permanent: the worker derives `needs_categorization` from
 * `categoryId === null`, so a note that had been parked in Inbox was sent as an
 * explicit user choice, the server honoured it, and the LLM was never called —
 * not when the network came back, and not on the retry button either, since
 * `resetRetry` clears the counter but not the category. Notes written during an
 * outage stayed uncategorised forever.
 *
 * Inbox is where a category-less note is *displayed* (see HomeScreen and
 * trashDoneInCategory); it does not need to be written down to appear there.
 */
export async function markSyncFailed(uuids: string[], maxRetries: number): Promise<void> {
  if (uuids.length === 0) return;
  const db = await getDb();
  const holes = uuids.map(() => '?').join(',');
  await db.runAsync(
    `UPDATE notes SET retry_count = retry_count + 1 WHERE uuid IN (${holes})`,
    ...uuids
  );
  await db.runAsync(
    `UPDATE notes SET status = 'error'
     WHERE uuid IN (${holes}) AND retry_count >= ?`,
    ...uuids,
    maxRetries
  );
  await db.runAsync(
    `UPDATE notes SET status = 'pending'
     WHERE uuid IN (${holes}) AND retry_count < ? AND status = 'categorizing'`,
    ...uuids,
    maxRetries
  );
}

/** Remaps notes off a temporary local category id once the server assigns one. */
export async function remapCategoryId(from: number, to: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE notes SET category_id = ? WHERE category_id = ?', to, from);
}
