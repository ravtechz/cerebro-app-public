import { create } from 'zustand';

import { deleteCategoryWithNotes, insertLocalCategory, listCategories } from '../db/categories';
import { purgeExpiredTrash } from '../db/client';
import * as notesDb from '../db/notes';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../db/settings';
import { resetBackoff, runSyncCycle, startWorker, type WorkerStatus } from '../sync/worker';
import {
  DONE_TRASH_DELAY_MS,
  INBOX_ID,
  type Category,
  type Note,
  type Settings,
  type View,
} from '../types';

/**
 * One interval for every pending note, rather than a timer each: the same tick
 * both expires the notes that are due and redraws the countdown on the others.
 */
let trashTicker: ReturnType<typeof setInterval> | null = null;

interface State {
  ready: boolean;
  notes: Note[];
  categories: Category[];
  settings: Settings;
  view: View;
  sidebarOpen: boolean;
  workerStatus: WorkerStatus;
  /** uuid → epoch ms at which a ticked note moves to the trash. */
  doneDeadlines: Record<string, number>;

  init: () => Promise<void>;
  reload: () => Promise<void>;
  setView: (view: View) => void;
  setSidebarOpen: (open: boolean) => void;

  addNote: (text: string) => Promise<void>;
  editNote: (uuid: string, text: string) => Promise<void>;
  moveNote: (uuid: string, categoryId: number) => Promise<void>;
  toggleDone: (uuid: string) => Promise<void>;
  restore: (uuid: string) => Promise<void>;
  retryNote: (uuid: string) => Promise<void>;
  clearDone: (categoryId: number) => Promise<void>;
  emptyTrash: () => Promise<void>;
  addCategory: (name: string, icon: string) => Promise<void>;
  deleteCategory: (categoryId: number) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  syncNow: () => Promise<void>;
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  notes: [],
  categories: [],
  settings: DEFAULT_SETTINGS,
  view: { kind: 'category', categoryId: INBOX_ID },
  sidebarOpen: false,
  workerStatus: 'idle',
  doneDeadlines: {},

  async init() {
    await purgeExpiredTrash();
    // Anything still ticked at startup is past its grace period, whether the app
    // was killed mid-countdown or the note predates the rule. The bumped
    // updated_at makes them dirty, so the cycle at the end of init ships them.
    await notesDb.trashAllDone();
    const settings = await loadSettings();
    set({ settings });
    await get().reload();
    set({ ready: true });

    startWorker({
      getSettings: () => get().settings,
      onChanged: () => void get().reload(),
      onStatus: (workerStatus) => set({ workerStatus }),
    });
    void runSyncCycle('startup');
  },

  /**
   * The one place stale countdowns are dropped. Any route out of the ticked
   * state — "clear done", restore, empty trash, the retention purge — ends in a
   * reload, so none of them has to clean up after itself.
   */
  async reload() {
    // Clear before reading, not after: the category on screen is never "new",
    // whether you just navigated to it or a note landed in it while you were
    // already there. Marking first keeps this to one pass — no second reload,
    // no badge that blinks on and off.
    const view = get().view;
    if (view.kind === 'category') await notesDb.markCategorySeen(view.categoryId);

    const [notes, categories] = await Promise.all([notesDb.listNotes(), listCategories()]);
    const pending = new Set(
      notes.filter((n) => n.done && n.deletedAt === null).map((n) => n.uuid)
    );
    const previous = get().doneDeadlines;
    const doneDeadlines = Object.fromEntries(
      Object.entries(previous).filter(([uuid]) => pending.has(uuid))
    );
    set({ notes, categories, doneDeadlines });
    syncTicker(get, set);
  },

  setView(view) {
    set({ view, sidebarOpen: false });
    void get().reload();
  },
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

  /** Insert-then-sync: the note is on screen before the worker is even awake. */
  async addNote(text) {
    await notesDb.insertNote(text);
    set({ view: { kind: 'category', categoryId: INBOX_ID } });
    await get().reload();
    void runSyncCycle('mutation');
  },

  /**
   * Editing keeps the category: once a note has one it is the user's, and a
   * typo fix must not hand it back to the LLM. The note syncs as an ordinary
   * mutation with `needs_categorization: false`.
   *
   * Editing a note that is counting down also unticks it. Otherwise the edit
   * would be saved into a note that vanishes into the trash seconds later —
   * still reaching for it plainly means you are not done with it.
   */
  async editNote(uuid, text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    await notesDb.updateText(uuid, trimmed);
    if (get().doneDeadlines[uuid] !== undefined) await notesDb.setDone(uuid, false);
    await get().reload();
    void runSyncCycle('mutation');
  },

  /**
   * Files a note into a category by hand, from the drag & drop gesture.
   *
   * A note with no category reads as Inbox everywhere in the UI, so dropping it
   * back on Inbox is not a move — comparing `categoryId ?? INBOX_ID` is what
   * keeps that a no-op instead of a pointless sync.
   *
   * Like `editNote`, this cancels a running done → trash countdown. Deliberately
   * choosing where a note belongs is not what somebody does with a note they are
   * finished with, and letting it disappear ten seconds after being filed would
   * read as the app losing it.
   */
  async moveNote(uuid, categoryId) {
    const note = get().notes.find((n) => n.uuid === uuid);
    if (!note || note.deletedAt !== null) return;
    if ((note.categoryId ?? INBOX_ID) === categoryId) return;
    await notesDb.setCategory(uuid, categoryId);
    if (get().doneDeadlines[uuid] !== undefined) await notesDb.setDone(uuid, false);
    await get().reload();
    void runSyncCycle('mutation');
  },

  /**
   * Ticking starts the countdown; unticking inside the window removes the
   * deadline, which *is* the undo. `reload` prunes, so the deadline is written
   * after it — otherwise the reload would drop the entry it had just created.
   */
  async toggleDone(uuid) {
    const note = get().notes.find((n) => n.uuid === uuid);
    if (!note) return;
    const done = !note.done;
    await notesDb.setDone(uuid, done);
    await get().reload();
    if (done) {
      set({ doneDeadlines: { ...get().doneDeadlines, [uuid]: Date.now() + DONE_TRASH_DELAY_MS } });
      syncTicker(get, set);
    }
    void runSyncCycle('mutation');
  },

  async restore(uuid) {
    await notesDb.restoreFromTrash(uuid);
    await get().reload();
    void runSyncCycle('mutation');
  },

  async retryNote(uuid) {
    await notesDb.resetRetry(uuid);
    resetBackoff();
    await get().reload();
    void runSyncCycle('manual');
  },

  async clearDone(categoryId) {
    await notesDb.trashDoneInCategory(categoryId);
    await get().reload();
    void runSyncCycle('mutation');
  },

  async emptyTrash() {
    await notesDb.emptyTrash();
    await get().reload();
  },

  async addCategory(name, icon) {
    await insertLocalCategory(name, icon);
    await get().reload();
    void runSyncCycle('mutation');
  },

  /**
   * Deletes a category and sends its notes to the trash.
   *
   * The view moves to Inbox first: the screen is showing the category that is
   * about to stop existing, and `reload()` would otherwise leave the header
   * naming it while the list underneath went empty.
   */
  async deleteCategory(categoryId) {
    if (categoryId === INBOX_ID) return;
    await deleteCategoryWithNotes(categoryId);
    const view = get().view;
    if (view.kind === 'category' && view.categoryId === categoryId) {
      set({ view: { kind: 'category', categoryId: INBOX_ID } });
    }
    await get().reload();
    void runSyncCycle('mutation');
  },

  async updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    await saveSettings(settings);
    set({ settings });
  },

  async syncNow() {
    resetBackoff();
    await runSyncCycle('manual');
  },
}));

type Get = () => State;
type Set = (partial: Partial<State>) => void;

/** Runs the interval only while something is actually counting down. */
function syncTicker(get: Get, set: Set): void {
  const pending = Object.keys(get().doneDeadlines).length > 0;

  if (pending && trashTicker === null) {
    trashTicker = setInterval(() => void tick(get, set), 1_000);
  } else if (!pending && trashTicker !== null) {
    clearInterval(trashTicker);
    trashTicker = null;
  }
}

/**
 * One second of the countdown: move whatever is due to the trash, and re-publish
 * the deadlines so the remaining cards redraw with a smaller number.
 *
 * iOS suspends timers in the background, so a note whose deadline passed while
 * the app was away is collected on the first tick after it comes back.
 */
async function tick(get: Get, set: Set): Promise<void> {
  const now = Date.now();
  const deadlines = get().doneDeadlines;
  const due = Object.entries(deadlines)
    .filter(([, deadline]) => deadline <= now)
    .map(([uuid]) => uuid);

  if (due.length === 0) {
    // Nothing expired, but the visible seconds changed: a new object identity is
    // what tells the cards to redraw.
    set({ doneDeadlines: { ...deadlines } });
    return;
  }

  for (const uuid of due) await notesDb.moveToTrash(uuid);
  await get().reload();
  void runSyncCycle('mutation');
}
