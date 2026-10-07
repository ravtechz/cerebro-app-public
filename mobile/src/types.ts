import type { NoteStatus, TextSize, ThemeId } from './theme/tokens';

export type { NoteStatus, TextSize, ThemeId };

export interface Note {
  uuid: string;
  text: string;
  categoryId: number | null;
  status: NoteStatus;
  done: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  syncedAt: string | null;
  retryCount: number;
  /** Landed in its category since the user last opened that category. */
  isNew: boolean;
}

export interface Category {
  id: number;
  name: string;
  icon: string;
  sortOrder: number;
  pendingSync: boolean;
}

/** Which list the Home screen is showing. */
export type View = { kind: 'category'; categoryId: number } | { kind: 'trash' };

export interface Settings {
  baseUrl: string;
  apiKey: string;
  /** Set once "Test connection" succeeded; gates the switch from mock to http. */
  connectionOk: boolean;
  /** Typography scale, chosen in Settings. Applies instantly, never synced. */
  textSize: TextSize;
  /** Active theme, chosen in Settings. Applies instantly, never synced. */
  themeId: ThemeId;
}

/** The Inbox category is seeded with id 1 and can never be deleted. */
export const INBOX_ID = 1;

/**
 * Locally created categories get ids from this base so they cannot collide with
 * server-assigned ids before the sync worker remaps them.
 */
export const LOCAL_CATEGORY_ID_BASE = 100000;

export const TRASH_RETENTION_DAYS = 30;

/**
 * Grace period between ticking a note done and it moving to the trash.
 * Unticking inside the window cancels the move — that is the undo.
 */
export const DONE_TRASH_DELAY_MS = 10_000;
