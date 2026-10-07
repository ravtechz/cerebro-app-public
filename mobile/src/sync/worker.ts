import NetInfo from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';

import { getApiClient, type SyncNoteIn, type SyncPayload } from '../api';
import {
  clearConfirmedDeletions,
  confirmCategory,
  listPendingCategories,
  listPendingCategoryDeletions,
  mergeServerCategories,
} from '../db/categories';
import {
  applySyncedNote,
  listDirtyNotes,
  markCategorizing,
  markSyncFailed,
  now,
} from '../db/notes';
import type { Note, Settings } from '../types';

export const MAX_RETRIES = 5;

/** Exponential-ish backoff, indexed by how many attempts already failed. */
export const BACKOFF_MS = [1_000, 5_000, 30_000, 120_000, 900_000] as const;

/**
 * How many notes one request may hand to the LLM.
 *
 * The backend categorizes sequentially and gemma3:4b costs seconds per note, so
 * an unbounded batch makes an unbounded request. Coming back from a day offline
 * would otherwise be one enormous call that times out, gets retried whole, and
 * times out again. Small batches keep every request inside its budget and let
 * the backlog drain visibly instead of failing all at once.
 */
export const MAX_CATEGORIZE_PER_BATCH = 4;

/** Mutations are cheap server-side; this cap only keeps request bodies sane. */
export const MAX_NOTES_PER_BATCH = 50;

const needsCategory = (n: Note): boolean => n.categoryId === null && n.deletedAt === null;

/**
 * Splits dirty notes into requests that each stay within both caps.
 *
 * Order is preserved, so notes sync roughly oldest first.
 */
export function chunkNotes(notes: readonly Note[]): Note[][] {
  const batches: Note[][] = [];
  let current: Note[] = [];
  let categorizing = 0;

  for (const note of notes) {
    const cost = needsCategory(note) ? 1 : 0;
    const full =
      current.length >= MAX_NOTES_PER_BATCH ||
      (cost === 1 && categorizing >= MAX_CATEGORIZE_PER_BATCH);
    if (full && current.length > 0) {
      batches.push(current);
      current = [];
      categorizing = 0;
    }
    current.push(note);
    categorizing += cost;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

export type WorkerStatus = 'idle' | 'busy' | 'error';

export type SyncTrigger = 'mutation' | 'foreground' | 'network' | 'manual' | 'retry' | 'startup';

interface WorkerDeps {
  getSettings: () => Settings;
  /** Called after local state changed so the UI can reload from SQLite. */
  onChanged: () => void;
  onStatus: (status: WorkerStatus) => void;
}

let deps: WorkerDeps | null = null;
let running = false;
let rerunRequested = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let consecutiveFailures = 0;
let unsubscribers: Array<() => void> = [];

/**
 * Event-driven sync worker.
 *
 * One cycle at a time (`running` is the mutex). Triggers are events — a local
 * mutation, the app coming to the foreground, the network coming back, a manual
 * pull-to-refresh — plus a backoff timer after a failure. No polling loop.
 */
export function startWorker(d: WorkerDeps): void {
  stopWorker();
  deps = d;

  const appSub = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') void runSyncCycle('foreground');
  });
  unsubscribers.push(() => appSub.remove());

  let wasOffline = false;
  const netSub = NetInfo.addEventListener((state) => {
    const online = state.isConnected === true && state.isInternetReachable !== false;
    if (online && wasOffline) void runSyncCycle('network');
    wasOffline = !online;
  });
  unsubscribers.push(netSub);
}

export function stopWorker(): void {
  unsubscribers.forEach((fn) => fn());
  unsubscribers = [];
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  deps = null;
}

export async function runSyncCycle(trigger: SyncTrigger): Promise<void> {
  if (!deps) return;
  if (running) {
    // Coalesce: whatever arrived mid-cycle gets picked up by one extra run.
    rerunRequested = true;
    return;
  }
  running = true;
  const { getSettings, onChanged, onStatus } = deps;

  try {
    const [dirtyNotes, pendingCategories, deletedCategories] = await Promise.all([
      listDirtyNotes(MAX_RETRIES),
      listPendingCategories(),
      listPendingCategoryDeletions(),
    ]);

    if (
      dirtyNotes.length === 0 &&
      pendingCategories.length === 0 &&
      deletedCategories.length === 0
    ) {
      consecutiveFailures = 0;
      onStatus('idle');
      return;
    }

    onStatus('busy');
    const needsCategorization = dirtyNotes.filter(needsCategory);
    await markCategorizing(needsCategorization.map((n) => n.uuid));
    onChanged();

    const client = getApiClient(getSettings());
    const batches = chunkNotes(dirtyNotes);
    // Category work travels with the first batch, so there has to be one even
    // when no note is dirty — adding or deleting a category on a quiet app is
    // otherwise a request that never goes out.
    if (batches.length === 0) batches.push([]);

    // New categories and deletions ride with the first batch only: the server
    // assigns ids once, and later batches reference those ids through
    // category_id. Re-sending them per batch would just repeat the work.
    for (let i = 0; i < batches.length; i += 1) {
      const payload: SyncPayload = {
        notes: batches[i].map(
          (n): SyncNoteIn => ({
            uuid: n.uuid,
            text: n.text,
            category_id: n.categoryId,
            done: n.done,
            deleted_at: n.deletedAt,
            created_at: n.createdAt,
            updated_at: n.updatedAt,
            needs_categorization: needsCategory(n),
          })
        ),
        new_categories:
          i === 0
            ? pendingCategories.map((c) => ({
                local_ref: `tmp-${c.id}`,
                name: c.name,
                icon: c.icon,
              }))
            : [],
        deleted_categories: i === 0 ? deletedCategories : [],
      };

      const response = await client.sync(payload);

      // Categories first: notes may reference an id the server just assigned.
      for (const [localRef, serverId] of Object.entries(response.category_refs)) {
        const localId = Number(localRef.replace('tmp-', ''));
        if (Number.isFinite(localId)) await confirmCategory(localId, serverId);
      }
      // Before the merge: a tombstone still standing is what keeps the merge
      // from re-inserting the category the server has not dropped yet.
      await clearConfirmedDeletions(response.categories.map((c) => c.id));
      await mergeServerCategories(response.categories);

      // Keyed by uuid: the response says what the server decided, but only the
      // request knows which revision of the note it was deciding about, and
      // `applySyncedNote` refuses to overwrite anything mutated since.
      const sentAt = new Map(batches[i].map((n) => [n.uuid, n.updatedAt]));
      const syncedAt = now();
      for (const n of response.notes) {
        const sent = sentAt.get(n.uuid);
        if (sent === undefined) continue;
        await applySyncedNote(n.uuid, n.category_id, n.status, syncedAt, sent);
      }

      // Land each batch in the UI as it arrives — a long backlog should look
      // like it is draining, not like it is stuck.
      consecutiveFailures = 0;
      onChanged();
    }

    onStatus('idle');
  } catch (error) {
    await handleFailure(error);
  } finally {
    running = false;
    if (rerunRequested) {
      rerunRequested = false;
      void runSyncCycle('mutation');
    }
  }
}

async function handleFailure(error: unknown): Promise<void> {
  if (!deps) return;
  const dirty = await listDirtyNotes(MAX_RETRIES);
  await markSyncFailed(
    dirty.map((n) => n.uuid),
    MAX_RETRIES
  );
  deps.onStatus('error');
  deps.onChanged();

  const delay = BACKOFF_MS[Math.min(consecutiveFailures, BACKOFF_MS.length - 1)];
  consecutiveFailures += 1;
  console.warn(`[sync] cycle failed (attempt ${consecutiveFailures}), retrying in ${delay}ms`, error);

  if (consecutiveFailures <= MAX_RETRIES) {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void runSyncCycle('retry');
    }, delay);
  }
}

/** A manual retry clears the backoff so the next cycle goes out immediately. */
export function resetBackoff(): void {
  consecutiveFailures = 0;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}
